// The items of the right-click menus for tracks and for cards (playlists, albums, artists).
import { addToPlaylist, areSaved, createPlaylist, editablePlaylists, save, unsave } from "../api/library";
import { play, songRadio } from "../api/spotify";
import { openCredits } from "./Credits";
import type { Card, Named } from "../api/types";
import { markSaved, notifyLibraryChanged, setSaved } from "../state/saved";
import { toast } from "../state/toast";
import type { MenuItem } from "./ContextMenu";

type Nav = { open: (uri: string) => void };

/** open.spotify.com link for a spotify: URI. */
export function webLink(uri: string): string {
  const [, kind, id] = uri.split(":");
  return kind && id ? `https://open.spotify.com/${kind}/${id}` : uri;
}

/** Copies to the clipboard and says whether it worked. */
export const copy = (text: string, done = "Link copied") =>
  navigator.clipboard.writeText(text).then(
    () => toast(done),
    (e) => toast(e),
  );

/** The player Spotify gives to put a song in a web page. */
export function embedCode(uri: string): string {
  const [, kind, id] = uri.split(":");
  return `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/${kind}/${id}?utm_source=generator" width="100%" height="152" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
}

export function trackMenu(
  track: { uri: string; name?: string; artists: Named[]; album: Named | null },
  saved: boolean | undefined,
  nav: Nav,
): MenuItem[] {
  return [
    {
      label: "Add to queue",
      onClick: () => play.addToQueue(track.uri).then(() => toast("Added to queue"), toast),
    },
    {
      label: "Add to playlist",
      submenuHead: [
        {
          label: "New playlist",
          onClick: () =>
            createPlaylist((track as { name?: string }).name ?? "New playlist")
              .then((uri) => addToPlaylist(uri, [track.uri]).then(() => uri))
              .then((uri) => {
                notifyLibraryChanged();
                toast("Added to a new playlist");
                nav.open(uri);
              }, toast),
        },
        "separator",
      ],
      submenu: async () => [
        ...(await editablePlaylists(track.uri)).map((p) => ({
          label: p.name,
          checked: p.contains,
          onClick: () => addToPlaylist(p.uri, [track.uri]).then(() => toast(`Added to ${p.name}`), toast),
        })),
      ],
    },
    {
      label: saved ? "Remove from Liked Songs" : "Save to Liked Songs",
      disabled: saved === undefined,
      onClick: () => setSaved(track.uri, !saved),
    },
    "separator",
    ...(track.artists.length === 1
      ? [{ label: "Go to artist", onClick: () => nav.open(track.artists[0].uri) }]
      : track.artists.length > 1
        ? [
            {
              label: "Go to artist",
              submenu: () => track.artists.map((a) => ({ label: a.name, onClick: () => nav.open(a.uri) })),
            },
          ]
        : []),
    ...(track.album?.uri ? [{ label: "Go to album", onClick: () => nav.open(track.album!.uri) }] : []),
    ...(track.uri.startsWith("spotify:track:")
      ? [
          { label: "Go to song radio", onClick: () => songRadio(track.uri).then((u) => nav.open(u), toast) },
          { label: "Show credits", onClick: () => openCredits(track.uri) },
        ]
      : []),
    "separator",
    {
      label: "Share",
      submenu: () => [
        { label: "Copy song link", onClick: () => copy(webLink(track.uri)) },
        { label: "Embed track", onClick: () => copy(embedCode(track.uri), "Embed code copied") },
      ],
    },
  ];
}

/** The drag data type for songs dragged out of a list: a JSON array of URIs. */
export const TRACKS_MIME = "application/x-quackify-tracks";

/** The menu for several selected songs at once. `allSaved`: whether every one is liked. */
export function tracksMenu(tracks: { uri: string; playable?: boolean }[], allSaved: boolean | undefined, nav: Nav): MenuItem[] {
  const uris = tracks.filter((t) => t.playable !== false).map((t) => t.uri);
  const n = `${tracks.length} songs`;
  return [
    {
      label: "Add to queue",
      onClick: async () => {
        try {
          for (const u of uris.slice(0, QUEUE_LIMIT)) await play.addToQueue(u);
          toast(`Added ${Math.min(uris.length, QUEUE_LIMIT)} songs to the queue`);
        } catch (e) {
          toast(e);
        }
      },
    },
    {
      label: "Add to playlist",
      submenuHead: [
        {
          label: "New playlist",
          onClick: () =>
            createPlaylist("New playlist")
              .then(async (created) => {
                await addAll(created, uris);
                notifyLibraryChanged();
                toast(`Added ${n} to a new playlist`);
                nav.open(created);
              })
              .catch(toast),
        },
        "separator",
      ],
      submenu: async () =>
        (await editablePlaylists(uris[0] ?? "")).map((p) => ({
          label: p.name,
          onClick: () => addAll(p.uri, uris).then(() => toast(`Added ${n} to ${p.name}`), toast),
        })),
    },
    {
      label: allSaved ? "Remove from Liked Songs" : "Save to Liked Songs",
      disabled: allSaved === undefined,
      onClick: () => {
        const want = !allSaved;
        (want ? save(uris) : unsave(uris)).then(() => {
          uris.forEach((u) => markSaved(u, want));
          notifyLibraryChanged();
          toast(want ? `Saved ${n} to Liked Songs` : `Removed ${n} from Liked Songs`);
        }, toast);
      },
    },
  ];
}

export function cardMenu(card: Card, saved: boolean | undefined, nav: Nav): MenuItem[] {
  const isArtist = card.kind === "artist" || card.kind === "show";
  // A song or an episode: the card itself plays.
  const isTrack = card.kind === "track" || card.kind === "episode";
  const items: MenuItem[] = [
    isTrack
      ? { label: "Play", onClick: () => play.tracks([card.uri], 0).catch(toast) }
      : { label: "Open", onClick: () => nav.open(card.uri) },
  ];
  if (isTrack) items.push({ label: "Add to queue", onClick: () => play.addToQueue(card.uri).catch(toast) });
  if (card.kind !== "liked") {
    items.push({
      label: isArtist
        ? saved ? "Unfollow" : "Follow"
        : isTrack
          ? saved ? "Remove from Liked Songs" : "Save to Liked Songs"
          : saved ? "Remove from Your Library" : "Save to Your Library",
      disabled: saved === undefined,
      onClick: () => setSaved(card.uri, !saved),
    });
    items.push("separator", { label: "Copy link", onClick: () => copy(webLink(card.uri)) });
  }
  return items;
}

/** How many songs "Add to queue" takes from a whole list, one command each. */
export const QUEUE_LIMIT = 100;
/** Spotify adds at most this many songs to a playlist per request. */
const ADD_BATCH = 100;

export async function addAll(playlistUri: string, uris: string[]) {
  for (let i = 0; i < uris.length; i += ADD_BATCH) await addToPlaylist(playlistUri, uris.slice(i, i + ADD_BATCH));
}

/**
 * The ••• menu of a playlist, album or Liked Songs. `songs` loads every song of the list (it may
 * be paged); the other entries depend on what the list is and whether it is the user's own.
 */
export function collectionMenu(o: {
  kind: "playlist" | "album" | "liked";
  uri: string;
  title: string;
  saved: boolean | undefined;
  own: boolean;
  artists: Named[];
  songs: () => Promise<string[]>;
  nav: Nav;
  onEdit?: () => void;
  onDelete?: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: "Add to queue",
      onClick: async () => {
        try {
          const uris = await o.songs();
          for (const u of uris.slice(0, QUEUE_LIMIT)) await play.addToQueue(u);
          toast(uris.length > QUEUE_LIMIT ? `Added the first ${QUEUE_LIMIT} songs to the queue` : "Added to queue");
        } catch (e) {
          toast(e);
        }
      },
    },
    {
      label: "Add to playlist",
      submenuHead: [
        {
          label: "New playlist",
          onClick: () =>
            o
              .songs()
              .then(async (uris) => {
                const created = await createPlaylist(o.title);
                await addAll(created, uris);
                notifyLibraryChanged();
                toast("Added to a new playlist");
                o.nav.open(created);
              })
              .catch(toast),
        },
        "separator",
      ],
      // The lookup takes a song, not a list: any song of the list does to get the playlists.
      submenu: async () =>
        (await editablePlaylists((await o.songs())[0] ?? o.uri))
          .filter((p) => p.uri !== o.uri)
          .map((p) => ({
            label: p.name,
            onClick: () =>
              o
                .songs()
                .then((uris) => addAll(p.uri, uris))
                .then(() => toast(`Added to ${p.name}`), toast),
          })),
    },
  ];
  if (o.kind !== "liked" && !o.own) {
    items.push({
      label: o.saved ? "Remove from Your Library" : "Save to Your Library",
      disabled: o.saved === undefined,
      onClick: () => setSaved(o.uri, !o.saved),
    });
  }
  if (o.kind === "album" && o.artists.length) {
    items.push("separator");
    items.push(
      o.artists.length === 1
        ? { label: "Go to artist", onClick: () => o.nav.open(o.artists[0].uri) }
        : { label: "Go to artist", submenu: () => o.artists.map((a) => ({ label: a.name, onClick: () => o.nav.open(a.uri) })) },
    );
  }
  if (o.own) {
    items.push("separator", { label: "Edit details", onClick: o.onEdit }, { label: "Delete", onClick: o.onDelete });
  }
  if (o.kind !== "liked") items.push("separator", { label: "Copy link", onClick: () => copy(webLink(o.uri)) });
  return items;
}

/** The ••• menu of an artist's or a podcast's own page. */
export function followMenu(uri: string, saved: boolean | undefined): MenuItem[] {
  return [
    { label: saved ? "Unfollow" : "Follow", disabled: saved === undefined, onClick: () => setSaved(uri, !saved) },
    "separator",
    { label: "Copy link", onClick: () => copy(webLink(uri)) },
  ];
}

/** onContextMenu for a card: asks whether it is saved, then opens its menu. */
export function cardMenuHandler(
  card: Card,
  nav: Nav,
  openMenu: (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void,
) {
  return (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    e.preventDefault();
    const at = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {} };
    if (card.kind === "liked") return openMenu(at, cardMenu(card, undefined, nav));
    areSaved([card.uri]).then(
      ([saved]) => openMenu(at, cardMenu(card, saved, nav)),
      () => openMenu(at, cardMenu(card, undefined, nav)),
    );
  };
}
