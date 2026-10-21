// Keyboard shortcuts, close to Spotify's on Windows, and the dialog listing them (Ctrl+/).
import { useEffect, useState } from "react";
import { play } from "../api/spotify";
import { setSaved } from "../state/saved";
import { areSaved } from "../api/library";
import type { Nav } from "../state/nav";
import type { Player } from "../state/player";
import { toast } from "../state/toast";
import { Dialog } from "./Dialog";
import { NEW_PLAYLIST_EVENT } from "./Sidebar";

type Panel = "queue" | "nowplaying" | null;

const SEEK_STEP_MS = 5000;
const VOLUME_STEP = 0.1;

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Space", what: "Play / pause" },
  { keys: "Ctrl + →", what: "Next" },
  { keys: "Ctrl + ←", what: "Previous" },
  { keys: "Shift + →", what: "Seek forward 5 seconds" },
  { keys: "Shift + ←", what: "Seek back 5 seconds" },
  { keys: "Ctrl + ↑", what: "Volume up" },
  { keys: "Ctrl + ↓", what: "Volume down" },
  { keys: "Ctrl + S", what: "Shuffle" },
  { keys: "Ctrl + R", what: "Repeat" },
  { keys: "Alt + Shift + B", what: "Like the song playing" },
  { keys: "Ctrl + N", what: "New playlist" },
  { keys: "Ctrl + K  or  Ctrl + L", what: "Search" },
  { keys: "Alt + ←  /  Alt + →", what: "Go back / forward" },
  { keys: "Alt + Shift + H", what: "Home" },
  { keys: "Alt + Shift + Q", what: "Queue" },
  { keys: "Alt + Shift + R", what: "Now playing view" },
  { keys: "Alt + Shift + J", what: "Lyrics" },
  { keys: "Ctrl + P", what: "Settings" },
  { keys: "Ctrl + A", what: "Select every song of a list" },
  { keys: "Delete", what: "Remove the selected songs from your playlist" },
  { keys: "Ctrl + /", what: "This list" },
];

/** Listens for the shortcuts; returns whether the list is open and how to close it. */
export function useShortcuts(player: Player, nav: Nav, panel: Panel, togglePanel: (p: Exclude<Panel, null>) => void) {
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
      // Space and Enter on a focused button press that button, not play/pause.
      const onControl = (e.target as HTMLElement)?.closest?.("button, a, [role=switch], [role=button]");
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const act = (f: () => void) => {
        e.preventDefault();
        f();
      };
      if (ctrl && (e.key === "/" || e.code === "Slash")) return act(() => setListOpen((o) => !o));
      if (ctrl && key === "p") return act(() => nav.go({ page: "settings" }));
      if (ctrl && key === "n") return act(() => window.dispatchEvent(new Event(NEW_PLAYLIST_EVENT)));
      if (e.altKey && e.shiftKey) {
        if (e.code === "KeyQ") return act(() => togglePanel("queue"));
        if (e.code === "KeyR") return act(() => togglePanel("nowplaying"));
        if (e.code === "KeyH") return act(() => nav.go({ page: "home" }));
        if (e.code === "KeyJ") return act(() => (nav.route.page === "lyrics" ? nav.back() : nav.go({ page: "lyrics" })));
        if (e.code === "KeyB" && player.track?.uri.startsWith("spotify:track:")) {
          const uri = player.track.uri;
          return act(() =>
            areSaved([uri]).then(([saved]) => {
              setSaved(uri, !saved);
              toast(saved ? "Removed from Liked Songs" : "Added to Liked Songs");
            }, toast),
          );
        }
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") return act(() => nav.back());
      if (e.altKey && e.key === "ArrowRight") return act(() => nav.forward());
      if (typing) return;
      if (e.code === "Space" && !onControl) return act(() => player.toggle());
      if (!player.track) return;
      if (ctrl && e.key === "ArrowRight") return act(() => play.next().catch(toast));
      if (ctrl && e.key === "ArrowLeft") return act(() => play.previous().catch(toast));
      if (ctrl && e.key === "ArrowUp") return act(() => player.setVolume(Math.min(1, player.volume + VOLUME_STEP)));
      if (ctrl && e.key === "ArrowDown") return act(() => player.setVolume(Math.max(0, player.volume - VOLUME_STEP)));
      if (e.shiftKey && e.key === "ArrowRight") return act(() => player.seek(player.position() + SEEK_STEP_MS));
      if (e.shiftKey && e.key === "ArrowLeft") return act(() => player.seek(Math.max(0, player.position() - SEEK_STEP_MS)));
      if (ctrl && key === "s") return act(() => player.setShuffle(!player.shuffle));
      if (ctrl && key === "r") return act(() => player.cycleRepeat());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, nav, panel, togglePanel]);
  return { listOpen, closeList: () => setListOpen(false) };
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcuts-list">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="shortcut-row">
            <span>{s.what}</span>
            <kbd>{s.keys}</kbd>
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
