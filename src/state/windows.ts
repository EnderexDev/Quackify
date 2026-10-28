// The extra views over the music: the mini player (a second window, mini.rs) and the cinema mode
// (the main window in full screen). Both windows load this same page; the mini player's is told
// apart by its label.
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "./toast";

/** This page is the mini player's window. */
export const isMini = getCurrentWindow().label === "mini";
/** This page is the installer or update window (setup.rs), in place of the app. */
export const isSetup = getCurrentWindow().label === "setup";

export const toggleMini = () => invoke("mini_player_toggle").catch(toast);

/** Whether the mini player is open, kept up to date (it can close from itself or the tray). */
export function useMiniOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const off = listen<boolean>("mini-player", ({ payload }) => setOpen(payload));
    invoke<boolean>("mini_player_is_open").then((o) => alive && setOpen(o), () => {});
    return () => {
      alive = false;
      off.then((f) => f());
    };
  }, []);
  return open;
}

// The cinema mode: one switch for the whole main window.
let cinema = false;
const cinemaListeners = new Set<() => void>();

export function setCinema(on: boolean) {
  if (on === cinema) return;
  cinema = on;
  cinemaListeners.forEach((f) => f());
  getCurrentWindow()
    .setFullscreen(on)
    .catch(() => {});
}

export const toggleCinema = () => setCinema(!cinema);

export const useCinema = () =>
  useSyncExternalStore(
    (f) => {
      cinemaListeners.add(f);
      return () => cinemaListeners.delete(f);
    },
    () => cinema,
  );
