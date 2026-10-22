// The sleep timer: pauses after 15, 30 or 60 minutes, or when what is playing ends. The player
// bar shows it in episode mode, and the song's menu offers it for music too. Not kept across
// restarts: a timer from yesterday has nothing to do with today.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { play } from "../api/spotify";
import type { MenuItem } from "../components/ContextMenu";
import type { Player } from "./player";
import { toast } from "./toast";

export type Sleep = { kind: "at"; at: number; minutes: number } | { kind: "end"; uri: string } | null;
export const SLEEP_MINUTES = [15, 30, 60];

/** How close to the end "End of episode" pauses: the player event of the next track comes too late. */
const END_MARGIN_MS = 1200;

let current: Sleep = null;
const listeners = new Set<() => void>();

export function setSleep(s: Sleep) {
  current = s;
  listeners.forEach((f) => f());
}

export function useSleep(): Sleep {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

/** "30 min", "12 min" left, or "End". */
export function sleepLabel(s: Sleep): string {
  if (!s) return "";
  if (s.kind === "end") return "End";
  return `${Math.max(1, Math.ceil((s.at - Date.now()) / 60000))} min`;
}

/** The choices, as menu items: the minutes, the end of what plays, and Turn off. */
export function sleepMenu(trackUri: string | null, episode: boolean): MenuItem[] {
  const s = current;
  return [
    ...SLEEP_MINUTES.map((m) => ({
      label: `${m} minutes`,
      checked: s?.kind === "at" && s.minutes === m,
      onClick: () => setSleep({ kind: "at", at: Date.now() + m * 60000, minutes: m }),
    })),
    {
      label: episode ? "End of episode" : "End of song",
      checked: s?.kind === "end",
      disabled: !trackUri,
      onClick: () => trackUri && setSleep({ kind: "end", uri: trackUri }),
    },
    ...(s ? ["separator" as const, { label: "Turn off timer", onClick: () => setSleep(null) }] : []),
  ];
}

/** Mounted once (the player bar): pauses when the timer runs out. */
export function useSleepTimer(player: Player) {
  const s = useSleep();
  const uri = player.track?.uri ?? null;
  // The player object changes every render; the timer reads the latest without restarting.
  const ref = useRef(player);
  ref.current = player;

  useEffect(() => {
    if (!s) return;
    const fire = () => {
      setSleep(null);
      play.pause().catch(toast);
      toast("Sleep timer: paused");
    };
    if (s.kind === "at") {
      const id = window.setTimeout(fire, Math.max(0, s.at - Date.now()));
      return () => clearTimeout(id);
    }
    // End of what plays: near its end, or as soon as something else starts.
    if (uri !== s.uri) return fire();
    const id = window.setInterval(() => {
      const p = ref.current;
      const d = p.track?.duration_ms ?? 0;
      if (p.playing && d > 0 && p.position() >= d - END_MARGIN_MS) fire();
    }, 250);
    return () => clearInterval(id);
  }, [s, uri]);
}
