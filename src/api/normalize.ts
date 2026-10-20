// Spotify's GraphQL (pathfinder) responses into the app's shapes. Every reader is defensive:
// the same entity comes back with different fields depending on the operation that sent it.
import type { Artist, Card, Collection, Home, Kind, LibraryPage, Named, SearchResults, Section, Track, TrackDetails } from "./types";

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

/** Spotify descriptions carry HTML links and entities; the app shows plain text. */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
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
        title: d.name ?? "",
        subtitle: [lead, names(d.artists).map((a) => a.name).join(", ")].filter(Boolean).join(" • "),
        image: imageOf(d),
      };
    }
    case "Artist":
      return { uri, kind: "artist", title: d.profile?.name ?? "", subtitle: "Artist", image: imageOf(d) };
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

export function toHome(data: Raw): Home {
  const home = data?.home;
  const sections: Section[] = (home?.sectionContainer?.sections?.items ?? [])
    .map((s: Raw) => ({
      title: s?.data?.title?.transformedLabel ?? s?.data?.title?.text ?? "",
      cards: cards(s?.sectionItems?.items),
    }))
    .filter((s: Section) => s.cards.length > 0);
  return { greeting: home?.greeting?.transformedLabel ?? "Hello", sections };
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
  };
}

export function toLibrary(data: Raw): LibraryPage {
  const lib = data?.me?.libraryV3;
  return { items: cards(lib?.items), total: lib?.totalCount ?? 0 };
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
    title: a?.name ?? "",
    description: [a?.type ? a.type[0] + a.type.slice(1).toLowerCase() : "", a?.date?.isoString?.slice(0, 4)]
      .filter(Boolean)
      .join(" • "),
    owner: names(a?.artists).map((x) => x.name).join(", "),
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
  const releases = (group: Raw) =>
    cards((group?.items ?? []).map((i: Raw) => i?.releases?.items?.[0] ?? i).map((r: Raw) => ({ __typename: "Album", ...r })));
  return {
    uri: a?.uri ?? "",
    name: a?.profile?.name ?? "",
    image: imageOf(a, 300),
    header: pickImage(a?.headerImage?.data?.sources, 1500),
    monthlyListeners: a?.stats?.monthlyListeners ?? null,
    topTracks: tracks(a?.discography?.topTracks?.items),
    albums: releases(a?.discography?.albums),
    singles: releases(a?.discography?.singles),
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

export const kindOf = (uri: string): Kind | null => {
  if (uri.startsWith("spotify:collection")) return "liked";
  const k = uri.split(":")[1];
  return k === "playlist" || k === "album" || k === "artist" ? k : null;
};
