// Writes to the user's library and playlists, and the reads that go with them.
import { invoke } from "@tauri-apps/api/core";
import { clearCache } from "./spotify";
import { pickImage } from "./normalize";

function query(op: string, variables: Record<string, unknown>): Promise<unknown> {
  return invoke("spotify_query", { op, variables });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const isPlaylist = (uri: string) => uri.startsWith("spotify:playlist:");

/** Whether each URI (track, album, playlist, artist) is in the library, in order. Playlists
 * live in the rootlist, which the GraphQL library lookup does not cover. */
export async function areSaved(uris: string[]): Promise<boolean[]> {
  const playlists = uris.filter(isPlaylist);
  const others = uris.filter((u) => !isPlaylist(u));
  const [p, o] = await Promise.all([
    playlists.length ? invoke<boolean[]>("spotify_rootlist_has", { uris: playlists }) : Promise.resolve([]),
    others.length
      ? (query("areEntitiesInLibrary", { uris: others }) as Promise<Raw>).then((d) =>
          (d?.lookup ?? []).map((x: Raw) => x?.data?.saved === true),
        )
      : Promise.resolve([]),
  ]);
  const answers = new Map<string, boolean>();
  playlists.forEach((u, i) => answers.set(u, p[i] ?? false));
  others.forEach((u, i) => answers.set(u, o[i] ?? false));
  return uris.map((u) => answers.get(u) ?? false);
}

/** Saves tracks (Liked Songs), albums, playlists, or follows artists. */
export async function save(uris: string[]): Promise<void> {
  for (const u of uris.filter(isPlaylist)) await invoke("spotify_rootlist_change", { uri: u, add: true });
  const others = uris.filter((u) => !isPlaylist(u));
  if (others.length) await query("addToLibrary", { libraryItemUris: others, interactionId: null });
  clearCache("library:");
  clearCache("collection:spotify:collection");
}

export async function unsave(uris: string[]): Promise<void> {
  for (const u of uris.filter(isPlaylist)) await invoke("spotify_rootlist_change", { uri: u, add: false });
  const others = uris.filter((u) => !isPlaylist(u));
  if (others.length) await query("removeFromLibrary", { libraryItemUris: others });
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

export async function removeFromPlaylist(playlistUri: string, uids: string[]): Promise<void> {
  await query("removeFromPlaylist", { playlistUri, uids });
  clearCache(`collection:${playlistUri}`);
}

/** Moves rows (by uid) to just before `beforeUid`, or to the end when it is null. */
export async function moveInPlaylist(playlistUri: string, uids: string[], beforeUid: string | null): Promise<void> {
  await query("moveItemsInPlaylist", {
    playlistUri,
    uids,
    newPosition: beforeUid
      ? { moveType: "BEFORE_UID", fromUid: beforeUid }
      : { moveType: "BOTTOM_OF_PLAYLIST", fromUid: null },
  });
  clearCache(`collection:${playlistUri}`);
}

/** Creates a playlist at the top of the library and returns its URI. */
export async function createPlaylist(name: string): Promise<string> {
  const uri = await invoke<string>("spotify_create_playlist", { name });
  clearCache("library:");
  return uri;
}

export async function editPlaylist(uri: string, name: string, description: string): Promise<void> {
  await invoke("spotify_edit_playlist", { uri, name, description });
  clearCache(`collection:${uri}`);
  clearCache("library:");
}
