// Whether things are in the user's library (liked songs, saved albums and playlists, followed
// artists). Every component asking about a URI in the same tick shares one lookup, in batches
// of 50, and a toggle shows at once and rolls back if Spotify refuses it.
import { useEffect, useState } from "react";
import { areSaved, save, unsave } from "../api/library";
import { toast } from "./toast";

const BATCH = 50;
const known = new Map<string, boolean>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let flushScheduled = false;

const notify = () => listeners.forEach((l) => l());

/** Called when the library changes, so lists of it can reload. */
const libraryListeners = new Set<() => void>();
export const notifyLibraryChanged = () => libraryListeners.forEach((l) => l());

export function onLibraryChanged(listener: () => void): () => void {
  libraryListeners.add(listener);
  return () => libraryListeners.delete(listener);
}

function request(uri: string) {
  if (known.has(uri) || waiting.has(uri)) return;
  waiting.add(uri);
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(async () => {
    flushScheduled = false;
    const uris = [...waiting];
    waiting.clear();
    for (let i = 0; i < uris.length; i += BATCH) {
      const chunk = uris.slice(i, i + BATCH);
      try {
        const answers = await areSaved(chunk);
        chunk.forEach((u, j) => known.set(u, answers[j] ?? false));
      } catch {
        // Unknown stays unknown; a later render asks again.
      }
    }
    notify();
  }, 0);
}

export async function setSaved(uri: string, value: boolean) {
  const before = known.get(uri);
  known.set(uri, value);
  notify();
  try {
    await (value ? save([uri]) : unsave([uri]));
    libraryListeners.forEach((l) => l());
  } catch (e) {
    if (before === undefined) known.delete(uri);
    else known.set(uri, before);
    notify();
    toast(e);
  }
}

/** [saved (undefined while unknown), toggle]. */
export function useSaved(uri: string | null | undefined): [boolean | undefined, () => void] {
  const [, render] = useState(0);
  useEffect(() => {
    const l = () => render((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (uri) request(uri);
  }, [uri]);
  const value = uri ? known.get(uri) : undefined;
  return [value, () => uri && setSaved(uri, !value)];
}
