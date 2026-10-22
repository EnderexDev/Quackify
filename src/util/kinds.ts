import type { Card, Kind } from "../api/types";

const KIND_LABEL: Record<Kind, string> = {
  playlist: "Playlist",
  album: "Album",
  artist: "Artist",
  liked: "Playlist",
  track: "Song",
  show: "Podcast",
  episode: "Episode",
  user: "Profile",
  folder: "Folder",
};

/** What a thing is, in a word: "Album", or "Single" and "EP" for those albums. */
export function kindLabel(c: { kind: Kind; albumType?: Card["albumType"] }): string {
  if (c.kind === "album" && c.albumType) return c.albumType === "single" ? "Single" : "EP";
  return KIND_LABEL[c.kind];
}

/** The kinds a card tags on its cover; an artist or a profile is told by its round shape. */
export const TAGGED_KINDS = new Set<Kind>(["playlist", "album", "show"]);
