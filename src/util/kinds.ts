import type { Card, Kind } from "../api/types";
import { t } from "../i18n";

/** The word for a kind, in the language shown now (so it is read when drawn, not at import). */
function kindName(kind: Kind): string {
  switch (kind) {
    case "playlist":
    case "liked":
      return t("Playlist");
    case "album":
      return t("Album");
    case "artist":
      return t("Artist");
    case "track":
      return t("Song");
    case "show":
      return t("Podcast");
    case "episode":
      return t("Episode");
    case "user":
      return t("Profile");
    case "folder":
      return t("Folder");
  }
}

/** What a thing is, in a word: "Album", or "Single" and "EP" for those albums. */
export function kindLabel(c: { kind: Kind; albumType?: Card["albumType"] }): string {
  if (c.kind === "album" && c.albumType) return c.albumType === "single" ? t("Single") : t("EP");
  return kindName(c.kind);
}

/** The kinds a card tags on its cover; an artist or a profile is told by its round shape. */
export const TAGGED_KINDS = new Set<Kind>(["playlist", "album", "show"]);
