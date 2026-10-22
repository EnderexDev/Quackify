// The local listening history (spec "Pra agora" and "Continuar"): which album, playlist,
// artist or podcast played, when and for how long, and where each one was left. Kept on this
// computer. It grows from the player's events, never from a timer: timers brake while the
// window is minimized, which is how most listening happens.
import { useSyncExternalStore } from "react";

/** A stretch of one context playing: when it began and how much of it was heard. */
export type Session = { c: string; t: number; end: number; ms: number };

/** Where a context was left: its song, row, position and when. */
export type Spot = {
  track: string;
  index: number | null;
  pos: number;
  dur: number;
  shuffle: boolean;
  at: number;
};

export type Log = { sessions: Session[]; spots: Record<string, Spot> };

/** What the player shows at one moment; `now` is the wall clock (Date.now). */
export type Sample = {
  context: string | null;
  track: string;
  index: number | null;
  pos: number;
  dur: number;
  playing: boolean;
  shuffle: boolean;
  now: number;
};

const KEY = "listening";
const MAX_SESSIONS = 2000;
const MAX_SPOTS = 60;
const KEEP_DAYS = 120;
/** A pause longer than this starts a new session of the same context. */
const SESSION_GAP_MS = 30 * 60 * 1000;
/** Past the end of the song it was on, a span counts this much at most (events can be late). */
const SPAN_SLACK_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The contexts worth remembering: not a station, a search or loose songs. */
export const remembered = (uri: string | null): uri is string =>
  !!uri && (/^spotify:(playlist|album|artist|show):/.test(uri) || uri === "spotify:collection:tracks");

// ---- Recording ----

/** Adds one sample to the log, returning the new log (the old one is not changed). `last` is
 * the sample before it, the one this one closes. */
export function record(log: Log, last: Sample | null, s: Sample): Log {
  const sessions = [...log.sessions];
  const spots = { ...log.spots };
  if (last) {
    // What played since the last sample, when it was playing: wall time, but never past the
    // end of the song it was on (a sleeping PC, an event that came late).
    const heard = last.playing ? Math.max(0, Math.min(s.now - last.now, Math.max(0, last.dur - last.pos) + SPAN_SLACK_MS)) : 0;
    if (heard > 0 && remembered(last.context)) {
      const top = sessions[sessions.length - 1];
      if (top && top.c === last.context && last.now - top.end <= SESSION_GAP_MS) {
        sessions[sessions.length - 1] = { ...top, end: last.now + heard, ms: top.ms + heard };
      } else {
        sessions.push({ c: last.context, t: last.now, end: last.now + heard, ms: heard });
      }
    }
    // Leaving a context, or its songs for one outside it (a queued song, autoplay): it was left
    // where the clock had got to, not where the next thing starts.
    const leaving = last.context !== s.context || (s.index === null && last.track !== s.track);
    if (leaving && remembered(last.context) && last.index !== null) {
      spots[last.context] = spotOf(last, reached(last, s.now), s.now);
    }
  }
  if (remembered(s.context) && s.index !== null) {
    // The last song ending with nothing after it shows as paused at 0:00: it was heard to the end.
    const ranOut = last && last.track === s.track && last.playing && !s.playing && s.pos < 1000 && reached(last, s.now) >= last.dur - 2000;
    spots[s.context] = spotOf(s, ranOut ? s.dur : s.pos, s.now);
  }
  return prune({ sessions, spots }, s.now);
}

/** Where the clock of a sample had got to at `now`. */
const reached = (s: Sample, now: number) => Math.min(s.pos + (s.playing ? now - s.now : 0), s.dur || Infinity);

const spotOf = (s: Sample, pos: number, at: number): Spot => ({
  track: s.track,
  index: s.index,
  pos: Math.max(0, Math.round(pos)),
  dur: s.dur,
  shuffle: s.shuffle,
  at,
});

function prune(log: Log, now: number): Log {
  const since = now - KEEP_DAYS * DAY_MS;
  const sessions = log.sessions.filter((x) => x.end >= since).slice(-MAX_SESSIONS);
  const kept = Object.entries(log.spots)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_SPOTS);
  return { sessions, spots: Object.fromEntries(kept) };
}

// ---- For now ----

/** How a session counts towards now: closeness in hour of day and kind of day, fading with age. */
const HOUR_SPREAD = 1.5;
const HOUR_REACH = 3;
const HALF_LIFE_DAYS = 30;
/** A session shorter than this was a skip through, not a listen. */
const MIN_SESSION_MS = 60 * 1000;
/** A session counts at most this much, so one long night does not outweigh the habit. */
const MAX_SESSION_MS = 60 * 60 * 1000;
export const FOR_NOW_MAX = 8;
/** "Usually": a context needs this many different days in the slot. */
const MIN_DAYS_IN_SLOT = 2;

const weekend = (d: number) => d === 0 || d === 6;
const hourOf = (t: Date) => t.getHours() + t.getMinutes() / 60;
const dayKey = (t: Date) => `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;

export type DayPart = "morning" | "afternoon" | "evening" | "night";
export const dayPart = (h: number): DayPart => (h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night");

/** What the user usually plays around this hour on this kind of day, the strongest first. */
export function forNow(log: Log, now: number): string[] {
  const at = new Date(now);
  const h = hourOf(at);
  const score = new Map<string, number>();
  const days = new Map<string, Set<string>>();
  for (const x of log.sessions) {
    if (x.ms < MIN_SESSION_MS || x.end > now) continue;
    const t = new Date(x.t);
    let dh = Math.abs(hourOf(t) - h);
    dh = Math.min(dh, 24 - dh);
    if (dh > HOUR_REACH) continue;
    const sameKind = weekend(t.getDay()) === weekend(at.getDay());
    if (!sameKind) continue;
    const day = t.getDay() === at.getDay() ? 1.5 : 1;
    const age = (now - x.end) / DAY_MS;
    const w = Math.exp(-(dh * dh) / (2 * HOUR_SPREAD * HOUR_SPREAD)) * day * 0.5 ** (age / HALF_LIFE_DAYS);
    score.set(x.c, (score.get(x.c) ?? 0) + (w * Math.min(x.ms, MAX_SESSION_MS)) / 60000);
    if (!days.has(x.c)) days.set(x.c, new Set());
    days.get(x.c)!.add(dayKey(t));
  }
  return [...score.entries()]
    .filter(([c]) => (days.get(c)?.size ?? 0) >= MIN_DAYS_IN_SLOT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, FOR_NOW_MAX)
    .map(([c]) => c);
}

/** The first weeks: until the history covers this long and this many days, For now stays out. */
const READY_SPAN_DAYS = 7;
const READY_DAYS = 5;
/** For now shows with at least this many things for the hour, or not at all. */
export const FOR_NOW_MIN = 3;

export function historyReady(log: Log, now: number): boolean {
  const heard = log.sessions.filter((x) => x.ms >= MIN_SESSION_MS);
  if (!heard.length || now - heard[0].t < READY_SPAN_DAYS * DAY_MS) return false;
  return new Set(heard.map((x) => dayKey(new Date(x.t)))).size >= READY_DAYS;
}

// ---- Continue ----

/** Continue keeps what was left in the last this many days. */
const CONTINUE_DAYS = 30;
/** Past this far in its first song, a context counts as started. */
const STARTED_MS = 30 * 1000;
/** This close to the end of the last song is finished. */
const END_MS = 15 * 1000;

/** Albums, playlists and Liked Songs left halfway, the latest first. Artists and podcasts are
 * out: an artist has no end, and a podcast's episodes carry their own place. */
export function leftHalfway(log: Log, now: number): [string, Spot][] {
  return Object.entries(log.spots)
    .filter(([c]) => /^spotify:(playlist|album):|^spotify:collection:tracks$/.test(c))
    .filter(([, s]) => s.index !== null && now - s.at <= CONTINUE_DAYS * DAY_MS)
    .filter(([, s]) => (s.index ?? 0) > 0 || s.pos >= STARTED_MS)
    .sort((a, b) => b[1].at - a[1].at);
}

/** Whether a spot is at the very end of its context, once its length is known. Not told while
 * shuffling: the last row is not the last song heard then. */
export const finished = (s: Spot, total: number) =>
  !s.shuffle && s.index !== null && s.index >= total - 1 && s.pos >= s.dur - END_MS;

// ---- The store ----

function read(): Log {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || !Array.isArray(v.sessions) || typeof v.spots !== "object" || !v.spots) return { sessions: [], spots: {} };
    return { sessions: v.sessions, spots: v.spots };
  } catch {
    return { sessions: [], spots: {} };
  }
}

let log: Log = read();
let last: Sample | null = null;
const listeners = new Set<() => void>();

/** Feeds one moment of the player into the history (state/player.tsx calls it on each event). */
export function observe(s: Sample) {
  const prev = last;
  last = s;
  // Nothing moved: the same song, state and place as expected from the last one.
  if (
    prev &&
    prev.context === s.context &&
    prev.track === s.track &&
    prev.playing === s.playing &&
    prev.index === s.index &&
    prev.dur === s.dur &&
    prev.shuffle === s.shuffle &&
    Math.abs(prev.pos + (prev.playing ? s.now - prev.now : 0) - s.pos) < 2000
  ) {
    last = prev;
    return;
  }
  commit(record(log, prev, s));
}

/** Counts what played since the last event, as the app closes. */
export function flush(now = Date.now()) {
  if (!last?.playing) return;
  const s = { ...last, pos: reached(last, now), now };
  commit(record(log, last, s));
  last = s;
}

function commit(next: Log) {
  log = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    // Storage full: the history stays in memory for this run.
  }
  listeners.forEach((f) => f());
}

export function useListening(): Log {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => log,
  );
}
