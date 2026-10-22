// The player's progress bar, in the three modes of Settings: Simple (the line), Wave (the song's
// waveform in thin bars, the played part white) and Live (thin bars across the whole bar that
// move with the sound, the lows in the middle, tapering to dots at the ends). Wave and Live draw
// on a canvas over the slider, which still takes the clicks and drags. While another device
// plays, it is Simple: Quackify does not hear that device's sound.
import { useEffect, useRef } from "react";
import { level, meterNow, onMeter, type ProgressMode } from "../state/meter";
import { Slider } from "./Slider";

/** Bars of a waveform, across the whole song. */
const WAVE_BINS = 120;
const WAVE_PREFIX = "wave:";
const WAVE_INDEX = "waveIndex";
/** Songs whose waveform is kept; the least recently played goes first. */
const WAVE_KEEP = 300;
/** Wave: a saved bar counts as this many readings, so a new play refines it without wiping it. */
const WAVE_SAVED_WEIGHT = 4;
/** Wave: past this many readings a bar keeps learning, but slowly. */
const WAVE_MAX_WEIGHT = 40;
/** Live: about one bar every this many pixels, mirrored around the middle. */
const LIVE_PITCH = 5;
/** Live: a bar rises at once and falls by this share per frame (about 300 ms to nothing). */
const LIVE_FALL = 0.82;
/**
 * Live: each band is read against its own recent quietest and loudest (they drift back towards
 * the band by this much per frame, about 5 s to forget), since the lows sit around 0.6 on the
 * meter and the highs around 0.2.
 */
const LIVE_ADAPT = 0.0015;
/** Live: a band whose loudest stays under this is silence (the top octave of many songs). */
const LIVE_QUIET = 0.08;

const PLAYED = "rgba(255, 255, 255, 0.95)";
const AHEAD = "rgba(255, 255, 255, 0.32)";

/** `version` goes up with every change to `bins`, so the drawing knows when to redraw. */
type Wave = { uri: string; bins: Float32Array; weight: Float32Array; dirty: boolean; version: number };

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
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Read by the drawing loop, which outlives renders.
  const live = useRef({ position, duration, playing });
  live.current = { position, duration, playing };

  // The waveform of the song playing: loaded when it starts, grown while it plays (each bar the
  // average loudness of its stretch of the song), saved when it changes, every few seconds, and
  // when the window closes.
  const wave = useRef<Wave | null>(null);
  useEffect(() => {
    if (mode !== "wave" || !uri) {
      // Nothing playing: no waveform left from the song before.
      wave.current = null;
      return;
    }
    const bins = loadWave(uri);
    const w: Wave = { uri, bins, weight: bins.map((v) => (v > 0 ? WAVE_SAVED_WEIGHT : 0)), dirty: false, version: 0 };
    wave.current = w;
    const flush = () => {
      if (!w.dirty) return;
      saveWave(w.uri, w.bins);
      w.dirty = false;
    };
    const off = onMeter((f) => {
      const { position, duration, playing } = live.current;
      if (!playing || !duration || f.rms <= 0) return;
      const i = Math.min(WAVE_BINS - 1, Math.floor((position() / duration) * WAVE_BINS));
      // Music sits between about -36 and -6 dB; the drawing stretches each song to its own range.
      const v = level(f.rms, -36, -6);
      const n = Math.min(w.weight[i], WAVE_MAX_WEIGHT);
      w.bins[i] = (w.bins[i] * n + v) / (n + 1);
      w.weight[i] = n + 1;
      w.dirty = true;
      w.version++;
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

  // The drawing loop, only in Wave and Live. It draws only when something changed (where the
  // song is, the size, the waveform, the sound), so a paused bar costs nothing; the browser
  // stops it while the window is hidden.
  useEffect(() => {
    if (mode === "simple") return;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let heights = new Float32Array(0);
    const range = { lo: new Float32Array(0), hi: new Float32Array(0) };
    let sounding = false;
    // What the canvas shows now: a Wave frame's inputs, or "idle" for a cleared Live bar.
    let shown = "";
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        // Resizing clears the canvas.
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        shown = "";
      }
      const { position, duration, playing } = live.current;
      const played = duration ? Math.min(1, position() / duration) * w : 0;
      if (mode === "wave") {
        const wv = wave.current;
        const inputs = `${Math.round(played * 2)}:${wv?.uri ?? ""}:${wv?.version ?? 0}`;
        if (inputs === shown) return;
        shown = inputs;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return drawWave(ctx, w, h, played, wv?.bins ?? null);
      }
      const half = Math.max(8, Math.floor(w / LIVE_PITCH / 2));
      if (heights.length !== half) heights = new Float32Array(half);
      const bands = normalize(playing ? meterNow().bands : null, range);
      if (!bands && shown === "idle") return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const loud = drawLive(ctx, w, h, played, heights, bands);
      shown = loud ? "" : "idle";
      // While there is sound the bars are the bar; without it, the line comes back.
      if (loud !== sounding) {
        sounding = loud;
        box.current?.classList.toggle("sounding", loud);
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      box.current?.classList.remove("sounding");
    };
  }, [mode]);

  return (
    <div className={`progress progress-${mode}`} ref={box}>
      {mode !== "simple" && <canvas ref={canvas} className="progress-canvas" aria-hidden />}
      <Slider value={duration ? position() / duration : 0} onCommit={(f) => onSeek(f * duration)} disabled={disabled} />
    </div>
  );
}

/**
 * Thin bars as tall as the song is loud there, stretched to the song's own quietest and loudest
 * parts so its shape shows; a short stub where it has not been heard yet.
 */
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, played: number, bins: Float32Array | null) {
  let lo = 1;
  let hi = 0;
  if (bins)
    for (const v of bins)
      if (v > 0) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  const span = hi - lo;
  const step = w / WAVE_BINS;
  const bar = Math.max(1.5, step * 0.5);
  const mid = h / 2;
  for (let i = 0; i < WAVE_BINS; i++) {
    const v = bins ? bins[i] : 0;
    let bh = 2;
    if (v > 0) {
      const t = span > 0.04 ? (v - lo) / span : 0.6;
      bh = Math.max(3, (0.14 + 0.86 * Math.pow(t, 1.6)) * (h - 2));
    }
    const x = i * step + (step - bar) / 2;
    ctx.fillStyle = x + bar / 2 <= played ? PLAYED : AHEAD;
    roundBar(ctx, x, mid - bh / 2, bar, bh);
  }
}

/** Each band as 0 to 1 between its own recent quietest and loudest; null without sound. */
function normalize(bands: number[] | null, range: { lo: Float32Array; hi: Float32Array }): number[] | null {
  if (!bands || !bands.some((b) => b > 0)) return null;
  if (range.lo.length !== bands.length) {
    range.lo = Float32Array.from(bands, (b) => Math.max(0, b - 0.1));
    range.hi = Float32Array.from(bands, (b) => b + 0.1);
  }
  return bands.map((b, i) => {
    range.lo[i] = Math.min(b, range.lo[i] + LIVE_ADAPT);
    range.hi[i] = Math.max(b, range.hi[i] - LIVE_ADAPT);
    if (range.hi[i] < LIVE_QUIET) return 0;
    return Math.min(1, Math.max(0, (b - range.lo[i]) / Math.max(0.12, range.hi[i] - range.lo[i])));
  });
}

/**
 * Bars from the middle out, mirrored: the lows at the centre, the highs towards the ends, each
 * bar reading the band at its distance (in between, a blend of the two nearest). They taper
 * towards the ends and stand as dots while the sound is quiet. Returns whether any sound shows.
 */
function drawLive(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  played: number,
  heights: Float32Array,
  bands: number[] | null,
): boolean {
  const half = heights.length;
  const step = w / (half * 2);
  const bar = Math.max(1.5, Math.min(2.5, step * 0.45));
  const mid = h / 2;
  const dot = 2.5 / (h - 2);
  const sound = !!bands && bands.some((b) => b > 0);
  for (let k = 0; k < half; k++) {
    const d = k / (half - 1);
    let target = 0;
    if (sound) {
      const at = d * (bands!.length - 1);
      const a = Math.floor(at);
      const raw = bands![a] + (bands![Math.min(a + 1, bands!.length - 1)] - bands![a]) * (at - a);
      target = (0.1 + 0.9 * Math.pow(raw, 1.4)) * (1 - 0.5 * d * d);
    }
    heights[k] = Math.max(target, heights[k] * LIVE_FALL);
  }
  if (!sound && heights.every((v) => v < 0.01)) return false;
  for (let k = 0; k < half; k++) {
    const bh = Math.max(dot, heights[k]) * (h - 2);
    for (const x0 of [w / 2 - (k + 1) * step, w / 2 + k * step]) {
      const x = x0 + (step - bar) / 2;
      ctx.fillStyle = x + bar / 2 <= played ? PLAYED : AHEAD;
      roundBar(ctx, x, mid - bh / 2, bar, bh);
    }
  }
  return true;
}

function roundBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(w / 2, h / 2));
  ctx.fill();
}

/** A waveform saved as one base-36 digit per bar; a song played again moves to the front of the kept ones. */
export function loadWave(uri: string): Float32Array {
  const bins = new Float32Array(WAVE_BINS);
  const saved = localStorage.getItem(WAVE_PREFIX + uri);
  if (saved && saved.length === WAVE_BINS) {
    for (let i = 0; i < WAVE_BINS; i++) bins[i] = parseInt(saved[i], 36) / 35 || 0;
    keepRecent(uri);
  }
  return bins;
}

function saveWave(uri: string, bins: Float32Array) {
  const text = Array.from(bins, (v) => Math.round(Math.min(1, v) * 35).toString(36)).join("");
  try {
    localStorage.setItem(WAVE_PREFIX + uri, text);
    keepRecent(uri);
  } catch {
    // Storage full: the waveform is simply not kept.
  }
}

/** Puts `uri` first among the kept waveforms and drops the oldest past WAVE_KEEP. */
function keepRecent(uri: string) {
  let index: string[] = [];
  try {
    index = JSON.parse(localStorage.getItem(WAVE_INDEX) ?? "[]");
  } catch {}
  index = [uri, ...index.filter((u) => u !== uri)];
  for (const old of index.splice(WAVE_KEEP)) localStorage.removeItem(WAVE_PREFIX + old);
  try {
    localStorage.setItem(WAVE_INDEX, JSON.stringify(index));
  } catch {}
}
