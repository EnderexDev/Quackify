// Quackify's own audio output, for the Wave and Live progress bars: a librespot sink on cpal with
// the meter in the output callback, so what it measures is what leaves the speakers (librespot's
// rodio output keeps up to 400 ms of sound queued, too far ahead for bars on the beat). The
// player writes into a short queue; the callback resamples it to the device's rate, the same
// linear way rodio does, and keeps the last samples played for the meter. A thread reads them
// 30 times a second and sends the levels to the window as "audio-meter".
//
// The Simple bar keeps librespot's rodio output untouched: this one only runs in Wave and Live.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use librespot_playback::audio_backend::{Sink, SinkError, SinkResult};
use librespot_playback::convert::Converter;
use librespot_playback::decoder::AudioPacket;
use librespot_playback::mixer::VolumeGetter;
use librespot_playback::{NUM_CHANNELS, SAMPLE_RATE};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const BANDS: usize = 16;
/// Mono samples per spectrum: 46 ms of sound, bins about 22 Hz apart (1024 left the lowest bands
/// sharing the same two bins).
const FFT: usize = 2048;
const LOW_HZ: f32 = 50.0;
const HIGH_HZ: f32 = 16_000.0;
/// How often the levels go to the window.
const FRAME_EVERY: Duration = Duration::from_millis(33);
/// Peak and loudness are read over the sound of one frame.
const RECENT: usize = (SAMPLE_RATE as usize * 33) / 1000;
/// Most sound queued between the player and the device: 200 ms (interleaved values).
const QUEUE_MAX: usize = SAMPLE_RATE as usize * NUM_CHANNELS as usize / 5;
/// The longest a stop waits for the queued sound to finish playing.
const DRAIN_MAX: Duration = Duration::from_millis(1500);

/// What the meter hears in one moment, with the volume taken back out.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Frame {
    pub peak: f32,
    pub rms: f32,
    /// 0 (silence, -60 dB or less) to 1 (full scale), low to high.
    pub bands: [f32; BANDS],
}

/// The last FFT mono samples played, and the spectrum of them.
#[derive(Clone)]
pub struct Meter {
    ring: Vec<f32>,
    at: usize,
}

impl Meter {
    pub fn new() -> Self {
        Self { ring: vec![0.0; FFT], at: 0 }
    }

    fn push(&mut self, mono: f32) {
        self.ring[self.at] = mono;
        self.at = (self.at + 1) % FFT;
    }

    /// Takes interleaved stereo samples already scaled by `volume` and measures them.
    #[cfg(test)]
    pub fn feed(&mut self, samples: &[f64], volume: f64) -> Frame {
        for pair in samples.chunks_exact(NUM_CHANNELS as usize) {
            self.push(((pair[0] + pair[1]) * 0.5) as f32);
        }
        let n = samples.len() / NUM_CHANNELS as usize;
        self.frame(volume, n.clamp(1, FFT))
    }

    /// The levels of the last `recent` samples and the spectrum of the last FFT, with `volume`
    /// (what the player scaled them by) taken back out.
    pub fn frame(&self, volume: f64, recent: usize) -> Frame {
        let undo = if volume > 0.001 { (1.0 / volume) as f32 } else { 0.0 };
        let ordered: Vec<f32> = (0..FFT).map(|i| self.ring[(self.at + i) % FFT] * undo).collect();
        let tail = &ordered[FFT - recent.min(FFT)..];
        let peak = tail.iter().fold(0f32, |m, s| m.max(s.abs()));
        let rms = (tail.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>() / tail.len().max(1) as f64).sqrt() as f32;
        Frame { peak, rms, bands: spectrum(&ordered) }
    }
}

fn spectrum(ordered: &[f32]) -> [f32; BANDS] {
    let window = |i: usize| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT as f32).cos();
    let mut re: Vec<f32> = ordered.iter().enumerate().map(|(i, s)| s * window(i)).collect();
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

/// What the player thread, the device's callback and the meter thread share.
struct Shared {
    /// Interleaved stereo at librespot's rate, waiting for the device.
    queue: VecDeque<f32>,
    /// Where the device is between the first two queued frames (0..1), when resampling.
    frac: f64,
    meter: Meter,
    /// Between start and stop: an empty queue then is a gap in the sound.
    running: bool,
    underruns: u32,
}

/// The output for Wave and Live: cpal with the meter in the callback.
pub struct OutputSink {
    shared: Arc<Mutex<Shared>>,
    stream: cpal::Stream,
    alive: Arc<AtomicBool>,
}

fn sink_error(e: impl std::fmt::Display) -> SinkError {
    SinkError::OnWrite(format!("Quackify output: {e}"))
}

impl OutputSink {
    /// Opens the default output device; an error leaves the caller to fall back to rodio.
    pub fn open(app: AppHandle, volume: Box<dyn VolumeGetter + Send>) -> Result<Self, String> {
        let device = cpal::default_host().default_output_device().ok_or("no output device")?;
        let supported = device.default_output_config().map_err(|e| e.to_string())?;
        if supported.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!("the device wants {:?} samples", supported.sample_format()));
        }
        let config: cpal::StreamConfig = supported.into();
        let channels = config.channels as usize;
        let step = SAMPLE_RATE as f64 / config.sample_rate.0 as f64;

        let shared = Arc::new(Mutex::new(Shared {
            queue: VecDeque::with_capacity(QUEUE_MAX * 2),
            frac: 0.0,
            meter: Meter::new(),
            running: false,
            underruns: 0,
        }));
        let feed = shared.clone();
        let stream = device
            .build_output_stream(
                &config,
                move |out: &mut [f32], _| {
                    let Ok(mut s) = feed.lock() else { return out.fill(0.0) };
                    fill(&mut s, out, channels, step);
                },
                |e| eprintln!("[output] stream error: {e}"),
                None,
            )
            .map_err(|e| e.to_string())?;
        stream.pause().map_err(|e| e.to_string())?;
        eprintln!("[output] {} Hz, {} channels", config.sample_rate.0, channels);

        let alive = Arc::new(AtomicBool::new(true));
        spawn_reader(app, shared.clone(), alive.clone(), volume);
        Ok(Self { shared, stream, alive })
    }
}

/// The device's callback: the queued sound at the device's rate, each played frame to the meter.
fn fill(s: &mut Shared, out: &mut [f32], channels: usize, step: f64) {
    let same_rate = (step - 1.0).abs() < 1e-9;
    for frame in out.chunks_mut(channels) {
        let frames = s.queue.len() / 2;
        // Linear resampling looks one frame ahead.
        if frames < if same_rate { 1 } else { 2 } {
            if s.running && frames == 0 {
                s.underruns += 1;
            }
            frame.fill(0.0);
            continue;
        }
        let t = s.frac as f32;
        let (l, r) = if same_rate {
            (s.queue[0], s.queue[1])
        } else {
            (s.queue[0] * (1.0 - t) + s.queue[2] * t, s.queue[1] * (1.0 - t) + s.queue[3] * t)
        };
        match channels {
            1 => frame[0] = (l + r) * 0.5,
            _ => {
                frame[0] = l;
                frame[1] = r;
                frame[2..].fill(0.0);
            }
        }
        s.frac += step;
        while s.frac >= 1.0 && s.queue.len() >= 2 {
            let (a, b) = (s.queue.pop_front().unwrap_or(0.0), s.queue.pop_front().unwrap_or(0.0));
            s.meter.push((a + b) * 0.5);
            s.frac -= 1.0;
        }
    }
}

/// Reads the meter 30 times a second while sound plays and sends it to the window; one silent
/// frame when it stops, so the bars fall.
fn spawn_reader(app: AppHandle, shared: Arc<Mutex<Shared>>, alive: Arc<AtomicBool>, volume: Box<dyn VolumeGetter + Send>) {
    thread::spawn(move || {
        let mut was_running = false;
        let mut logged = Instant::now();
        while alive.load(Ordering::Relaxed) {
            thread::sleep(FRAME_EVERY);
            let (snapshot, running, underruns) = {
                let Ok(mut s) = shared.lock() else { return };
                let u = std::mem::take(&mut s.underruns);
                (s.running.then(|| s.meter.clone()), s.running, u)
            };
            if underruns > 0 && logged.elapsed() >= Duration::from_secs(1) {
                // Frames the device asked for while the queue was empty: a gap you can hear.
                eprintln!("[output] underrun: {underruns} frames of silence");
                logged = Instant::now();
            }
            match snapshot {
                Some(m) => {
                    let _ = app.emit("audio-meter", m.frame(volume.attenuation_factor(), RECENT));
                }
                None if was_running => {
                    let _ = app.emit("audio-meter", Frame::default());
                }
                None => {}
            }
            was_running = running;
        }
    });
}

impl Drop for OutputSink {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}

impl Sink for OutputSink {
    fn start(&mut self) -> SinkResult<()> {
        if let Ok(mut s) = self.shared.lock() {
            s.running = true;
        }
        self.stream.play().map_err(sink_error)
    }

    fn stop(&mut self) -> SinkResult<()> {
        // Let what is queued play out, as rodio's sink does, then pause the device.
        let until = Instant::now() + DRAIN_MAX;
        while Instant::now() < until && self.shared.lock().map(|s| s.queue.len() > 2).unwrap_or(false) {
            thread::sleep(Duration::from_millis(5));
        }
        if let Ok(mut s) = self.shared.lock() {
            s.running = false;
            s.queue.clear();
            s.frac = 0.0;
        }
        self.stream.pause().map_err(sink_error)
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        let samples = packet.samples().map_err(|e| sink_error(e.to_string()))?;
        let samples = converter.f64_to_f32(samples);
        // Wait while the device has enough queued: the player must not decode far ahead.
        loop {
            {
                let mut s = self.shared.lock().map_err(|_| sink_error("lock poisoned"))?;
                if s.queue.len() < QUEUE_MAX {
                    s.queue.extend(samples.iter().copied());
                    return Ok(());
                }
            }
            thread::sleep(Duration::from_millis(5));
        }
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

    fn shared() -> Shared {
        Shared { queue: VecDeque::new(), frac: 0.0, meter: Meter::new(), running: true, underruns: 0 }
    }

    #[test]
    fn a_low_tone_lands_low_and_a_high_tone_lands_high() {
        let mut m = Meter::new();
        let low = m.feed(&sine(80.0, 0.1, 0.8), 1.0);
        let mut m = Meter::new();
        let high = m.feed(&sine(6000.0, 0.1, 0.8), 1.0);
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
    fn at_the_same_rate_the_sound_passes_unchanged() {
        let mut s = shared();
        s.queue.extend([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        let mut out = vec![0.0; 6];
        fill(&mut s, &mut out, 2, 1.0);
        assert_eq!(out, vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        assert!(s.queue.is_empty());
        assert_eq!(s.underruns, 0);
    }

    #[test]
    fn resampling_to_48k_keeps_the_pitch_and_the_level() {
        // One second of 1 kHz at 44.1 kHz, played at 48 kHz: 48000 frames of the same tone.
        let mut s = shared();
        s.queue.extend(sine(1000.0, 1.0, 0.5).iter().map(|v| *v as f32));
        let step = SAMPLE_RATE as f64 / 48_000.0;
        let mut out = vec![0.0; 47_000 * 2];
        fill(&mut s, &mut out, 2, step);
        let left: Vec<f32> = out.iter().step_by(2).copied().collect();
        let crossings = left.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
        // 47000 frames at 48 kHz is 0.979 s: about 979 cycles.
        assert!((975..=983).contains(&crossings), "{crossings} cycles");
        let peak = left.iter().fold(0f32, |m, v| m.max(v.abs()));
        assert!(peak > 0.49 && peak <= 0.5, "peak {peak}");
    }

    #[test]
    fn an_empty_queue_while_playing_counts_as_a_gap() {
        let mut s = shared();
        let mut out = vec![1.0; 8];
        fill(&mut s, &mut out, 2, 1.0);
        assert!(out.iter().all(|v| *v == 0.0));
        assert_eq!(s.underruns, 4);
        s.running = false;
        fill(&mut s, &mut out, 2, 1.0);
        assert_eq!(s.underruns, 4, "stopped, silence is not a gap");
    }

    #[test]
    fn the_meter_hears_what_was_played() {
        let mut s = shared();
        s.queue.extend(sine(80.0, 0.1, 0.8).iter().map(|v| *v as f32));
        let mut out = vec![0.0; 4410 * 2];
        fill(&mut s, &mut out, 2, 1.0);
        let f = s.meter.frame(1.0, RECENT);
        assert!(loudest(&f) <= 3 && f.peak > 0.7, "{f:?}");
    }

    #[test]
    fn measuring_is_cheap() {
        let mut m = Meter::new();
        m.feed(&sine(440.0, 0.1, 0.5), 0.7);
        let t = Instant::now();
        for _ in 0..300 {
            m.frame(0.7, RECENT);
        }
        let per = t.elapsed().as_micros() as f64 / 300.0;
        // 30 frames a second: each must take a tiny share of its 33 ms.
        assert!(per < 33_000.0 * 0.05, "{per} us per frame");
    }
}
