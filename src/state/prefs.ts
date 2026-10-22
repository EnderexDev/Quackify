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
