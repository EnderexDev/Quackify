// Asking for a new playlist: Ctrl N, the + buttons, the palette and the songs' menus all open
// the same dialog (components/NewPlaylist.tsx). From songs, it offers to add them at once.

export const NEW_PLAYLIST_EVENT = "quackify:new-playlist";

export type NewPlaylistFrom = {
  /** The songs to add, read when the playlist is made (a whole list can take a moment). */
  songs: () => Promise<string[]>;
  /** What they are, for "Also add …": a song's name, "3 songs", a list's title. */
  label: string;
  /** The name it starts with, instead of "My Playlist #N". */
  name?: string;
};

/** Opens the New playlist dialog, empty or with songs to add. */
export function newPlaylist(from?: NewPlaylistFrom) {
  window.dispatchEvent(new CustomEvent<NewPlaylistFrom | undefined>(NEW_PLAYLIST_EVENT, { detail: from }));
}
