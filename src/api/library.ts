// Writes to the user's library and playlists, and the reads that go with them.
import { invoke } from "@tauri-apps/api/core";
import { clearCache } from "./spotify";
import { pickImage } from "./normalize";

function query(op: string, variables: Record<string, unknown>): Promise<unknown> {
  return invoke("spotify_query", { op, variables });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** Whether each URI (track, album, playlist, artist) is in the library, in order. */
export async function areSaved(uris: string[]): Promise<boolean[]> {
  const data = (await query("areEntitiesInLibrary", { uris })) as Raw;
  return (data?.lookup ?? []).map((x: Raw) => x?.data?.saved === true);
}

/** Saves tracks (Liked Songs), albums, playlists, or follows artists. */
export async function save(uris: string[]): Promise<void> {
  await query("addToLibrary", { libraryItemUris: uris, interactionId: null });
  clearCache("library:");
  clearCache("collection:spotify:collection");
}

export async function unsave(uris: string[]): Promise<void> {
  await query("removeFromLibrary", { libraryItemUris: uris });
  clearCache("library:");
  clearCache("collection:spotify:collection");
}

export type EditablePlaylist = { uri: string; name: string; image: string | null; contains: boolean };

/** Playlists the user can add `trackUri` to (Liked Songs left out: that is the heart). */
export async function editablePlaylists(trackUri: string): Promise<EditablePlaylist[]> {
  const data = (await query("editablePlaylists", {
    offset: 0,
    limit: 50,
    textFilter: "",
    folderUri: null,
    uris: [trackUri],
    features: [],
  })) as Raw;
  return (data?.me?.editablePlaylists?.items ?? [])
    .map((i: Raw) => {
      const d = i?.item?.data;
      const uri: string = i?.item?._uri ?? d?.uri ?? "";
      return {
        uri,
        name: d?.name ?? "",
        image: pickImage(d?.images?.items?.[0]?.sources, 64),
        contains: i?.curates === true,
      };
    })
    .filter((p: EditablePlaylist) => p.uri.startsWith("spotify:playlist:"));
}

export async function addToPlaylist(playlistUri: string, uris: string[]): Promise<void> {
  await query("addToPlaylist", {
    playlistUri,
    playlistItemUris: uris,
    newPosition: { moveType: "BOTTOM_OF_PLAYLIST", fromUid: null },
    interactionId: null,
  });
  clearCache(`collection:${playlistUri}`);
}
