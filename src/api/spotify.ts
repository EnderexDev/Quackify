// Calls into the Rust side. Reads go through a short in-memory cache so going back to a page
// is instant; a failed read is dropped from the cache so the next visit retries.
import { invoke } from "@tauri-apps/api/core";
import * as n from "./normalize";
import type { Artist, Collection, Home, LibraryFilter, LibraryPage, SearchResults } from "./types";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Drops cached reads: all of them, or those whose key starts with `prefix`. */
export function clearCache(prefix?: string) {
  if (!prefix) return cache.clear();
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

function query(op: string, variables: Record<string, unknown>): Promise<unknown> {
  return invoke("spotify_query", { op, variables });
}

export const PAGE_SIZE = 100;

export function getHome(): Promise<Home> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return cached("home", async () =>
    n.toHome(
      await query("home", {
        timeZone,
        sp_t: "",
        facet: "",
        sectionItemsLimit: 10,
        includeEpisodeContentRatingsV2: false,
        homeEndUserIntegration: "INTEGRATION_WEB_PLAYER",
      }),
    ),
  );
}

export function search(term: string): Promise<SearchResults> {
  return cached(`search:${term}`, async () =>
    n.toSearch(
      await query("searchDesktop", {
        searchTerm: term,
        offset: 0,
        limit: 10,
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAlbumPreReleases: false,
        includeAuthors: false,
        includeEpisodeContentRatingsV2: false,
      }),
    ),
  );
}

export function library(filter: LibraryFilter, offset = 0): Promise<LibraryPage> {
  return cached(`library:${filter}:${offset}`, async () =>
    n.toLibrary(
      await query("libraryV3", {
        filters: filter ? [filter] : [],
        order: null,
        textFilter: "",
        features: ["LIKED_SONGS"],
        limit: 50,
        offset,
        flatten: false,
        expandedFolders: [],
        folderUri: null,
        includeFoldersWhenFlattening: true,
      }),
    ),
  );
}

/** One page of a playlist, album or Liked Songs, header included. */
export function collection(uri: string, offset = 0): Promise<Collection> {
  return cached(`collection:${uri}:${offset}`, async () => {
    const kind = n.kindOf(uri);
    if (kind === "album") {
      return n.toAlbum(await query("getAlbum", { uri, locale: "", offset, limit: PAGE_SIZE }));
    }
    if (kind === "liked") {
      return n.toLiked(await query("fetchLibraryTracks", { offset, limit: PAGE_SIZE }));
    }
    return n.toPlaylist(
      await query("fetchPlaylist", {
        uri,
        offset,
        limit: PAGE_SIZE,
        enableWatchFeedEntrypoint: false,
        includeEpisodeContentRatingsV2: false,
      }),
    );
  });
}

export function artist(uri: string): Promise<Artist> {
  return cached(`artist:${uri}`, async () =>
    n.toArtist(await query("queryArtistOverview", { uri, locale: "", includePrerelease: false })),
  );
}

// Playback.
export type Repeat = "off" | "all" | "one";

export const play = {
  context: (contextUri: string, trackUri?: string) =>
    invoke("spotify_play_context", { contextUri, trackUri: trackUri ?? null }),
  tracks: (uris: string[], index: number) => invoke("spotify_play_tracks", { uris, index }),
  pause: () => invoke("spotify_pause"),
  resume: () => invoke("spotify_resume"),
  next: () => invoke("spotify_next"),
  previous: () => invoke("spotify_previous"),
  seek: (positionMs: number) => invoke("spotify_seek", { positionMs: Math.max(0, Math.round(positionMs)) }),
  volume: (volume: number) => invoke("spotify_set_volume", { volume }),
  shuffle: (on: boolean) => invoke("spotify_set_shuffle", { on }),
  repeat: (repeat: Repeat) => invoke("spotify_set_repeat", { repeat }),
  addToQueue: (uri: string) => invoke("spotify_add_to_queue", { uri }),
  skipTo: (uri: string, uid: string) => invoke("spotify_skip_to", { uri, uid }),
};
