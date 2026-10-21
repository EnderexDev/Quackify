// Experiment, not wired to the UI: measures the audio on its way to the speakers, to learn
// whether a meter in the sink costs anything, how far ahead of the sound it runs, and whether
// its frequency bands come out right. Turned on with QUACKIFY_METER; it logs one line a second.
use std::time::{Duration, Instant};

use librespot_playback::audio_backend::{Sink, SinkResult};
use librespot_playback::convert::Converter;
use librespot_playback::decoder::AudioPacket;
use librespot_playback::mixer::VolumeGetter;
use librespot_playback::{NUM_CHANNELS, SAMPLE_RATE};

pub const BANDS: usize = 16;
/// Mono samples per spectrum: 46 ms of sound, bins about 22 Hz apart (1024 left the lowest bands
/// sharing the same two bins).
const FFT: usize = 2048;
const LOW_HZ: f32 = 50.0;
const HIGH_HZ: f32 = 16_000.0;

/// What the meter hears in one moment, with the volume taken back out.
#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub peak: f32,
    pub rms: f32,
    /// 0 (silence, -60 dB or less) to 1 (full scale), low to high.
    pub bands: [f32; BANDS],
}

pub struct Meter {
    ring: Vec<f32>,
    at: usize,
    window: Vec<f32>,
}

impl Meter {
    pub fn new() -> Self {
        let window = (0..FFT).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT as f32).cos()).collect();
        Self { ring: vec![0.0; FFT], at: 0, window }
    }

    /// Takes interleaved stereo samples already scaled by `volume` and measures them.
    pub fn feed(&mut self, samples: &[f64], volume: f64) -> Frame {
        let undo = if volume > 0.001 { 1.0 / volume } else { 0.0 };
        let mut peak = 0f32;
        let mut sum = 0f64;
        for pair in samples.chunks_exact(NUM_CHANNELS as usize) {
            let mono = ((pair[0] + pair[1]) * 0.5 * undo) as f32;
            peak = peak.max(mono.abs());
            sum += (mono as f64) * (mono as f64);
            self.ring[self.at] = mono;
            self.at = (self.at + 1) % FFT;
        }
        let n = (samples.len() / NUM_CHANNELS as usize).max(1);
        Frame { peak, rms: (sum / n as f64).sqrt() as f32, bands: self.spectrum() }
    }

    fn spectrum(&self) -> [f32; BANDS] {
        let mut re: Vec<f32> = (0..FFT).map(|i| self.ring[(self.at + i) % FFT] * self.window[i]).collect();
        let mut im = vec![0f32; FFT];
        fft(&mut re, &mut im);
        let bin_hz = SAMPLE_RATE as f32 / FFT as f32;
        let mut out = [0f32; BANDS];
        for (b, slot) in out.iter_mut().enumerate() {
            let lo = LOW_HZ * (HIGH_HZ / LOW_HZ).powf(b as f32 / BANDS as f32);
            let hi = LOW_HZ * (HIGH_HZ / LOW_HZ).powf((b + 1) as f32 / BANDS as f32);
            let (a, z) = ((lo / bin_hz) as usize, ((hi / bin_hz) as usize).max((lo / bin_hz) as usize + 1));
            let mag = (a..z.min(FFT / 2)).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt()).fold(0f32, f32::max);
            // A full-scale sine under a Hann window peaks at FFT / 4.
            let db = 20.0 * (mag / (FFT as f32 / 4.0)).max(1e-6).log10();
            *slot = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
        }
        out
    }
}

/// In-place iterative radix-2 FFT; `re.len()` must be a power of two.
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        for start in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (s, c) = (ang * k as f32).sin_cos();
                let (a, b) = (start + k, start + k + len / 2);
                let tr = re[b] * c - im[b] * s;
                let ti = re[b] * s + im[b] * c;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

/// The real sink, with the meter listening on the way in.
pub struct MeterSink {
    inner: Box<dyn Sink>,
    volume: Box<dyn VolumeGetter + Send>,
    meter: Meter,
    started: Option<Instant>,
    written: u64,
    second: Instant,
    packets: u32,
    meter_time: Duration,
    sink_time: Duration,
    last: Frame,
}

impl MeterSink {
    pub fn new(inner: Box<dyn Sink>, volume: Box<dyn VolumeGetter + Send>) -> Self {
        Self {
            inner,
            volume,
            meter: Meter::new(),
            started: None,
            written: 0,
            second: Instant::now(),
            packets: 0,
            meter_time: Duration::ZERO,
            sink_time: Duration::ZERO,
            last: Frame::default(),
        }
    }

    fn report(&mut self) {
        let Some(started) = self.started else { return };
        let written_s = self.written as f64 / (SAMPLE_RATE as f64 * NUM_CHANNELS as f64);
        let lead_ms = (written_s - started.elapsed().as_secs_f64()) * 1000.0;
        let per = |d: Duration| d.as_micros() as f64 / self.packets.max(1) as f64;
        let bars: String = self.last.bands.iter().map(|v| char::from_digit((v * 9.0).round() as u32, 10).unwrap_or('9')).collect();
        eprintln!(
            "[meter] packets {:3}  meter {:6.1} us/packet  sink {:7.1} us/packet  ahead of the speakers {:5.0} ms  volume {:.2}  peak {:.2}  rms {:.2}  bands {}",
            self.packets,
            per(self.meter_time),
            per(self.sink_time),
            lead_ms,
            self.volume.attenuation_factor(),
            self.last.peak,
            self.last.rms,
            bars
        );
        self.packets = 0;
        self.meter_time = Duration::ZERO;
        self.sink_time = Duration::ZERO;
        self.second = Instant::now();
    }
}

impl Sink for MeterSink {
    fn start(&mut self) -> SinkResult<()> {
        self.started = Some(Instant::now());
        self.written = 0;
        eprintln!("[meter] start");
        self.inner.start()
    }

    fn stop(&mut self) -> SinkResult<()> {
        eprintln!("[meter] stop");
        self.started = None;
        self.inner.stop()
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        let t0 = Instant::now();
        if let AudioPacket::Samples(samples) = &packet {
            self.last = self.meter.feed(samples, self.volume.attenuation_factor());
            self.written += samples.len() as u64;
        }
        let t1 = Instant::now();
        let result = self.inner.write(packet, converter);
        self.meter_time += t1 - t0;
        self.sink_time += t1.elapsed();
        self.packets += 1;
        if self.second.elapsed() >= Duration::from_secs(1) {
            self.report();
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(hz: f32, secs: f32, amp: f32) -> Vec<f64> {
        let n = (SAMPLE_RATE as f32 * secs) as usize;
        (0..n)
            .flat_map(|i| {
                let v = (amp * (2.0 * std::f32::consts::PI * hz * i as f32 / SAMPLE_RATE as f32).sin()) as f64;
                [v, v]
            })
            .collect()
    }

    fn loudest(f: &Frame) -> usize {
        (0..BANDS).max_by(|a, b| f.bands[*a].total_cmp(&f.bands[*b])).unwrap()
    }

    #[test]
    fn a_low_tone_lands_low_and_a_high_tone_lands_high() {
        let mut m = Meter::new();
        let low = m.feed(&sine(80.0, 0.1, 0.8), 1.0);
        let mut m = Meter::new();
        let high = m.feed(&sine(6000.0, 0.1, 0.8), 1.0);
        eprintln!("80 Hz  -> band {} {:?}", loudest(&low), low.bands);
        eprintln!("6 kHz  -> band {} {:?}", loudest(&high), high.bands);
        assert!(loudest(&low) <= 3, "80 Hz should be in the first bands");
        assert!(loudest(&high) >= 11, "6 kHz should be in the top bands");
        assert!(low.bands[loudest(&low)] > 0.85, "a loud tone should read near full scale");
    }

    #[test]
    fn the_volume_is_taken_back_out() {
        let mut m = Meter::new();
        let full = m.feed(&sine(440.0, 0.1, 0.5), 1.0);
        let mut m = Meter::new();
        let quiet: Vec<f64> = sine(440.0, 0.1, 0.5).iter().map(|s| s * 0.1).collect();
        let back = m.feed(&quiet, 0.1);
        assert!((full.peak - back.peak).abs() < 0.01, "{} vs {}", full.peak, back.peak);
    }

    #[test]
    fn silence_reads_as_nothing() {
        let mut m = Meter::new();
        let f = m.feed(&vec![0.0; 4096], 1.0);
        assert_eq!(f.peak, 0.0);
        assert!(f.bands.iter().all(|b| *b == 0.0));
    }

    #[test]
    fn measuring_a_minute_of_sound_is_cheap() {
        // Packets the size librespot sends (about 1600 values), a minute of them.
        let tone = sine(440.0, 60.0, 0.5);
        let mut m = Meter::new();
        let t = Instant::now();
        let mut packets = 0;
        for chunk in tone.chunks(1628) {
            m.feed(chunk, 0.7);
            packets += 1;
        }
        let per_packet = t.elapsed().as_micros() as f64 / packets as f64;
        let packet_ms = 1628.0 / (SAMPLE_RATE as f64 * 2.0) * 1000.0;
        eprintln!("{packets} packets, {per_packet:.1} us each; one packet is {packet_ms:.1} ms of sound");
        // The meter must take a tiny share of the time a packet lasts.
        assert!(per_packet < packet_ms * 1000.0 * 0.05, "{per_packet} us per packet");
    }
}
