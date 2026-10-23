// Choices that only change how the app looks, kept on this computer like the theme (not in
// settings.rs, which holds what the Rust side needs).
import { useSyncExternalStore } from "react";

export type Pref<T extends string> = { get: () => T; set: (v: T) => void; use: () => T };

/** A choice among `values`, saved under `key`; the default is not saved. */
function pref<T extends string>(key: string, values: readonly T[], fallback: T): Pref<T> {
  const listeners = new Set<() => void>();
  const saved = localStorage.getItem(key) as T | null;
  let current: T = saved && values.includes(saved) ? saved : fallback;
  const get = () => current;
  return {
    get,
    set: (v) => {
      current = v;
      if (v === fallback) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
      listeners.forEach((f) => f());
    },
    use: () =>
      useSyncExternalStore((f) => {
        listeners.add(f);
        return () => listeners.delete(f);
      }, get),
  };
}

/** Lyrics in the player: the sung line under the song's name, the popup of the mic button, both, or neither. */
export type PlayerLyrics = "off" | "line" | "popup" | "both";
export const playerLyrics = pref<PlayerLyrics>("playerLyrics", ["off", "line", "popup", "both"], "both");

/** How big the lyrics are on the song page and in the cinema mode. */
export type LyricsSize = "s" | "m" | "l";
export const lyricsSize = pref<LyricsSize>("lyricsSize", ["s", "m", "l"], "m");

/** The cinema mode opens by itself after 5 minutes without touching the app while music plays. */
export const cinemaAuto = pref<"off" | "on">("cinemaAuto", ["off", "on"], "off");

/** How many times a second the Live bars move: 30, 60, 120, or every frame of the screen. */
export type LiveFps = "30" | "60" | "120" | "screen";
export const liveFps = pref<LiveFps>("liveFps", ["30", "60", "120", "screen"], "60");

/** The lyrics in the cinema mode (the mic there turns them off, the cover goes to the middle). */
export const cinemaLyrics = pref<"off" | "on">("cinemaLyrics", ["off", "on"], "on");
