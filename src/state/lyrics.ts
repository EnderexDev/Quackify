// The lyrics of a track, as the song page, the line under the player's title and the lyrics popup
// all show them: one loader (the API caches by track) and one rule for the line being sung.
import { useEffect, useState } from "react";
import { clearCache, lyrics as loadLyrics } from "../api/spotify";
import type { Lyrics } from "../api/types";

export type LyricsState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed"; retry: () => void }
  /** `lyrics` null: the song has none on Spotify. */
  | { status: "ready"; lyrics: Lyrics | null };

/** The lyrics of `uri`; episodes and local files have none. */
export function useLyrics(uri: string | null): LyricsState {
  const [loaded, setLoaded] = useState<{ uri: string; lyrics: Lyrics | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uri || !uri.startsWith("spotify:track:")) return;
    let alive = true;
    loadLyrics(uri).then(
      (lyrics) => alive && setLoaded({ uri, lyrics, failed: false }),
      () => alive && setLoaded({ uri, lyrics: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [uri, attempt]);

  if (!uri) return { status: "none" };
  if (!uri.startsWith("spotify:track:")) return { status: "ready", lyrics: null };
  if (!loaded || loaded.uri !== uri) return { status: "loading" };
  if (loaded.failed)
    return {
      status: "failed",
      retry: () => {
        clearCache(`lyrics:${uri}`);
        setLoaded(null);
        setAttempt((n) => n + 1);
      },
    };
  return { status: "ready", lyrics: loaded.lyrics };
}

/** The line being sung at `positionMs`, or -1 (before the first line, or not synced). */
export function activeLine(l: Lyrics | null, positionMs: number): number {
  let active = -1;
  if (!l?.synced) return active;
  for (let i = 0; i < l.lines.length && l.lines[i].start_ms <= positionMs; i++) active = i;
  return active;
}
