// Calls into the Rust side. Reads go through a short in-memory cache so going back to a page
// is instant; a failed read is dropped from the cache so the next visit retries.
import { invoke } from "@tauri-apps/api/core";
import * as n from "./normalize";
import type {
  Artist,
  BrowsePage,
  Card,
  CardPage,
  Category,
  Collection,
  Credits,
  Episode,
  EpisodePage,
  Home,
  LibraryFilter,
  LibraryPage,
  LibrarySort,
  Lyrics,
  Profile,
  SearchPage,
  SearchTab,
  SearchResults,
  Show,
  TopContent,
  TrackDetails,
} from "./types";

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

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const INTEGRATION = "INTEGRATION_WEB_PLAYER";
/** How many cards one "Show all" page asks for. */
export const CARD_PAGE_SIZE = 40;

export function getHome(): Promise<Home> {
  const tz = timeZone();
  return cached("home", async () =>
    n.toHome(
      await query("home", {
        timeZone: tz,
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

export type LibraryQuery = { filter: LibraryFilter; sort?: LibrarySort; text?: string; folder?: string | null };

/** One page of Your Library: filtered, sorted, searched, or inside a folder. */
export function library(q: LibraryQuery, offset = 0): Promise<LibraryPage> {
  const { filter, sort = "Recents", text = "", folder = null } = q;
  return cached(`library:${filter}:${sort}:${text}:${folder}:${offset}`, async () =>
    n.toLibrary(
      await query("libraryV3", {
        filters: filter ? [filter] : [],
        order: sort === "Recents" ? null : sort,
        textFilter: text,
        features: ["LIKED_SONGS"],
        limit: 50,
        offset,
        flatten: false,
        expandedFolders: [],
        folderUri: folder,
        includeFoldersWhenFlattening: true,
      }),
    ),
  );
}

export type LibraryCounts = { liked: number; playlists: number; folders: number; albums: number; artists: number; podcasts: number };

/** How many of each kind Your Library holds: one small query per kind. Playlists inside
 * folders count; folders are the flattened list with them minus without them. */
export function libraryCounts(): Promise<LibraryCounts> {
  const total = (filter: LibraryFilter, flatten: boolean, withFolders: boolean) =>
    query("libraryV3", {
      filters: filter ? [filter] : [],
      order: null,
      textFilter: "",
      features: [],
      limit: 1,
      offset: 0,
      flatten,
      expandedFolders: [],
      folderUri: null,
      includeFoldersWhenFlattening: withFolders,
    }).then((d) => ((d as { me?: { libraryV3?: { totalCount?: number } } })?.me?.libraryV3?.totalCount ?? 0) as number);
  return cached("library:counts", async () => {
    const [liked, playlists, withFolders, albums, artists, podcasts] = await Promise.all([
      query("fetchLibraryTracks", { offset: 0, limit: 1 }).then(
        (d) => ((d as { me?: { library?: { tracks?: { totalCount?: number } } } })?.me?.library?.tracks?.totalCount ?? 0) as number,
      ),
      total("Playlists", true, false),
      total("Playlists", true, true),
      total("Albums", false, false),
      total("Artists", false, false),
      total("Podcasts & Shows", false, false),
    ]);
    return { liked, playlists, folders: Math.max(0, withFolders - playlists), albums, artists, podcasts };
  });
}

/** Pins an item to the top of Your Library, or unpins it. */
export async function pinInLibrary(uri: string, pin: boolean): Promise<void> {
  await query(pin ? "pinLibraryItem" : "unpinLibraryItem", { pinnableItemUri: uri });
  clearCache("library:");
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

const SEARCH_OPS = {
  tracks: "searchTracks",
  artists: "searchArtists",
  albums: "searchAlbums",
  playlists: "searchPlaylists",
  podcasts: "searchPodcasts",
  episodes: "searchEpisodes",
  users: "searchUsers",
} as const;
/** How many results one page of a search tab asks for. */
export const SEARCH_PAGE_SIZE = 40;

/** One page of a search tab. */
export function searchTab(tab: Exclude<SearchTab, "all">, term: string, offset = 0): Promise<SearchPage> {
  return cached(`searchTab:${tab}:${term}:${offset}`, async () =>
    n.toSearchPage(
      tab,
      await query(SEARCH_OPS[tab], {
        searchTerm: term,
        offset,
        limit: SEARCH_PAGE_SIZE,
        numberOfTopResults: 20,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAlbumPreReleases: false,
        includeAuthors: false,
        includeEpisodeContentRatingsV2: false,
      }),
      offset,
    ),
  );
}

/** A user's profile; no username: yours. */
export function profile(username: string | null): Promise<Profile> {
  return cached(`profile:${username ?? "me"}`, async () => n.toProfile(await invoke("spotify_user_profile", { username })));
}

/** Your top artists and songs of the last four weeks. */
export function topContent(): Promise<TopContent> {
  return cached("topContent", async () =>
    n.toTopContent(
      await query("userTopContent", {
        includeTopArtists: true,
        topArtistsInput: { offset: 0, limit: 10, sortBy: "AFFINITY", timeRange: "SHORT_TERM" },
        includeTopTracks: true,
        topTracksInput: { offset: 0, limit: 10, sortBy: "AFFINITY", timeRange: "SHORT_TERM" },
      }),
    ),
  );
}

export async function isFollowingUser(uri: string): Promise<boolean> {
  const d = (await query("isFollowingUsers", { uris: [uri] })) as { users?: { following?: boolean }[] };
  return !!d?.users?.[0]?.following;
}

export async function followUser(username: string, follow: boolean): Promise<void> {
  await query(follow ? "followUsers" : "unfollowUsers", { usernames: [username] });
  clearCache("profile:");
}

/** One page of a Home section ("Show all"). */
export function homeSection(uri: string, offset = 0): Promise<CardPage> {
  return cached(`homeSection:${uri}:${offset}`, async () =>
    n.toHomeSection(
      await query("homeSection", {
        includeHomeChapterVideoCards: false,
        uri,
        homeEndUserIntegration: INTEGRATION,
        timeZone: timeZone(),
        sp_t: "",
        sectionItemsOffset: offset,
        sectionItemsLimit: CARD_PAGE_SIZE,
        includeEpisodeContentRatingsV2: false,
      }),
      offset,
    ),
  );
}

/** Search's Browse all: every genre and mood. */
export function browseAll(): Promise<Category[]> {
  return cached("browseAll", async () =>
    n.toBrowseAll(
      await query("browseAll", {
        pagePagination: { offset: 0, limit: 10 },
        sectionPagination: { offset: 0, limit: 99 },
        browseEndUserIntegration: INTEGRATION,
      }),
    ),
  );
}

/** A genre or mood page. */
export function browsePage(uri: string): Promise<BrowsePage> {
  return cached(`browse:${uri}`, async () =>
    n.toBrowsePage(
      await query("browsePage", {
        pagePagination: { offset: 0, limit: 20 },
        sectionPagination: { offset: 0, limit: 10 },
        uri,
        browseEndUserIntegration: INTEGRATION,
        includeEpisodeContentRatingsV2: false,
      }),
    ),
  );
}

/** One page of a genre page's section ("Show all"). */
export function browseSection(uri: string, offset = 0): Promise<CardPage> {
  return cached(`browseSection:${uri}:${offset}`, async () =>
    n.toBrowseSection(
      await query("browseSection", {
        pagination: { offset, limit: CARD_PAGE_SIZE },
        uri,
        browseEndUserIntegration: INTEGRATION,
        includeEpisodeContentRatingsV2: false,
      }),
      offset,
    ),
  );
}

/** One page of an artist's whole discography, newest first. */
export function discography(uri: string, offset = 0): Promise<CardPage> {
  return cached(`discography:${uri}:${offset}`, async () =>
    n.toDiscography(
      await query("queryArtistDiscographyAll", { uri, offset, limit: CARD_PAGE_SIZE, order: "DATE_DESC" }),
      offset,
    ),
  );
}

/** Every "Fans also like" artist. */
export function relatedArtists(uri: string): Promise<CardPage> {
  return cached(`related:${uri}`, async () => n.toRelatedArtists(await query("queryArtistRelated", { uri })));
}

/** The account's recent searches (shared with the other Spotify apps). */
export async function recentSearches(): Promise<Card[]> {
  return n.toRecentSearches(
    await query("recentSearches", { limit: 50, includeAuthors: false, includeEpisodeContentRatingsV2: false }),
  );
}

export async function saveRecentSearch(uri: string): Promise<void> {
  await query("saveRecentSearches", { uris: [uri] });
}

/** Removes these from recent searches. */
export async function removeRecentSearches(uris: string[]): Promise<void> {
  await query("removeRecentSearches", { uris });
}

/** Everyone credited on a song. */
export function credits(trackUri: string): Promise<Credits> {
  return cached(`credits:${trackUri}`, async () =>
    n.toCredits(await query("queryTrackCreditsGroupedModal", { trackUri, contributorsLimit: 100, contributorsOffset: 0 })),
  );
}

/** The playlist Spotify makes from a song ("Go to song radio"). */
export function songRadio(trackUri: string): Promise<string> {
  return invoke<string>("spotify_song_radio", { uri: trackUri });
}

/** How many episodes one page of a show asks for. */
export const EPISODE_PAGE_SIZE = 50;

export function show(uri: string): Promise<Show> {
  return cached(`show:${uri}`, async () =>
    n.toShow(await query("queryShowMetadataV2", { uri, includeContentCapabilityTrait: false, includeEpisodeContentRatingsV2: false })),
  );
}

/** One page of a show's episodes, newest first. */
export function showEpisodes(uri: string, offset = 0): Promise<EpisodePage> {
  return cached(`showEpisodes:${uri}:${offset}`, async () =>
    n.toEpisodePage(
      await query("queryPodcastEpisodes", { uri, offset, limit: EPISODE_PAGE_SIZE, includeEpisodeContentRatingsV2: false }),
      offset,
    ),
  );
}

export async function episode(uri: string): Promise<Episode> {
  const e = n.toSingleEpisode(await query("getEpisodeOrChapter", { uri, includeEpisodeContentRatingsV2: false }));
  if (!e) throw new Error("Spotify did not send this episode.");
  return e;
}

/** The track's lyrics, or null when Spotify has none. */
export function lyrics(trackUri: string): Promise<Lyrics | null> {
  return cached(`lyrics:${trackUri}`, () => invoke<Lyrics | null>("spotify_lyrics", { uri: trackUri }));
}

/** The main artist and the credits of a track, for the Now Playing panel. */
export function trackDetails(trackUri: string, artistUri: string): Promise<TrackDetails> {
  return cached(`npv:${trackUri}`, async () =>
    n.toTrackDetails(
      await query("queryNpvArtist", {
        artistUri,
        trackUri,
        contributorsLimit: 10,
        contributorsOffset: 0,
        enableRelatedVideos: false,
        enableRelatedAudioTracks: false,
      }),
    ),
  );
}

// Playback.
export type Repeat = "off" | "all" | "one";

/** A queue track as the panel saw it; its song is used if the uid has changed since. */
export type QueueRef = { uid: string; uri: string };

/** A change to what plays next. */
export type QueueEdit =
  | { kind: "remove"; tracks: QueueRef[] }
  | { kind: "move"; tracks: QueueRef[]; before: QueueRef | null }
  | { kind: "clear" };

export const play = {
  /** Plays an album, playlist or podcast, from `trackUri` when given, `positionMs` into it. */
  context: (contextUri: string, trackUri?: string, positionMs?: number) =>
    invoke("spotify_play_context", {
      contextUri,
      trackUri: trackUri ?? null,
      positionMs: positionMs ? Math.max(0, Math.round(positionMs)) : null,
    }),
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
  editQueue: (edit: QueueEdit) => invoke("spotify_edit_queue", { edit }),
};
