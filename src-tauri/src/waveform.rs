// The whole waveform of a song before it plays, for the Wave progress bar: its smallest Ogg file
// (96 kbps, about 2 MB for a song) fetched and decoded the way librespot's player does, and
// measured into bars. Songs only: an episode's file is tens of MB, so the bar learns it while
// it plays instead.
use std::io::{self, Read, Seek, SeekFrom};

use librespot_audio::{AudioDecrypt, AudioFile};
use librespot_core::{Session, SpotifyId, SpotifyUri};
use librespot_metadata::audio::{AudioFileFormat, AudioItem};
use librespot_playback::decoder::{AudioDecoder, AudioPacket, SymphoniaDecoder};
use librespot_playback::SAMPLE_RATE;
use symphonia::core::io::MediaSource;
use symphonia::core::probe::Hint;

/// Bars across the song; the same number the progress bar draws.
pub const BINS: usize = 120;
/// Spotify's Ogg files start with a header of its own, before the Ogg stream.
const OGG_HEADER: u64 = 0xa7;
/// The files tried, smallest first, with the rate librespot fetches each at (bytes a second).
const FORMATS: [(AudioFileFormat, usize); 3] = [
    (AudioFileFormat::OGG_VORBIS_96, 12 * 1024),
    (AudioFileFormat::OGG_VORBIS_160, 20 * 1024),
    (AudioFileFormat::OGG_VORBIS_320, 40 * 1024),
];

/// The loudness (RMS, full scale 1) of each of BINS equal stretches of the song.
pub async fn measure(session: &Session, uri: &str) -> Result<Vec<f32>, String> {
    let spotify_uri = SpotifyUri::from_uri(uri).map_err(|e| e.to_string())?;
    if !matches!(spotify_uri, SpotifyUri::Track { .. }) {
        return Err("only songs have a waveform ahead".into());
    }
    let track_id: SpotifyId = (&spotify_uri).try_into().map_err(|_| "not a song id".to_string())?;
    let item = AudioItem::get_file(session, spotify_uri).await.map_err(|e| e.to_string())?;
    let (file_id, rate) = FORMATS
        .iter()
        .find_map(|(format, rate)| item.files.0.get(format).map(|id| (*id, *rate)))
        .ok_or("no Ogg file for this song")?;
    let file = AudioFile::open(session, file_id, rate).await.map_err(|e| e.to_string())?;
    let length = file.get_stream_loader_controller().map_err(|e| e.to_string())?.len() as u64;
    // As in the player: a file without a key may simply not be encrypted.
    let key = session.audio_key().request(track_id, file_id).await.ok();
    let duration_ms = u64::from(item.duration_ms.max(1));
    // Reading the file blocks while it downloads: off the async threads.
    tokio::task::spawn_blocking(move || bars(AudioDecrypt::new(key, file), length, duration_ms))
        .await
        .map_err(|e| e.to_string())?
}

fn bars<R: Read + Seek + Send + Sync + 'static>(file: R, length: u64, duration_ms: u64) -> Result<Vec<f32>, String> {
    let source = Subfile::new(file, OGG_HEADER, length).map_err(|e| e.to_string())?;
    let mut hint = Hint::new();
    hint.with_extension("ogg");
    let mut decoder = SymphoniaDecoder::new(source, hint).map_err(|e| e.to_string())?;
    let mut acc = Bins::new(duration_ms);
    while let Some((at, packet)) = decoder.next_packet().map_err(|e| e.to_string())? {
        if let AudioPacket::Samples(samples) = packet {
            acc.add(at.position_ms, &samples);
        }
    }
    Ok(acc.rms())
}

/// Loudness per stretch of the song, frame by frame (a packet can cross from one bar to the next).
struct Bins {
    duration_ms: u64,
    sum: Vec<f64>,
    count: Vec<u64>,
}

impl Bins {
    fn new(duration_ms: u64) -> Self {
        Self { duration_ms: duration_ms.max(1), sum: vec![0.0; BINS], count: vec![0; BINS] }
    }

    /// Interleaved stereo starting at `start_ms`.
    fn add(&mut self, start_ms: u32, samples: &[f64]) {
        let start = f64::from(start_ms);
        for (k, pair) in samples.chunks_exact(2).enumerate() {
            let ms = start + k as f64 * 1000.0 / f64::from(SAMPLE_RATE);
            let i = ((ms * BINS as f64 / self.duration_ms as f64) as usize).min(BINS - 1);
            // The two channels' energy, so sound in opposite phase does not cancel out.
            self.sum[i] += (pair[0] * pair[0] + pair[1] * pair[1]) * 0.5;
            self.count[i] += 1;
        }
    }

    fn rms(&self) -> Vec<f32> {
        (0..BINS).map(|i| if self.count[i] > 0 { (self.sum[i] / self.count[i] as f64).sqrt() as f32 } else { 0.0 }).collect()
    }
}

/// The file past Spotify's header, as the decoder expects it (librespot's own is private).
struct Subfile<T> {
    stream: T,
    offset: u64,
    length: u64,
}

impl<T: Read + Seek> Subfile<T> {
    fn new(mut stream: T, offset: u64, length: u64) -> io::Result<Self> {
        stream.seek(SeekFrom::Start(offset))?;
        Ok(Self { stream, offset, length })
    }
}

impl<T: Read> Read for Subfile<T> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.stream.read(buf)
    }
}

impl<T: Seek> Seek for Subfile<T> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        // Every target is worked out first, so a seek into the hidden header fails and moves nothing.
        let target = match pos {
            SeekFrom::Start(n) => n.checked_add(self.offset),
            SeekFrom::End(n) => self.length.checked_add_signed(n),
            SeekFrom::Current(n) => self.stream.stream_position()?.checked_add_signed(n),
        };
        match target {
            Some(t) if t >= self.offset => Ok(self.stream.seek(SeekFrom::Start(t))? - self.offset),
            _ => Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before the start of the audio")),
        }
    }
}

impl<T: Read + Seek + Send + Sync> MediaSource for Subfile<T> {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.length.saturating_sub(self.offset))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn the_subfile_hides_the_header() {
        let mut data = vec![9u8; OGG_HEADER as usize];
        data.extend_from_slice(b"OggS rest");
        let len = data.len() as u64;
        let mut f = Subfile::new(Cursor::new(data), OGG_HEADER, len).unwrap();
        let mut head = [0u8; 4];
        f.read_exact(&mut head).unwrap();
        assert_eq!(&head, b"OggS");
        assert_eq!(f.seek(SeekFrom::Start(0)).unwrap(), 0);
        assert_eq!(f.byte_len(), Some(9));
        assert_eq!(f.seek(SeekFrom::End(0)).unwrap(), 9);
        f.seek(SeekFrom::Start(2)).unwrap();
        assert!(f.seek(SeekFrom::Current(-3)).is_err(), "into the header");
        assert!(f.seek(SeekFrom::Start(u64::MAX)).is_err(), "past the end of numbers");
        assert_eq!(f.stream_position().unwrap(), 2, "a failed seek moves nothing");
    }

    #[test]
    fn opposite_phase_still_counts() {
        let mut b = Bins::new(1000);
        b.add(0, &[0.5, -0.5, 0.5, -0.5]);
        assert!((b.rms()[0] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_packet_across_two_bars_splits_between_them() {
        // 120 bars over 1.2 s: one bar every 10 ms. A 20 ms packet from 0 ms fills the first two.
        let mut b = Bins::new(1200);
        let frames = SAMPLE_RATE as usize / 50;
        b.add(0, &vec![0.3; frames * 2]);
        let r = b.rms();
        assert!(r[0] > 0.29 && r[1] > 0.29 && r[2] == 0.0, "{:?}", &r[..3]);
    }
}
