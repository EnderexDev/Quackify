// The items of the right-click menus for tracks and for cards (playlists, albums, artists).
import { addToPlaylist, areSaved, createPlaylist, editablePlaylists } from "../api/library";
import { play } from "../api/spotify";
import type { Card, Named } from "../api/types";
import { notifyLibraryChanged, setSaved } from "../state/saved";
import { toast } from "../state/toast";
import type { MenuItem } from "./ContextMenu";

type Nav = { open: (uri: string) => void };

/** open.spotify.com link for a spotify: URI. */
export function webLink(uri: string): string {
  const [, kind, id] = uri.split(":");
  return kind && id ? `https://open.spotify.com/${kind}/${id}` : uri;
}

const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast("Link copied"),
    (e) => toast(e),
  );

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
    "separator",
    { label: "Copy song link", onClick: () => copy(webLink(track.uri)) },
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
