// The items of the right-click menus for tracks and for cards (playlists, albums, artists).
import { addToPlaylist, areSaved, editablePlaylists, save, unsave } from "../api/library";
import { play, songRadio } from "../api/spotify";
import { t } from "../i18n";
import { openCredits } from "./Credits";
import type { Card, Named } from "../api/types";
import { markSaved, notifyLibraryChanged, setSaved } from "../state/saved";
import { newPlaylist } from "../state/newPlaylist";
import { notify, toast } from "../state/toast";
import type { MenuItem } from "./ContextMenu";

type Nav = { open: (uri: string, title?: string) => void };

/** open.spotify.com link for a spotify: URI. */
export function webLink(uri: string): string {
  const [, kind, id] = uri.split(":");
  return kind && id ? `https://open.spotify.com/${kind}/${id}` : uri;
}

/** Copies to the clipboard and says whether it worked. */
export const copy = (text: string, done = t("Link copied")) =>
  navigator.clipboard.writeText(text).then(
    () => notify(done),
    (e) => toast(e),
  );

/** The toast's way to the playlist something was just added to. */
const openAction = (nav: Nav, uri: string) => ({ label: t("Open"), run: () => nav.open(uri) });

/** The player Spotify gives to put a song in a web page. */
export function embedCode(uri: string): string {
  const [, kind, id] = uri.split(":");
  return `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/${kind}/${id}?utm_source=generator" width="100%" height="152" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
}

/** "Add to playlist" for one song: New playlist on top at once, then the user's playlists, ✓ where it already is. */
export function playlistPicker(track: { uri: string; name?: string }, nav: Nav): { submenuHead: MenuItem[]; submenu: () => Promise<MenuItem[]> } {
  return {
    submenuHead: [
      {
        label: t("New playlist"),
        icon: "plus",
        onClick: () => newPlaylist({ songs: async () => [track.uri], label: track.name ?? t("this song"), name: track.name }),
      },
      "separator",
    ],
    submenu: async () =>
      (await editablePlaylists(track.uri)).map((p) => ({
        label: p.name,
        checked: p.contains,
        onClick: () => addToPlaylist(p.uri, [track.uri]).then(() => notify(t("Added to {name}", { name: p.name }), { action: openAction(nav, p.uri) }), toast),
      })),
  };
}

/** Opens the "Add to playlist" list for one song as its own menu, under `anchor`. */
export async function openPlaylistPicker(
  anchor: HTMLElement,
  track: { uri: string; name?: string },
  nav: Nav,
  open: (e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) => void,
) {
  const picker = playlistPicker(track, nav);
  const items = await picker.submenu().catch((e) => (toast(e), null));
  if (!items) return;
  const r = anchor.getBoundingClientRect();
  open({ clientX: r.left, clientY: r.top, preventDefault: () => {} }, [...picker.submenuHead, ...items]);
}

export function trackMenu(
  track: { uri: string; name?: string; artists: Named[]; album: Named | null },
  saved: boolean | undefined,
  nav: Nav,
): MenuItem[] {
  return [
    {
      label: t("Add to queue"),
      icon: "queue",
      onClick: () => play.addToQueue(track.uri).then(() => notify(t("Added to queue")), toast),
    },
    { label: t("Add to playlist"), icon: "playlist-add", ...playlistPicker(track, nav) },
    {
      label: saved ? t("Remove from Liked Songs") : t("Save to Liked Songs"),
      icon: saved ? "liked" : "heart",
      hint: "Alt Shift B",
      disabled: saved === undefined,
      onClick: () => setSaved(track.uri, !saved),
    },
    "separator",
    ...(track.artists.length === 1
      ? [{ label: t("Go to artist"), icon: "user" as const, onClick: () => nav.open(track.artists[0].uri) }]
      : track.artists.length > 1
        ? [
            {
              label: t("Go to artist"),
              icon: "user" as const,
              submenu: () => track.artists.map((a) => ({ label: a.name, onClick: () => nav.open(a.uri) })),
            },
          ]
        : []),
    ...(track.album?.uri ? [{ label: t("Go to album"), icon: "disc" as const, onClick: () => nav.open(track.album!.uri) }] : []),
    ...(track.uri.startsWith("spotify:track:")
      ? [
          { label: t("Go to song radio"), icon: "radio" as const, onClick: () => songRadio(track.uri).then((u) => nav.open(u), toast) },
          { label: t("Show credits"), icon: "more" as const, onClick: () => openCredits(track.uri) },
        ]
      : []),
    "separator",
    {
      label: t("Share"),
      submenu: () => [
        { label: t("Copy song link"), onClick: () => copy(webLink(track.uri)) },
        { label: t("Embed track"), onClick: () => copy(embedCode(track.uri), t("Embed code copied")) },
      ],
    },
  ];
}

/** The drag data type for songs dragged out of a list: a JSON array of URIs. */
export const TRACKS_MIME = "application/x-quackify-tracks";

/** The menu for several selected songs at once. `allSaved`: whether every one is liked. */
export function tracksMenu(tracks: { uri: string; playable?: boolean }[], allSaved: boolean | undefined, nav: Nav): MenuItem[] {
  // Every selected song goes to a playlist or Liked Songs; the queue only takes ones that play.
  const uris = tracks.map((t) => t.uri);
  const playable = tracks.filter((t) => t.playable !== false).map((t) => t.uri);
  const n = tracks.length === 1 ? t("1 song") : t("{n} songs", { n: tracks.length });
  return [
    {
      id: "queue",
      label: t("Add to queue"),
      icon: "queue",
      hint: t("up to {n}", { n: QUEUE_LIMIT }),
      onClick: async () => {
        try {
          const queued = playable.slice(0, QUEUE_LIMIT);
          for (const u of queued) await play.addToQueue(u);
          notify(queued.length === 1 ? t("Added 1 song to the queue") : t("Added {n} songs to the queue", { n: queued.length }));
        } catch (e) {
          toast(e);
        }
      },
    },
    {
      id: "playlist",
      label: t("Add to playlist"),
      icon: "playlist-add",
      submenuHead: [
        {
          label: t("New playlist"),
          icon: "plus",
          onClick: () => newPlaylist({ songs: async () => uris, label: n }),
        },
        "separator",
      ],
      submenu: async () =>
        (await editablePlaylists(uris[0] ?? "")).map((p) => ({
          label: p.name,
          onClick: () => addAll(p.uri, uris).then(() => notify(t("Added {count} to {name}", { count: n, name: p.name }), { action: openAction(nav, p.uri) }), toast),
        })),
    },
    {
      id: "liked",
      label: allSaved ? t("Remove from Liked Songs") : t("Save to Liked Songs"),
      icon: allSaved ? "liked" : "heart",
      disabled: allSaved === undefined,
      onClick: () => {
        const want = !allSaved;
        (want ? save(uris) : unsave(uris)).then(() => {
          uris.forEach((u) => markSaved(u, want));
          notifyLibraryChanged();
          notify(want ? t("Saved {count} to Liked Songs", { count: n }) : t("Removed {count} from Liked Songs", { count: n }));
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
      ? { label: t("Play"), icon: "play", onClick: () => play.tracks([card.uri], 0).catch(toast) }
      : { label: t("Open"), onClick: () => nav.open(card.uri, card.title) },
  ];
  if (isTrack) items.push({ label: t("Add to queue"), icon: "queue", onClick: () => play.addToQueue(card.uri).catch(toast) });
  if (card.kind === "user") return [...items, "separator", { label: t("Copy link"), onClick: () => copy(webLink(card.uri)) }];
  if (card.kind !== "liked") {
    items.push({
      label: isArtist
        ? saved ? t("Unfollow") : t("Follow")
        : isTrack
          ? saved ? t("Remove from Liked Songs") : t("Save to Liked Songs")
          : saved ? t("Remove from Your Library") : t("Save to Your Library"),
      icon: isArtist ? "user" : saved ? "liked" : "heart",
      disabled: saved === undefined,
      onClick: () => setSaved(card.uri, !saved),
    });
    items.push("separator", { label: t("Copy link"), onClick: () => copy(webLink(card.uri)) });
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
      label: t("Add to queue"),
      icon: "queue",
      hint: t("up to {n}", { n: QUEUE_LIMIT }),
      onClick: async () => {
        try {
          const uris = await o.songs();
          for (const u of uris.slice(0, QUEUE_LIMIT)) await play.addToQueue(u);
          notify(uris.length > QUEUE_LIMIT ? t("Added the first {n} songs to the queue", { n: QUEUE_LIMIT }) : t("Added to queue"));
        } catch (e) {
          toast(e);
        }
      },
    },
    {
      label: t("Add to playlist"),
      icon: "playlist-add",
      submenuHead: [
        {
          label: t("New playlist"),
          icon: "plus",
          onClick: () => newPlaylist({ songs: o.songs, label: o.title, name: o.title }),
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
                .then(() => notify(t("Added to {name}", { name: p.name }), { action: openAction(o.nav, p.uri) }), toast),
          })),
    },
  ];
  if (o.kind !== "liked" && !o.own) {
    items.push({
      label: o.saved ? t("Remove from Your Library") : t("Save to Your Library"),
      icon: o.saved ? "liked" : "heart",
      disabled: o.saved === undefined,
      onClick: () => setSaved(o.uri, !o.saved),
    });
  }
  if (o.kind === "album" && o.artists.length) {
    items.push("separator");
    items.push(
      o.artists.length === 1
        ? { label: t("Go to artist"), icon: "user", onClick: () => o.nav.open(o.artists[0].uri) }
        : { label: t("Go to artist"), icon: "user", submenu: () => o.artists.map((a) => ({ label: a.name, onClick: () => o.nav.open(a.uri) })) },
    );
  }
  const copyLink: MenuItem = { label: t("Copy link"), onClick: () => copy(webLink(o.uri)) };
  // The user's own playlist, as in the Figma: Edit details and Copy link, then Delete in red last.
  if (o.own) {
    items.push("separator", { label: t("Edit details"), icon: "edit", onClick: o.onEdit });
    if (o.kind !== "liked") items.push(copyLink);
    items.push("separator", { label: t("Delete"), danger: true, onClick: o.onDelete });
  } else if (o.kind !== "liked") items.push("separator", copyLink);
  return items;
}

/** The ••• menu of an artist's or a podcast's own page. */
export function followMenu(uri: string, saved: boolean | undefined): MenuItem[] {
  return [
    { label: saved ? t("Unfollow") : t("Follow"), icon: "user", disabled: saved === undefined, onClick: () => setSaved(uri, !saved) },
    "separator",
    { label: t("Copy link"), onClick: () => copy(webLink(uri)) },
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
