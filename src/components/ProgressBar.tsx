// The player's progress bar, in the three modes of Settings: Simple (the line), Wave (the song's
// waveform in thin bars, the played part white) and Live (bars born in the middle that reach for
// the ends with the sound, low notes in the centre). Wave and Live draw on a canvas over the
// slider, which still takes the clicks and drags. While another device plays, it is Simple:
// Quackify does not hear that device's sound.
import { useEffect, useRef } from "react";
import { level, meterNow, onMeter, type ProgressMode } from "../state/meter";
import { Slider } from "./Slider";

/** Bars of a waveform, across the whole song. */
const WAVE_BINS = 120;
const WAVE_PREFIX = "wave:";
const WAVE_INDEX = "waveIndex";
/** Songs whose waveform is kept; the least recently played goes first. */
const WAVE_KEEP = 300;
/** Live: bands per side (the meter's 16), mirrored around the middle. */
const LIVE_BANDS = 16;
/** Live: how much of its height a bar keeps per frame after the sound drops (about 300 ms to nothing). */
const LIVE_DECAY = 0.82;

const PLAYED = "rgba(255, 255, 255, 0.95)";
const AHEAD = "rgba(255, 255, 255, 0.3)";

export function ProgressBar({
  uri,
  duration,
  position,
  playing,
  mode,
  disabled,
  onSeek,
}: {
  uri: string | null;
  duration: number;
  position: () => number;
  playing: boolean;
  mode: ProgressMode;
  disabled: boolean;
  onSeek: (ms: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Read by the drawing loop, which outlives renders.
  const live = useRef({ position, duration, playing });
  live.current = { position, duration, playing };

  // The waveform of the song playing: loaded when it starts, grown while it plays, saved when it
  // changes, every few seconds, and when the window closes.
  const wave = useRef<{ uri: string; bins: Float32Array; dirty: boolean } | null>(null);
  useEffect(() => {
    if (mode !== "wave" || !uri) return;
    const w = { uri, bins: loadWave(uri), dirty: false };
    wave.current = w;
    const flush = () => {
      if (!w.dirty) return;
      saveWave(w.uri, w.bins);
      w.dirty = false;
    };
    const off = onMeter((f) => {
      const { position, duration, playing } = live.current;
      if (!playing || !duration) return;
      const i = Math.min(WAVE_BINS - 1, Math.floor((position() / duration) * WAVE_BINS));
      // Music sits between about -30 and -6 dB: that range fills the bar, so loud and quiet parts differ.
      const v = level(f.rms, -30, -6);
      if (v > w.bins[i]) {
        w.bins[i] = v;
        w.dirty = true;
      }
    });
    const timer = window.setInterval(flush, 15000);
    window.addEventListener("beforeunload", flush);
    return () => {
      off();
      clearInterval(timer);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [mode, uri]);

  // The drawing loop, only in Wave and Live; it rests while the window is hidden.
  useEffect(() => {
    if (mode === "simple") return;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const heights = new Float32Array(LIVE_BANDS * 2);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { position, duration } = live.current;
      const played = duration ? Math.min(1, position() / duration) * w : 0;
      if (mode === "wave") drawWave(ctx, w, h, played, wave.current?.bins ?? null);
      else drawLive(ctx, w, h, played, heights, live.current.playing);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <div className={`progress progress-${mode}`}>
      {mode !== "simple" && <canvas ref={canvas} className="progress-canvas" aria-hidden />}
      <Slider value={duration ? position() / duration : 0} onCommit={(f) => onSeek(f * duration)} disabled={disabled} />
    </div>
  );
}

/** Thin bars, as tall as the song is loud there; a stub where it has not been heard yet. */
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, played: number, bins: Float32Array | null) {
  const step = w / WAVE_BINS;
  const bar = Math.max(1, step * 0.55);
  const mid = h / 2;
  for (let i = 0; i < WAVE_BINS; i++) {
    const v = bins ? bins[i] : 0;
    const bh = Math.max(2, v * (h - 2));
    const x = i * step + (step - bar) / 2;
    ctx.fillStyle = x + bar / 2 <= played ? PLAYED : AHEAD;
    roundBar(ctx, x, mid - bh / 2, bar, bh);
  }
}

/** Bars from the middle out, mirrored: band 0 (the lows) at the centre, the highs at the ends. */
function drawLive(ctx: CanvasRenderingContext2D, w: number, h: number, played: number, heights: Float32Array, playing: boolean) {
  const bands = playing ? meterNow().bands : null;
  const n = LIVE_BANDS * 2;
  const step = w / n;
  const bar = Math.max(1.5, step * 0.5);
  const mid = h / 2;
  for (let j = 0; j < LIVE_BANDS; j++) {
    // The highs read low on the meter: a boost growing towards them, only in the picture.
    const raw = bands ? bands[j] : 0;
    const target = Math.min(1, Math.max(0, (raw - 0.25) / 0.75) * (1 + (0.9 * j) / (LIVE_BANDS - 1)));
    for (const i of [LIVE_BANDS - 1 - j, LIVE_BANDS + j]) {
      heights[i] = Math.max(target, heights[i] * LIVE_DECAY);
      if (heights[i] < 0.02) continue;
      const bh = heights[i] * (h - 2);
      const x = i * step + (step - bar) / 2;
      ctx.fillStyle = x + bar / 2 <= played ? PLAYED : AHEAD;
      roundBar(ctx, x, mid - bh / 2, bar, bh);
    }
  }
}

function roundBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(w / 2, h / 2));
  ctx.fill();
}

/** A waveform saved as one base-36 digit per bar. */
function loadWave(uri: string): Float32Array {
  const bins = new Float32Array(WAVE_BINS);
  const saved = localStorage.getItem(WAVE_PREFIX + uri);
  if (saved && saved.length === WAVE_BINS) for (let i = 0; i < WAVE_BINS; i++) bins[i] = parseInt(saved[i], 36) / 35 || 0;
  return bins;
}

function saveWave(uri: string, bins: Float32Array) {
  const text = Array.from(bins, (v) => Math.round(Math.min(1, v) * 35).toString(36)).join("");
  let index: string[] = [];
  try {
    index = JSON.parse(localStorage.getItem(WAVE_INDEX) ?? "[]");
  } catch {}
  index = [uri, ...index.filter((u) => u !== uri)];
  for (const old of index.splice(WAVE_KEEP)) localStorage.removeItem(WAVE_PREFIX + old);
  try {
    localStorage.setItem(WAVE_PREFIX + uri, text);
    localStorage.setItem(WAVE_INDEX, JSON.stringify(index));
  } catch {
    // Storage full: the waveform is simply not kept.
  }
}
