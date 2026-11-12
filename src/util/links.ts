// Spotify links typed or pasted in the search: the same shapes src-tauri/src/links.rs reads from
// the links Windows hands to Quackify. Keep the two in step (links.rs has the tests).

/** The spotify: URI a link points to (spotify:track:ID, spotify://track/ID, the old
 * spotify:user:NAME:playlist:ID, an open.spotify.com link), or null for anything else.
 *
 * Besides Spotify's URIs it gives three of Quackify's, which `openLink` (state/openLink.ts) opens:
 * `spotify:artist:ID:discography`, `spotify:episode:ID?t=SECONDS` and `spotify:collection:albums`
 * (`artists`, `podcasts`, `playlists`). An album link marking a song (`?highlight=`) is that song. */
export function linkToUri(text: string): string | null {
  const arg = text.trim().replace(/^"+|"+$/g, "").replace(/^--protocol-uri=/, "");
  let rest: string;
  if (arg.toLowerCase().startsWith("spotify:")) rest = arg.slice("spotify:".length);
  else {
    const m = /^(?:https?:\/\/)?(?:www\.)?(?:open|play)\.spotify\.com\//i.exec(arg);
    if (!m) return null;
    rest = arg.slice(m[0].length);
  }
  const cut = rest.search(/[?#]/);
  const path = cut < 0 ? rest : rest.slice(0, cut);
  const query = cut < 0 ? "" : rest.slice(cut + 1);
  const param = (name: string) =>
    query
      .split(/[&?#]/)
      .map((kv) => kv.split("="))
      .find(([k, v]) => v !== undefined && k.toLowerCase() === name)?.[1];
  const parts = path.split(/[:/]/).filter(Boolean);
  // open.spotify.com/intl-pt/track/ID and the embed player's open.spotify.com/embed/track/ID.
  if (parts[0]?.startsWith("intl-") || parts[0] === "embed") parts.shift();
  const idOk = (id: string | undefined): id is string => !!id && /^[A-Za-z0-9._-]+$/.test(id);
  // Usernames and search words come escaped in links (%2E, + for a space); they stay as they are.
  const userOk = (name: string | undefined): name is string => !!name && /^[A-Za-z0-9._%+-]+$/.test(name);
  const [a, b, c, d] = parts;
  const tabs = ["albums", "artists", "podcasts", "playlists"];
  if (a === "user" && c === "playlist" && idOk(d)) return `spotify:playlist:${d}`;
  const joined = parts.join("/");
  if (/^(user\/[^/]+\/)?collection(\/tracks)?$/.test(joined)) return "spotify:collection:tracks";
  const tab = /^(?:user\/[^/]+\/)?collection\/([a-z]+)$/.exec(joined)?.[1];
  if (tab && tabs.includes(tab)) return `spotify:collection:${tab}`;
  if (a === "user" && parts.length === 2 && userOk(b)) return `spotify:user:${b}`;
  // Search words: anything a URL keeps unescaped in a path segment (Don't%20Stop, (Live)).
  if (a === "search" && b && /^[A-Za-z0-9._%+~!*'(),;-]+$/.test(b)) return `spotify:search:${b}`;
  if (a === "album" && idOk(b)) {
    const song = param("highlight")?.replace(/%3a/gi, ":");
    const id = song?.startsWith("spotify:track:") ? song.slice("spotify:track:".length) : "";
    return idOk(id) ? `spotify:track:${id}` : `spotify:album:${b}`;
  }
  if (a === "artist" && idOk(b) && c === "discography") return `spotify:artist:${b}:discography`;
  if (a === "episode" && idOk(b)) {
    const t = param("t");
    return t && /^\d+$/.test(t) && t !== "0" ? `spotify:episode:${b}?t=${t}` : `spotify:episode:${b}`;
  }
  if (["track", "artist", "playlist", "show", "page", "genre"].includes(a) && idOk(b)) {
    return `spotify:${a === "genre" ? "page" : a}:${b}`;
  }
  return null;
}

/** A Spotify short link (spotify.link from the phone app's Share, the older spoti.fi): it says
 * where it points only when fetched, which `resolveLink` (state/openLink.ts) does. */
export const isShortLink = (text: string) =>
  /^(?:https?:\/\/)?(?:spotify\.link|spotify\.app\.link|spoti\.fi|link\.tospotify\.com)\/[A-Za-z0-9_-]+(?:[?#].*)?$/i.test(text.trim());

/** The words of a spotify:search: URI, unescaped. */
export const searchTermOf = (uri: string): string | null => {
  if (!uri.startsWith("spotify:search:")) return null;
  const raw = uri.slice("spotify:search:".length).replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const LIBRARY_TABS = { albums: "Albums", artists: "Artists", podcasts: "Podcasts & Shows", playlists: "Playlists" } as const;

/** The Your Library tab a spotify:collection: URI names, other than Liked Songs. */
export const libraryTabOf = (uri: string) => {
  const tab = uri.slice("spotify:collection:".length);
  return Object.prototype.hasOwnProperty.call(LIBRARY_TABS, tab) ? LIBRARY_TABS[tab as keyof typeof LIBRARY_TABS] : null;
};

/** Splits Quackify's own forms into the Spotify URI and what goes with it. */
export function readLink(uri: string): { uri: string; discography?: boolean; atMs?: number } {
  if (uri.endsWith(":discography")) return { uri: uri.slice(0, -":discography".length), discography: true };
  const t = /^(spotify:episode:[^?]+)\?t=(\d+)$/.exec(uri);
  if (t) return { uri: t[1], atMs: Number(t[2]) * 1000 };
  return { uri };
}
