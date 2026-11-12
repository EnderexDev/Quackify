// Spotify links typed or pasted in the search: the same shapes src-tauri/src/links.rs reads from
// the links Windows hands to Quackify. Keep the two in step.

/** The spotify: URI a link points to (spotify:track:ID, spotify://track/ID, the old
 * spotify:user:NAME:playlist:ID, an open.spotify.com link), or null for anything else. */
export function linkToUri(text: string): string | null {
  const arg = text.trim().replace(/^"+|"+$/g, "");
  const lower = arg.toLowerCase();
  let rest: string;
  if (lower.startsWith("spotify:")) rest = arg.slice("spotify:".length);
  else {
    const m = /^(?:https?:\/\/)?(?:www\.)?open\.spotify\.com\//i.exec(arg);
    if (!m) return null;
    rest = arg.slice(m[0].length);
  }
  // No query (?si=… share codes) or fragment.
  rest = rest.split(/[?#]/)[0];
  const parts = rest.split(/[:/]/).filter(Boolean);
  // open.spotify.com/intl-pt/track/ID and the embed player's open.spotify.com/embed/track/ID.
  if (parts[0]?.startsWith("intl-") || parts[0] === "embed") parts.shift();
  const idOk = (id: string | undefined) => !!id && /^[A-Za-z0-9._-]+$/.test(id);
  // Usernames come escaped in links (%2E, + for a space); they stay as they are.
  const userOk = (name: string | undefined) => !!name && /^[A-Za-z0-9._%+-]+$/.test(name);
  const [a, b, c, d] = parts;
  if (a === "user" && c === "playlist" && idOk(d)) return `spotify:playlist:${d}`;
  const liked = parts.join("/");
  if (/^(user\/[^/]+\/)?collection(\/tracks)?$/.test(liked)) return "spotify:collection:tracks";
  if (a === "user" && parts.length === 2 && userOk(b)) return `spotify:user:${b}`;
  if (["track", "album", "artist", "playlist", "show", "episode", "page", "genre"].includes(a) && idOk(b)) {
    return `spotify:${a === "genre" ? "page" : a}:${b}`;
  }
  return null;
}
