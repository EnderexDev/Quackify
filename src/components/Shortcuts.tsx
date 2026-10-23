// Keyboard shortcuts, close to Spotify's on Windows, and the dialog listing them (Ctrl+/).
import { useEffect, useState } from "react";
import { play } from "../api/spotify";
import { setSaved } from "../state/saved";
import { areSaved } from "../api/library";
import type { Panel } from "../App";
import type { Nav } from "../state/nav";
import type { Player } from "../state/player";
import { notify, toast  } from "../state/toast";
import { t } from "../i18n";
import { Dialog } from "./Dialog";
import { newPlaylist } from "../state/newPlaylist";
import { toggleCinema, toggleMini } from "../state/windows";

const SEEK_STEP_MS = 5000;
const VOLUME_STEP = 0.1;

// A function, not a constant: the text is picked when the list is shown, in the language of the moment.
export const shortcutList = (): { keys: string; what: string }[] => [
  { keys: t("Space"), what: t("Play / pause") },
  { keys: "Ctrl + →", what: t("Next") },
  { keys: "Ctrl + ←", what: t("Previous") },
  { keys: "Shift + →", what: t("Seek forward 5 seconds") },
  { keys: "Shift + ←", what: t("Seek back 5 seconds") },
  { keys: "Ctrl + ↑", what: t("Volume up") },
  { keys: "Ctrl + ↓", what: t("Volume down") },
  { keys: "Ctrl + S", what: t("Shuffle") },
  { keys: "Ctrl + R", what: t("Repeat") },
  { keys: "Alt + Shift + B", what: t("Like the song playing") },
  { keys: "Ctrl + N", what: t("New playlist") },
  { keys: t("Ctrl + K  or  Ctrl + L  or  Ctrl + T"), what: t("Search") },
  { keys: "Alt + ←  /  Alt + →", what: t("Go back / forward") },
  { keys: "Alt + Shift + H", what: t("Home") },
  { keys: "Alt + Shift + Q", what: t("Queue") },
  { keys: "Alt + Shift + R", what: t("The song playing, with its lyrics") },
  { keys: "Alt + Shift + J", what: t("Lyrics (the song page)") },
  { keys: "Ctrl + P", what: t("Settings") },
  { keys: "Ctrl + B", what: t("Collapse or expand Your Library") },
  { keys: "F11", what: t("Cinema mode") },
  { keys: "Ctrl + M", what: t("Mini player") },
  { keys: "Ctrl + A", what: t("Select every song of a list") },
  { keys: "Delete", what: t("Remove the selected songs from your playlist") },
  { keys: "Ctrl + /", what: t("This list") },
];

/** Listens for the shortcuts; returns whether the list is open and how to close it. */
export function useShortcuts(
  /** Read at the key press, so the shell does not re-render on every player change. */
  getPlayer: () => Player,
  nav: Nav,
  panel: Panel,
  togglePanel: (p: Exclude<Panel, null>) => void,
  app: { openPalette: () => void; toggleSidebar: () => void },
) {
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const player = getPlayer();
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
      // Like a browser bar, these work from inside a text box too.
      if (ctrl && !e.shiftKey && !e.altKey && (key === "k" || key === "l" || key === "t")) return act(app.openPalette);
      if (ctrl && !e.shiftKey && !e.altKey && key === "b") return act(app.toggleSidebar);
      if (ctrl && key === "p") return act(() => nav.go({ page: "settings" }));
      if (ctrl && key === "n") return act(() => newPlaylist());
      if (ctrl && !e.shiftKey && !e.altKey && key === "m") return act(toggleMini);
      if (e.key === "F11" && !ctrl && !e.altKey && !e.shiftKey) return act(toggleCinema);
      if (e.altKey && e.shiftKey) {
        if (e.code === "KeyQ") return act(() => togglePanel("queue"));
        // R and J both open the song page, where the lyrics now live; again goes back.
        if (e.code === "KeyR" || e.code === "KeyJ") return act(() => (nav.route.page === "song" ? nav.back() : nav.go({ page: "song" })));
        if (e.code === "KeyH") return act(() => nav.go({ page: "home" }));
        if (e.code === "KeyB" && player.track?.uri.startsWith("spotify:track:")) {
          const uri = player.track.uri;
          return act(() =>
            areSaved([uri]).then(([saved]) => {
              setSaved(uri, !saved);
              notify(saved ? t("Removed from Liked Songs") : t("Added to Liked Songs"));
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
  }, [getPlayer, nav, panel, togglePanel, app]);
  return { listOpen, openList: () => setListOpen(true), closeList: () => setListOpen(false) };
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t("Keyboard shortcuts")} onClose={onClose}>
      <div className="shortcuts-list">
        {shortcutList().map((s) => (
          <div key={s.keys} className="shortcut-row">
            <span>{s.what}</span>
            <kbd>{s.keys}</kbd>
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </Dialog>
  );
}
