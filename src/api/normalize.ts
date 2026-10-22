// Spotify's GraphQL (pathfinder) responses into the app's shapes. Every reader is defensive:
// the same entity comes back with different fields depending on the operation that sent it.
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
  Kind,
  LibraryPage,
  Named,
  Profile,
  SearchPage,
  SearchResults,
  Section,
  Show,
  TopContent,
  Track,
  TrackDetails,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** The source closest to `size` pixels wide; sources without a width count as large. */
export function pickImage(sources: Raw, size = 300): string | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const width = (s: Raw) => s.width ?? s.maxWidth ?? 640;
  const best = [...sources].sort((a, b) => Math.abs(width(a) - size) - Math.abs(width(b) - size))[0];
  return best?.url ?? null;
}

function imageOf(d: Raw, size = 300): string | null {
  return (
    pickImage(d?.coverArt?.sources, size) ??
    pickImage(d?.images?.items?.[0]?.sources, size) ??
    pickImage(d?.visuals?.avatarImage?.sources, size) ??
    pickImage(d?.visualIdentity?.squareCoverImage?.image?.data?.sources, size) ??
    pickImage(d?.avatar?.sources, size) ??
    pickImage(d?.image?.sources, size) ??
    null
  );
}

function names(list: Raw): Named[] {
  return (list?.items ?? [])
    .map((a: Raw) => ({ uri: a?.uri ?? "", name: a?.profile?.name ?? a?.name ?? "" }))
    .filter((a: Named) => a.name);
}

/** The character of a numeric HTML entity, or null when the number is not one. */
function codePoint(n: number): string | null {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
}

/** Spotify descriptions carry HTML links and entities; the app shows plain text. */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => codePoint(parseInt(h, 16)) ?? m)
    .replace(/&#([0-9]+);/g, (m, d) => codePoint(Number(d)) ?? m)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function unwrap(x: Raw): Raw {
  // Items arrive bare, as {data}, as {content: {data}} (home) or as {item: {data}} (library).
  return x?.content?.data ?? x?.item?.data ?? x?.data ?? x;
}

/** A tile for a playlist, album or artist; null for anything else (podcasts, episodes...). */
export function toCard(x: Raw): Card | null {
  const d = unwrap(x);
  const uri: string = d?.uri ?? x?.item?._uri ?? x?.uri ?? "";
  switch (d?.__typename) {
    case "Playlist": {
      // Recently played lists Liked Songs as a playlist with a stand-in URI.
      if (d.format === "liked-songs") {
        return { uri: "spotify:collection:tracks", kind: "liked", title: d.name ?? "Liked Songs", subtitle: "Playlist", image: imageOf(d) };
      }
      const owner = d.ownerV2?.data?.name;
      return {
        uri,
        kind: "playlist",
        title: d.name ?? "",
        subtitle: plainText(d.description) || (owner ? `By ${owner}` : "Playlist"),
        image: imageOf(d),
      };
    }
    case "Album": {
      const year = d.date?.isoString?.slice(0, 4) ?? d.date?.year;
      const type = d.albumType ?? d.type;
      const lead = type === "SINGLE" ? "Single" : type === "EP" ? "EP" : year ?? "Album";
      return {
        uri,
        kind: "album",
        albumType: type === "SINGLE" ? "single" : type === "EP" ? "ep" : undefined,
        title: d.name ?? "",
        subtitle: [lead, names(d.artists).map((a) => a.name).join(", ")].filter(Boolean).join(" • "),
        image: imageOf(d),
      };
    }
    case "Artist":
      return { uri, kind: "artist", title: d.profile?.name ?? "", subtitle: "Artist", image: imageOf(d) };
    case "User":
      return {
        uri,
        kind: "user",
        title: d.displayName || d.name || d.username || "",
        subtitle: "Profile",
        image: imageOf(d),
      };
    case "Podcast":
    case "Audiobook":
      return {
        uri,
        kind: "show",
        title: d.name ?? "",
        subtitle: d.publisher?.name ?? "Podcast",
        image: imageOf(d),
      };
    case "Episode": {
      const date = formatDay(d.releaseDate?.isoString);
      const show = d.podcastV2?.data?.name;
      return {
        uri,
        kind: "episode",
        title: d.name ?? "",
        subtitle: [date, show].filter(Boolean).join(" • ") || "Episode",
        image: imageOf(d),
      };
    }
    case "Track":
      return {
        uri,
        kind: "track",
        title: d.name ?? "",
        subtitle: ["Song", names(d.artists).map((a) => a.name).join(", ")].filter(Boolean).join(" • "),
        image: imageOf(d.albumOfTrack),
      };
    case "PseudoPlaylist":
      return {
        uri: uri || "spotify:collection:tracks",
        kind: "liked",
        title: d.name ?? "Liked Songs",
        subtitle: `${d.count ?? 0} songs`,
        image: imageOf(d),
      };
    default:
      return null;
  }
}

function cards(items: Raw): Card[] {
  return (items ?? []).map(toCard).filter((c: Card | null): c is Card => c !== null && !!c.uri);
}

/** A track from any of the shapes Spotify uses: playlist rows, album rows, search, library. */
export function toTrack(x: Raw): Track | null {
  const d = x?.itemV2?.data ?? x?.track?.data ?? x?.item?.data ?? x?.track ?? x?.data ?? x;
  if (!d || (d.__typename && d.__typename !== "Track")) return null;
  const uri: string = d.uri ?? x?.track?._uri ?? "";
  if (!uri.startsWith("spotify:track:")) return null;
  const album = d.albumOfTrack;
  return {
    uri,
    name: d.name ?? "",
    artists: names(d.artists),
    album: album?.uri ? { uri: album.uri, name: album.name ?? "" } : null,
    image: imageOf(album, 64),
    durationMs: d.trackDuration?.totalMilliseconds ?? d.duration?.totalMilliseconds ?? 0,
    playable: d.playability?.playable !== false,
    addedAt: x?.addedAt?.isoString ?? null,
    uid: x?.uid ?? null,
  };
}

function tracks(items: Raw): Track[] {
  return (items ?? []).map(toTrack).filter((t: Track | null): t is Track => t !== null);
}

/** A row of Home or of a genre page. */
function toSection(s: Raw): Section {
  const items = s?.sectionItems;
  const shown = cards(items?.items);
  return {
    title: s?.data?.title?.transformedLabel ?? s?.data?.title?.text ?? "",
    cards: shown,
    uri: s?.uri ?? null,
    more: (items?.totalCount ?? 0) > shown.length || items?.pagingInfo?.nextOffset != null,
  };
}

export function toHome(data: Raw): Home {
  const home = data?.home;
  const sections: Section[] = (home?.sectionContainer?.sections?.items ?? [])
    .map(toSection)
    .filter((s: Section) => s.cards.length > 0);
  return { greeting: home?.greeting?.transformedLabel ?? "Hello", sections };
}

/** A page of cards. `items` is the list Spotify sent; `offset` where it starts. */
function cardPage(title: string, list: Raw, offset: number, toCards: (items: Raw) => Card[] = cards): CardPage {
  const items = list?.items ?? [];
  const total = list?.totalCount ?? items.length;
  const next = list?.pagingInfo ? list.pagingInfo.nextOffset ?? null : offset + items.length < total ? offset + items.length : null;
  return { title, cards: toCards(items), total, next: items.length ? next : null };
}

/** Home's "Show all": one page of a home section. */
export function toHomeSection(data: Raw, offset: number): CardPage {
  const s = data?.homeSections?.sections?.[0];
  return cardPage(s?.data?.title?.transformedLabel ?? "", s?.sectionItems, offset);
}

/** Search's Browse all: the genre and mood tiles (features like Live Events are left out). */
export function toBrowseAll(data: Raw): Category[] {
  const out: Category[] = [];
  for (const section of data?.browseStart?.sections?.items ?? []) {
    for (const item of section?.sectionItems?.items ?? []) {
      const card = item?.content?.data?.data?.cardRepresentation;
      if (!card || !item.uri?.startsWith("spotify:page:")) continue;
      out.push({
        uri: item.uri,
        title: card.title?.transformedLabel ?? "",
        color: card.backgroundColor?.hex ?? "#535353",
        image: pickImage(card.artwork?.sources, 300),
      });
    }
  }
  return out;
}

export function toBrowsePage(data: Raw): BrowsePage {
  const p = data?.browse;
  return {
    title: p?.header?.title?.transformedLabel ?? "",
    sections: (p?.sections?.items ?? []).map(toSection).filter((s: Section) => s.cards.length > 0),
  };
}

/** A genre page's "Show all". */
export function toBrowseSection(data: Raw, offset: number): CardPage {
  const s = data?.browseSection;
  return cardPage(s?.data?.title?.transformedLabel ?? "", s?.sectionItems, offset);
}

/** Releases come as groups whose first release is the one shown. */
function releases(group: Raw): Card[] {
  return cards((group ?? []).map((i: Raw) => i?.releases?.items?.[0] ?? i).map((r: Raw) => ({ __typename: "Album", ...r })));
}

export function toDiscography(data: Raw, offset: number): CardPage {
  const a = data?.artistUnion;
  return cardPage(a?.profile?.name ?? "", a?.discography?.all, offset, releases);
}

export function toRelatedArtists(data: Raw): CardPage {
  const a = data?.artistUnion;
  return cardPage(a?.profile?.name ?? "", a?.relatedContent?.relatedArtists, 0, (items) =>
    cards(items.map((x: Raw) => ({ __typename: "Artist", ...x }))),
  );
}

/** The account's recent searches, newest first. */
export function toRecentSearches(data: Raw): Card[] {
  return cards(data?.recentSearches?.recentSearchesItems?.items);
}

export function toSearch(data: Raw): SearchResults {
  const s = data?.searchV2;
  const top = (s?.topResultsV2?.itemsV2 ?? []).map((i: Raw) => toCard(i.item)).find(Boolean) ?? null;
  return {
    top,
    tracks: tracks((s?.tracksV2?.items ?? []).map((i: Raw) => i.item)),
    artists: cards(s?.artists?.items),
    albums: cards(s?.albumsV2?.items),
    playlists: cards(s?.playlists?.items),
    podcasts: cards(s?.podcasts?.items),
    episodes: cards(s?.episodes?.items),
  };
}

/**
 * "Mar 3, 2024" for an ISO date. A day-only date (no time, or midnight UTC, as Spotify sends
 * dates known only to the day) is that calendar day everywhere, not the day before west of UTC.
 */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dayOnly = !iso.includes("T") || /T00:00(:00(.0+)?)?Z$/.test(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(dayOnly ? { timeZone: "UTC" } : {}) });
}

export function toEpisode(x: Raw): Episode | null {
  const d = x?.entity?.data ?? x?.data ?? x;
  if (d?.__typename !== "Episode" && d?.__typename !== "Chapter") return null;
  const show = d.podcastV2?.data;
  const played = d.playedState;
  return {
    uri: d.uri ?? x?.entity?._uri ?? "",
    name: d.name ?? "",
    description: plainText(d.description ?? d.htmlDescription),
    image: imageOf(d, 300),
    durationMs: d.duration?.totalMilliseconds ?? 0,
    released: d.releaseDate?.isoString ?? null,
    show: { uri: show?.uri ?? "", name: show?.name ?? "" },
    playedMs: played?.playPositionMilliseconds ?? 0,
    finished: played?.state === "COMPLETED",
    playable: d.playability?.playable !== false,
  };
}

export function toShow(data: Raw): Show {
  const p = data?.podcastUnionV2;
  return {
    uri: p?.uri ?? "",
    name: p?.name ?? "",
    publisher: p?.publisher?.name ?? "",
    description: plainText(p?.description ?? p?.htmlDescription),
    image: imageOf(p, 640),
    color: colorOf(p),
    rating: p?.rating?.averageRating?.showAverage ? p.rating.averageRating.average ?? null : null,
    topics: (p?.topics?.items ?? []).map((t: Raw) => t?.title).filter(Boolean),
  };
}

export function toEpisodePage(data: Raw, offset: number): EpisodePage {
  const list = data?.podcastUnionV2?.episodesV2;
  const items = list?.items ?? [];
  const episodes = items.map(toEpisode).filter((e: Episode | null): e is Episode => e !== null);
  const total = list?.totalCount ?? offset + items.length;
  const next = list?.pagingInfo?.nextOffset ?? (offset + items.length < total ? offset + items.length : null);
  return { episodes, total, next: items.length ? next : null };
}

export function toSingleEpisode(data: Raw): Episode | null {
  return toEpisode(data?.episodeUnionV2);
}

export function toLibrary(data: Raw): LibraryPage {
  const lib = data?.me?.libraryV3;
  const items: Card[] = [];
  for (const it of lib?.items ?? []) {
    const d = it?.item?.data;
    const card: Card | null =
      d?.__typename === "Folder"
        ? {
            uri: d.uri ?? it.item._uri ?? "",
            kind: "folder",
            title: d.name ?? "Folder",
            subtitle: d.playlistCount != null ? `${d.playlistCount} playlists` : "Folder",
            image: null,
          }
        : toCard(it);
    if (!card || !card.uri) continue;
    items.push({ ...card, pinned: !!it?.pinned, pinnable: !!it?.pinnable });
  }
  return { items, total: lib?.totalCount ?? 0 };
}

function colorOf(d: Raw): string | null {
  const rgb = d?.visualIdentity?.squareCoverImage?.extractedColorSet?.highContrast?.backgroundBase;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return (
    d?.coverArt?.extractedColors?.colorDark?.hex ??
    d?.images?.items?.[0]?.extractedColors?.colorDark?.hex ??
    (rgb ? `#${hex(rgb.red)}${hex(rgb.green)}${hex(rgb.blue)}` : null)
  );
}

export function toPlaylist(data: Raw): Collection {
  const p = data?.playlistV2;
  return {
    uri: p?.uri ?? "",
    kind: "playlist",
    title: p?.name ?? "",
    description: plainText(p?.description),
    owner: p?.ownerV2?.data?.name ?? "",
    image: imageOf(p, 640),
    color: colorOf(p),
    total: p?.content?.totalCount ?? 0,
    tracks: tracks(p?.content?.items),
    canEditItems: p?.currentUserCapabilities?.canEditItems === true,
    canEditMetadata: p?.currentUserCapabilities?.canEditMetadata === true,
  };
}

export function toAlbum(data: Raw): Collection {
  const a = data?.albumUnion;
  const album = a?.uri ? { uri: a.uri, name: a.name ?? "" } : null;
  const cover = imageOf(a, 64);
  return {
    uri: a?.uri ?? "",
    kind: "album",
    albumType: a?.type === "SINGLE" ? "single" : a?.type === "EP" ? "ep" : undefined,
    title: a?.name ?? "",
    description: [a?.type ? a.type[0] + a.type.slice(1).toLowerCase() : "", a?.date?.isoString?.slice(0, 4)]
      .filter(Boolean)
      .join(" • "),
    owner: names(a?.artists).map((x) => x.name).join(", "),
    ownerImage: pickImage(a?.artists?.items?.[0]?.visuals?.avatarImage?.sources, 160),
    ownerUri: a?.artists?.items?.[0]?.uri ?? null,
    image: imageOf(a, 640),
    color: colorOf(a),
    total: a?.tracksV2?.totalCount ?? 0,
    // Album rows carry no album or cover of their own: they are this album's.
    tracks: tracks(a?.tracksV2?.items).map((t) => ({ ...t, album: t.album ?? album, image: t.image ?? cover })),
    canEditItems: false,
    canEditMetadata: false,
  };
}

export function toLiked(data: Raw, title = "Liked Songs"): Collection {
  const l = data?.me?.library?.tracks;
  return {
    uri: "spotify:collection:tracks",
    kind: "liked",
    title,
    description: "",
    owner: "",
    image: null,
    color: "#3d2fb0",
    total: l?.totalCount ?? 0,
    tracks: tracks(l?.items),
    canEditItems: false,
    canEditMetadata: false,
  };
}

export function toArtist(data: Raw): Artist {
  const a = data?.artistUnion;
  const d = a?.discography;
  const related = a?.relatedContent?.relatedArtists;
  const plays = new Map<string, number>();
  for (const it of a?.discography?.topTracks?.items ?? []) {
    const n = Number(it?.track?.playcount);
    if (it?.track?.uri && Number.isFinite(n)) plays.set(it.track.uri, n);
  }
  const pinned = a?.profile?.pinnedItem;
  const pickCard = pinned ? toCard(pinned.itemV2 ?? pinned.item ?? pinned) : null;
  return {
    uri: a?.uri ?? "",
    name: a?.profile?.name ?? "",
    image: imageOf(a, 300),
    header: pickImage(a?.headerImage?.data?.sources, 1500),
    monthlyListeners: a?.stats?.monthlyListeners ?? null,
    topTracks: tracks(a?.discography?.topTracks?.items).map((t) => ({ ...t, plays: plays.get(t.uri) })),
    albums: releases(d?.albums?.items),
    singles: releases(d?.singles?.items),
    releaseCount: (d?.albums?.totalCount ?? 0) + (d?.singles?.totalCount ?? 0) + (d?.compilations?.totalCount ?? 0),
    appearsOn: releases(a?.relatedContent?.appearsOn?.items),
    related: cards((related?.items ?? []).map((x: Raw) => ({ __typename: "Artist", ...x }))),
    relatedCount: related?.totalCount ?? 0,
    verified: !!a?.onPlatformReputationTrait?.verification?.isVerified,
    followers: a?.stats?.followers ?? null,
    worldRank: a?.stats?.worldRank || null,
    bio: plainText(a?.profile?.biography?.text),
    photo: pickImage(a?.visuals?.gallery?.items?.[0]?.sources, 1000),
    topCities: (a?.stats?.topCities?.items ?? []).map((c: Raw) => ({
      city: c?.city ?? "",
      country: c?.country ?? "",
      listeners: c?.numberOfListeners ?? 0,
    })),
    pick: pickCard?.uri ? { card: pickCard, comment: plainText(pinned?.comment) } : null,
  };
}

export function toTrackDetails(data: Raw): TrackDetails {
  const a = data?.artistUnion;
  // One person can have several roles (writer and producer): one credit each.
  const credits: TrackDetails["credits"] = [];
  for (const c of data?.trackUnion?.creditsTrait?.contributors?.items ?? []) {
    if (!c?.name) continue;
    const same = credits.find((x) => x.name === c.name);
    if (same) {
      if (c.role && !same.roles.includes(c.role)) same.roles.push(c.role);
    } else credits.push({ uri: c.uri ?? null, name: c.name, roles: c.role ? [c.role] : [] });
  }
  return {
    artist: a?.profile?.name
      ? {
          uri: a.uri ?? "",
          name: a.profile.name,
          // The wide gallery photo, as Spotify's panel shows; the avatar when there is none.
          image: pickImage(a.visuals?.gallery?.items?.[0]?.sources, 640) ?? imageOf(a, 640),
          monthlyListeners: a.stats?.monthlyListeners ?? null,
          bio: plainText(a.profile.biography?.text),
          verified: !!a.onPlatformReputationTrait?.verification?.isVerified,
        }
      : null,
    credits,
  };
}

export function toCredits(data: Raw): Credits {
  const tr = data?.trackUnion;
  const groups: Credits["groups"] = [];
  for (const c of tr?.creditsTrait?.contributors?.items ?? []) {
    if (!c?.name) continue;
    const role = c.roleGroup?.name || "Credits";
    let g = groups.find((x) => x.role === role);
    if (!g) groups.push((g = { role, people: [] }));
    const same = g.people.find((p) => p.name === c.name);
    if (same) {
      if (c.role && !same.roles.includes(c.role)) same.roles.push(c.role);
    } else g.people.push({ uri: c.uri || null, name: c.name, roles: c.role ? [c.role] : [] });
  }
  return {
    title: tr?.name ?? "",
    groups,
    sources: (tr?.creditsTrait?.sources?.items ?? []).map((s: Raw) => s?.name).filter(Boolean),
  };
}

/** Where a search tab's list sits in the answer. */
const SEARCH_LIST = {
  tracks: "tracksV2",
  artists: "artists",
  albums: "albumsV2",
  playlists: "playlists",
  podcasts: "podcasts",
  episodes: "episodes",
  users: "users",
} as const;

export function toSearchPage(tab: keyof typeof SEARCH_LIST, data: Raw, offset: number): SearchPage {
  const list = data?.searchV2?.[SEARCH_LIST[tab]];
  const items = list?.items ?? [];
  const total = list?.totalCount ?? offset + items.length;
  const next = list?.pagingInfo ? list.pagingInfo.nextOffset ?? null : null;
  return {
    tracks: tab === "tracks" ? tracks(items.map((i: Raw) => i?.item ?? i)) : [],
    cards: tab === "tracks" ? [] : cards(items),
    total,
    next: items.length ? next : null,
  };
}

/** A profile from the profile service (plain JSON, not GraphQL). */
export function toProfile(p: Raw): Profile {
  const card = (x: Raw, kind: "playlist" | "artist", subtitle: string): Card => ({
    uri: x?.uri ?? "",
    kind,
    title: x?.name ?? "",
    subtitle,
    image: x?.image_url || null,
  });
  return {
    uri: p?.uri ?? "",
    username: p?.username ?? "",
    name: p?.name ?? p?.username ?? "",
    image: p?.image_url || null,
    followers: p?.followers_count ?? 0,
    following: p?.following_count ?? 0,
    isMe: !!p?.is_me,
    playlists: (p?.public_playlists ?? []).map((x: Raw) => card(x, "playlist", x?.owner_name ? `By ${x.owner_name}` : "Playlist")),
    playlistCount: p?.total_public_playlists_count ?? (p?.public_playlists ?? []).length,
    recentArtists: (p?.recently_played_artists ?? []).map((x: Raw) => card(x, "artist", "Artist")),
  };
}

export function toTopContent(data: Raw): TopContent {
  const pr = data?.me?.profile;
  return {
    artists: cards((pr?.topArtists?.items ?? []).map((i: Raw) => ({ __typename: "Artist", ...(i?.data ?? i) }))),
    tracks: tracks((pr?.topTracks?.items ?? []).map((i: Raw) => i?.data ?? i)),
  };
}

export const kindOf = (uri: string): Kind | null => {
  if (uri.startsWith("spotify:collection")) return "liked";
  const k = uri.split(":")[1];
  if (k === "show" || k === "episode") return k;
  return k === "playlist" || k === "album" || k === "artist" ? k : null;
};
