// The audio meter (Rust meter.rs, "audio-meter" events, 30 a second while sound plays through
// Quackify's own output) and the progress bar mode that turns it on. Frames are kept outside
// React: the bars read them in an animation frame, so 30 events a second render nothing.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type MeterFrame = { peak: number; rms: number; bands: number[] };
export type ProgressMode = "simple" | "wave" | "live";

const SILENT: MeterFrame = { peak: 0, rms: 0, bands: new Array(32).fill(0) };
let last: { frame: MeterFrame; at: number } = { frame: SILENT, at: 0 };
const listeners = new Set<(f: MeterFrame) => void>();

listen<MeterFrame>("audio-meter", ({ payload }) => {
  last = { frame: payload, at: performance.now() };
  listeners.forEach((f) => f(payload));
});

/** The latest frame; silence once none has come for a moment (the output stopped or went away). */
export function meterNow(): MeterFrame {
  return performance.now() - last.at < 250 ? last.frame : SILENT;
}

/** Calls `f` with every frame as it arrives; returns the unsubscribe. */
export function onMeter(f: (frame: MeterFrame) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Loudness as a bar height, 0 to 1, between `floorDb` (nothing) and `topDb` (full). */
export const level = (rms: number, floorDb = -42, topDb = 0) =>
  Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-6)) - floorDb) / (topDb - floorDb)));

/** The progress bar mode saved in settings.rs (the audio output depends on it). */
export function useProgressMode(): ProgressMode {
  const [mode, setMode] = useState<ProgressMode>("simple");
  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<{ settings: { progress_mode?: ProgressMode } }>("settings_get").then(
        (v) => alive && setMode(v.settings.progress_mode ?? "simple"),
        () => {},
      );
    load();
    const off = listen("settings-changed", load);
    return () => {
      alive = false;
      off.then((f) => f());
    };
  }, []);
  return mode;
}
