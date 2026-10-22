// The player as React state, following Spotify Connect: whatever device is active (this app,
// the phone, the desktop app), this shows what it plays and the controls drive it.
// The account's cluster (Rust "connect" events) is the truth; while this app is the active
// device, its own player events give a tighter clock.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { play, type Repeat } from "../api/spotify";
import type { Named } from "../api/types";
import { flush, observe } from "./listening";
import { toast } from "./toast";

export type NowPlaying = {
  uri: string;
  name: string;
  artists: Named[];
  album: Named;
  image: string | null;
  duration_ms: number;
};

export type Device = {
  id: string;
  name: string;
  kind: string;
  volume: number;
  is_active: boolean;
  is_local: boolean;
};

type Playback = {
  track_uri: string;
  context_uri: string | null;
  index: number | null;
  is_playing: boolean;
  position_ms: number;
  duration_ms: number;
  shuffle: boolean;
  repeat: Repeat;
  next_tracks: QueuedTrack[];
  prev_tracks: QueuedTrack[];
};

export type QueuedTrack = { uri: string; uid: string; provider: string };

type ConnectView = {
  local_device_id: string;
  active_device_id: string | null;
  devices: Device[];
  playback: Playback | null;
};

type LocalEvent =
  | { kind: "loading"; uri: string }
  | { kind: "playing" | "paused" | "seeked"; uri: string; position_ms: number }
  | { kind: "stopped" }
  | { kind: "unavailable"; uri: string };

export type Player = {
  track: NowPlaying | null;
  /** Context the current track plays from, as the pages name it. */
  contextUri: string | null;
  /** Row of the current track inside its context. */
  index: number | null;
  playing: boolean;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  devices: Device[];
  /** What plays next on the active device. */
  queue: QueuedTrack[];
  /** Songs played before, the latest first (kept across restarts). */
  history: QueuedTrack[];
  /** The device playing now, if it is not this app. */
  remoteDevice: Device | null;
  /** Current position in ms, extrapolated while playing. */
  position: () => number;
  toggle: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  setShuffle: (on: boolean) => void;
  cycleRepeat: () => void;
  transfer: (deviceId: string) => void;
};

const PlayerContext = createContext<Player | null>(null);

/** What plays next, as of the last render: for work that outlives the component that began
 * it (a drop or a peek closes before the songs it added show in the queue). */
let liveQueue: QueuedTrack[] = [];
export const currentQueue = () => liveQueue;

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error("usePlayer outside PlayerProvider");
  return p;
}

/** Liked Songs plays as the user's collection; the pages call it spotify:collection:tracks. */
const pageUri = (uri: string | null) => (uri && /^spotify:user:[^:]+:collection$/.test(uri) ? "spotify:collection:tracks" : uri);

/** How long a volume the user just picked is kept over cluster reads. */
const VOLUME_HOLD_MS = 3000;
/** The fastest volume commands go out while dragging or scrolling. */
const VOLUME_SEND_MS = 80;

const HISTORY_KEY = "recentlyPlayed";
const HISTORY_SIZE = 50;
const MIN_PLAYED_MS = 3000;

/** `record` off (the mini player's window): this copy only shows and drives the player; the
 * main window's keeps the history, so nothing is counted twice. */
export function PlayerProvider({ children, record = true }: { children: ReactNode; record?: boolean }) {
  const [track, setTrack] = useState<NowPlaying | null>(null);
  // What played before, the latest first, kept across restarts: each song that gives way to
  // another goes on top. (Spotify's own list of previous tracks leaves out queued songs.)
  const [history, setHistory] = useState<QueuedTrack[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const lastTrack = useRef<{ uri: string; since: number; recorded: boolean } | null>(null);
  useEffect(() => {
    const uri = track?.uri ?? null;
    const prev = lastTrack.current;
    if (!record || (prev && prev.uri === uri)) return;
    // A song goes on the list when it gives way: to another song, or to nothing playing (a
    // stop, the app closing). One swapped within seconds was not really played: Spotify relinks
    // a song to another version of it right as it starts, and a skip that fast is not a listen.
    if (prev && !prev.recorded && Date.now() - prev.since >= MIN_PLAYED_MS) {
      prev.recorded = true;
      setHistory((h) => {
        const next = [{ uri: prev.uri, uid: `h${Date.now()}`, provider: "history" }, ...h.filter((x) => x.uri !== prev.uri)].slice(
          0,
          HISTORY_SIZE,
        );
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    }
    // Nothing playing keeps the last song in mind (already listed), so it is not listed twice.
    if (uri) lastTrack.current = { uri, since: Date.now(), recorded: false };
  }, [track?.uri]);
  const [view, setView] = useState<ConnectView | null>(null);
  const [playing, setPlaying] = useState(false);
  // Optimistic values shown until the next cluster read confirms them.
  const [pending, setPending] = useState<{ shuffle?: boolean; repeat?: Repeat; volume?: number }>({});
  const clock = useRef({ ms: 0, at: performance.now(), running: false });
  const viewRef = useRef<ConnectView | null>(null);
  // Bumped by events, per kind: a snapshot field requested before a newer event of its kind
  // must not overwrite it, but the other fields still apply.
  const viewVersion = useRef(0);
  const trackVersion = useRef(0);
  const resyncRef = useRef<() => void>(() => {});
  // A volume just picked wins over cluster reads for a moment: those can still carry the
  // volume from before (or from the middle of a drag), which would make the slider jump back.
  const volumeHeldUntil = useRef(0);
  // Volume commands go out at most every VOLUME_SEND_MS; the last value always goes.
  const volumeQueued = useRef<number | null>(null);
  const volumeTimer = useRef(0);

  const setClock = (ms: number, running: boolean) => {
    clock.current = { ms, at: performance.now(), running };
  };
  const localIsActive = () => {
    const v = viewRef.current;
    return !v || !v.active_device_id || v.active_device_id === v.local_device_id;
  };

  useEffect(() => {
    // The local listening history hears each change of song, place or state (state/listening.ts).
    const sample = () => {
      const pb = viewRef.current?.playback;
      if (!pb || !record) return;
      const c = clock.current;
      observe({
        context: pageUri(pb.context_uri),
        track: pb.track_uri,
        index: pb.index,
        pos: c.running ? c.ms + (performance.now() - c.at) : c.ms,
        dur: pb.duration_ms,
        playing: c.running,
        shuffle: pb.shuffle,
        now: Date.now(),
      });
    };
    const applyView = (v: ConnectView) => {
      viewRef.current = v;
      setView(v);
      setPending((p) =>
        p.volume !== undefined && performance.now() < volumeHeldUntil.current ? { volume: p.volume } : {},
      );
      if (v.playback) {
        setPlaying(v.playback.is_playing);
        setClock(v.playback.position_ms, v.playback.is_playing);
        sample();
      } else if (v.active_device_id === null) {
        setPlaying(false);
        clock.current.running = false;
      }
    };
    // The whole state from Rust; ignored if any event arrived while it was on the way.
    const resync = () => {
      const askedView = viewVersion.current;
      const askedTrack = trackVersion.current;
      invoke<{ connect: ConnectView; now_playing: NowPlaying | null }>("spotify_player_state")
        .then((s) => {
          if (viewVersion.current === askedView) applyView(s.connect);
          if (trackVersion.current === askedTrack && s.now_playing) setTrack(s.now_playing);
        })
        .catch(() => {});
    };
    resyncRef.current = resync;
    const offs = [
      listen<ConnectView>("connect", ({ payload }) => {
        viewVersion.current++;
        applyView(payload);
      }),
      listen<NowPlaying>("now-playing", ({ payload }) => {
        trackVersion.current++;
        setTrack(payload);
      }),
      listen<LocalEvent>("player-event", ({ payload: e }) => {
        viewVersion.current++;
        if (e.kind === "unavailable") {
          toast("A track is not available, skipping it.");
          return;
        }
        if (!localIsActive()) return;
        switch (e.kind) {
          case "loading":
            setClock(0, false);
            break;
          case "playing":
            setPlaying(true);
            setClock(e.position_ms, true);
            break;
          case "paused":
            setPlaying(false);
            setClock(e.position_ms, false);
            break;
          case "seeked":
            setClock(e.position_ms, clock.current.running);
            break;
          case "stopped":
            setPlaying(false);
            setClock(0, false);
            break;
        }
        // Only an event about the song the cluster shows: one for the next song can come first,
        // and would put the place of the song before at 0:00.
        if (e.kind !== "loading" && e.kind !== "stopped" && e.uri === viewRef.current?.playback?.track_uri) sample();
      }),
    ];
    // Listen first, then read the snapshot, so nothing slips between the two.
    Promise.all(offs).then(resync);
    // Closing to the tray hides the window without unloading it: both count what played so far.
    const onLeave = () => record && flush();
    const onHide = () => record && document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onHide);
      offs.forEach((o) => o.then((f) => f()));
    };
  }, []);

  const pb = view?.playback ?? null;
  const active = view?.devices.find((d) => d.is_active) ?? null;
  const local = view?.devices.find((d) => d.is_local) ?? null;
  const remoteDevice = active && !active.is_local ? active : null;
  const duration = track?.duration_ms || pb?.duration_ms || 0;
  const repeat = pending.repeat ?? pb?.repeat ?? "off";

  // A command that failed leaves the optimistic values wrong: drop them and re-read the truth.
  const failed = (e: unknown) => {
    toast(e);
    setPending({});
    resyncRef.current();
  };

  liveQueue = pb?.next_tracks ?? [];
  const value: Player = {
    track,
    contextUri: pageUri(pb?.context_uri ?? null),
    index: pb?.index ?? null,
    playing,
    volume: pending.volume ?? (active ?? local)?.volume ?? 0.5,
    shuffle: pending.shuffle ?? pb?.shuffle ?? false,
    repeat,
    devices: view?.devices ?? [],
    queue: pb?.next_tracks ?? [],
    history,
    remoteDevice,
    position: () => {
      const c = clock.current;
      const ms = c.running ? c.ms + (performance.now() - c.at) : c.ms;
      return duration ? Math.min(ms, duration) : ms;
    },
    toggle: () => {
      if (!track) return;
      setPlaying(!playing);
      if (playing) setClock(value.position(), false);
      else setClock(clock.current.ms, true);
      (playing ? play.pause() : play.resume()).catch(failed);
    },
    seek: (ms) => {
      setClock(ms, clock.current.running);
      play.seek(ms).catch(failed);
    },
    setVolume: (v) => {
      v = Math.min(1, Math.max(0, v));
      setPending((p) => ({ ...p, volume: v }));
      volumeHeldUntil.current = performance.now() + VOLUME_HOLD_MS;
      volumeQueued.current = v;
      if (volumeTimer.current) return;
      const send = () => {
        const next = volumeQueued.current;
        volumeQueued.current = null;
        if (next === null) {
          volumeTimer.current = 0;
          return;
        }
        play.volume(next).catch(failed);
        volumeTimer.current = window.setTimeout(send, VOLUME_SEND_MS);
      };
      send();
    },
    setShuffle: (on) => {
      setPending((p) => ({ ...p, shuffle: on }));
      play.shuffle(on).catch(failed);
    },
    cycleRepeat: () => {
      const next: Repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
      setPending((p) => ({ ...p, repeat: next }));
      play.repeat(next).catch(failed);
    },
    transfer: (deviceId) => {
      invoke("spotify_transfer", { deviceId }).catch(failed);
    },
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
