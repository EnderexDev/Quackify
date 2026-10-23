// What is being dragged right now (songs, or a whole album, playlist or artist), so the player
// bar can turn into the queue's drop zones and the sidebar can mark the playlists that take it.
// A drag's data cannot be read before the drop, so sources say what they carry here.
import { useEffect, useState } from "react";
import { artist, collection, PAGE_SIZE, play, type QueueRef } from "../api/spotify";
import type { Kind } from "../api/types";
import { QUEUE_LIMIT, TRACKS_MIME } from "../components/menus";
import { peeking } from "./peek";
import type { QueuedTrack } from "./player";

/** The drag data type for a card or a library item: its URI. */
export const CONTEXT_MIME = "application/x-quackify-context";

export type DragItem = { kind: "tracks"; uris: string[]; label: string } | { kind: "context"; uri: string; cardKind: Kind; label: string };

let current: DragItem | null = null;
const listeners = new Set<(d: DragItem | null) => void>();
const set = (d: DragItem | null) => {
  current = d;
  listeners.forEach((f) => f(d));
};

/** Called by a source in its dragstart, after it filled the dataTransfer. */
export function beginDrag(item: DragItem) {
  set(item);
}

// A drag ends with a drop anywhere or a cancel; the drop handlers run first, then this.
for (const type of ["dragend", "drop"]) document.addEventListener(type, () => setTimeout(() => current && set(null)), true);

/** The drag under way, if it is one of ours. */
export function useDrag(): DragItem | null {
  const [d, setD] = useState(current);
  useEffect(() => {
    listeners.add(setD);
    return () => {
      listeners.delete(setD);
    };
  }, []);
  return d;
}

/** Whether a drop event carries something of ours. */
export const carriesSongs = (e: React.DragEvent) => e.dataTransfer.types.includes(TRACKS_MIME) || e.dataTransfer.types.includes(CONTEXT_MIME);

/** The kinds a card can be dragged as: those whose songs can be listed. */
export const DRAGGABLE = new Set<Kind>(["playlist", "album", "liked", "artist", "track", "episode"]);

/** The dataTransfer and the drag state for a card or a library item. */
export function dragCard(e: React.DragEvent, c: { uri: string; kind: Kind; title: string }) {
  // A card held open in a peek is not dragged.
  if (peeking()) return e.preventDefault();
  e.dataTransfer.effectAllowed = "copy";
  if (c.kind === "track" || c.kind === "episode") {
    e.dataTransfer.setData(TRACKS_MIME, JSON.stringify([c.uri]));
    beginDrag({ kind: "tracks", uris: [c.uri], label: c.title });
  } else {
    e.dataTransfer.setData(CONTEXT_MIME, c.uri);
    beginDrag({ kind: "context", uri: c.uri, cardKind: c.kind, label: c.title });
  }
  e.dataTransfer.setData("text/plain", c.title);
}

/** A drop's data, read at once: the event is gone after the first await. */
export function readDrop(e: React.DragEvent): { dataTransfer: DataTransfer } {
  const data = new Map([TRACKS_MIME, CONTEXT_MIME].map((t) => [t, e.dataTransfer.getData(t)]));
  return { dataTransfer: { getData: (t: string) => data.get(t) ?? "" } as DataTransfer };
}

/**
 * The songs a drop carries, at most `limit`: the songs dragged, an album's or a playlist's
 * playable songs a page at a time, or an artist's popular songs.
 */
export async function droppedSongs(e: { dataTransfer: DataTransfer }, limit = QUEUE_LIMIT): Promise<string[]> {
  const tracks = e.dataTransfer.getData(TRACKS_MIME);
  if (tracks) {
    try {
      const parsed: unknown = JSON.parse(tracks);
      if (Array.isArray(parsed)) return parsed.filter((u): u is string => typeof u === "string" && /^spotify:(track|episode):\w+$/.test(u)).slice(0, limit);
    } catch {
      // Not ours after all.
    }
    return [];
  }
  return songsOf(e.dataTransfer.getData(CONTEXT_MIME), limit);
}

/** The playable songs of an album, a playlist or Liked Songs (a page at a time), or an
 * artist's popular songs, at most `limit`. */
export async function songsOf(uri: string, limit = QUEUE_LIMIT): Promise<string[]> {
  if (/^spotify:artist:\w+$/.test(uri)) return (await artist(uri)).topTracks.filter((t) => t.playable).map((t) => t.uri).slice(0, limit);
  if (!/^spotify:(album|playlist):\w+$|^spotify:collection:tracks$/.test(uri)) return [];
  const out: string[] = [];
  for (let offset = 0; out.length < limit; offset += PAGE_SIZE) {
    const page = await collection(uri, offset);
    out.push(...page.tracks.filter((t) => t.playable).map((t) => t.uri));
    if (page.tracks.length < PAGE_SIZE || offset + PAGE_SIZE >= page.total) break;
  }
  return out.slice(0, limit);
}

const ref = (q: QueuedTrack): QueueRef => ({ uid: q.uid, uri: q.uri });

/** One addition at a time: a second one would take the first one's songs for its own. */
let adding: Promise<unknown> = Promise.resolve();

/**
 * Adds songs to the queue: at the end of the songs you added, or with `next` right after the
 * song playing. Spotify only adds at the end, so "next" adds them, waits for them to show in
 * the queue and moves them ahead of the ones that were there. Returns where they went.
 */
export function queueSongs(uris: string[], next: boolean, queue: () => QueuedTrack[]): Promise<"next" | "end"> {
  const run = adding.then(() => addSongs(uris, next, queue));
  adding = run.catch(() => {});
  return run;
}

async function addSongs(uris: string[], next: boolean, queue: () => QueuedTrack[]): Promise<"next" | "end"> {
  const before = queue().filter((q) => q.provider === "queue");
  const had = new Set(before.map((q) => q.uid));
  for (const u of uris) await play.addToQueue(u);
  // Every batch waits for its songs to show before the next one starts: a later batch of the
  // same songs would otherwise take these for its own.
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const now = queue().filter((q) => q.provider === "queue");
    // This batch: new entries of these songs, as many of each as were added.
    const wanted = new Map<string, number>();
    uris.forEach((u) => wanted.set(u, (wanted.get(u) ?? 0) + 1));
    const batch = now.filter((q) => {
      const left = wanted.get(q.uri) ?? 0;
      if (!q.uid || had.has(q.uid) || left === 0) return false;
      wanted.set(q.uri, left - 1);
      return true;
    });
    if (batch.length >= uris.length) {
      if (!next) return "end";
      // The first older song still there: one that played meanwhile is gone. None left: the
      // new songs are next already.
      const anchor = now.find((q) => had.has(q.uid));
      if (anchor) await play.editQueue({ kind: "move", tracks: batch.map(ref), before: ref(anchor) });
      return "next";
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return next && before.length === 0 ? "next" : "end";
}
