// Opening what a Spotify link points to: from Windows (App.tsx) and from the search (Palette.tsx).
import { invoke } from "@tauri-apps/api/core";
import { episode, play } from "../api/spotify";
import { libraryTabOf, linkToUri, readLink, searchTermOf } from "../util/links";
import type { Nav } from "./nav";
import { toast } from "./toast";

/** What a link points to, a short link fetched first (links.rs). */
export const resolveLink = (text: string): Promise<string | null> =>
  linkToUri(text) ? Promise.resolve(linkToUri(text)) : invoke<string | null>("links_resolve", { text });

/** Opens the page a link points to; true when it did. A song is the caller's: it has no page. */
export function openLink(uri: string, nav: Nav): boolean {
  const term = searchTermOf(uri);
  if (term) {
    nav.go({ page: "search", term });
    return true;
  }
  const filter = uri.startsWith("spotify:collection:") ? libraryTabOf(uri) : null;
  if (filter) {
    nav.go({ page: "library", filter });
    return true;
  }
  const link = readLink(uri);
  if (link.discography) {
    nav.go({ page: "cards", source: "discography", uri: link.uri });
    return true;
  }
  if (link.atMs !== undefined) {
    // An episode shared from a point in it: its page, and it plays from there.
    nav.open(link.uri);
    const at = link.atMs;
    episode(link.uri)
      .then((e) => (e.show.uri ? play.context(e.show.uri, e.uri, at) : play.tracks([e.uri], 0).then(() => play.seek(at))))
      .catch(toast);
    return true;
  }
  if (link.uri.startsWith("spotify:track:")) return false;
  nav.open(link.uri);
  return true;
}
