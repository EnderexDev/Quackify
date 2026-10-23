// Stands in for @tauri-apps/api (core, event, app): a logged-in account with a 2000-song
// playlist, and window.__emit to fire the Rust events by hand.
const TRACKS = 2000;
const PLAYLIST = "spotify:playlist:bench";
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 5));

const rawTrack = (i: number) => ({
  uid: `uid${i}`,
  addedAt: { isoString: new Date(Date.UTC(2024, 0, 1) + i * 3600_000).toISOString() },
  itemV2: {
    data: {
      __typename: "Track",
      uri: `spotify:track:t${i}`,
      name: `Song ${i}`,
      artists: { items: [{ uri: `spotify:artist:a${i % 50}`, profile: { name: `Artist ${i % 50}` } }] },
      albumOfTrack: { uri: `spotify:album:al${i % 200}`, name: `Album ${i % 200}`, coverArt: { sources: [] } },
      trackDuration: { totalMilliseconds: 180_000 + i },
      playability: { playable: true },
    },
  },
});

const playlistCard = (i: number) => ({
  item: {
    _uri: i === 0 ? PLAYLIST : `spotify:playlist:p${i}`,
    data: { __typename: "Playlist", uri: i === 0 ? PLAYLIST : `spotify:playlist:p${i}`, name: i === 0 ? "Bench 2000" : `Playlist ${i}`, images: { items: [] } },
  },
  pinned: false,
  pinnable: true,
});

export const view = {
  local_device_id: "local",
  active_device_id: "local",
  devices: [{ id: "local", name: "Quackify", kind: "computer", volume: 0.5, is_active: true, is_local: true }],
  playback: {
    track_uri: "spotify:track:t500",
    context_uri: PLAYLIST,
    index: 500,
    is_playing: true,
    position_ms: 1000,
    duration_ms: 180_500,
    shuffle: false,
    repeat: "off",
    next_tracks: Array.from({ length: 40 }, (_, k) => ({ uri: `spotify:track:t${501 + k}`, uid: `q${k}`, provider: "context" })),
    prev_tracks: [],
  },
};

export const nowPlaying = (i: number) => ({
  uri: `spotify:track:t${i}`,
  name: `Song ${i}`,
  artists: [{ uri: `spotify:artist:a${i % 50}`, name: `Artist ${i % 50}` }],
  album: { uri: `spotify:album:al${i % 200}`, name: `Album ${i % 200}` },
  image: null,
  duration_ms: 180_000 + i,
});

function query(op: string, v: Record<string, unknown>): unknown {
  switch (op) {
    case "home": {
      // An untitled row of shortcuts, then titled shelves of 10 playlists.
      const section = (title: string, from: number) => ({
        data: { title: title ? { transformedLabel: title } : null },
        sectionItems: { items: Array.from({ length: 10 }, (_, k) => ({ content: playlistCard(from + k).item })) },
      });
      return { home: { sectionContainer: { sections: { items: [section("", 0), section("Made for you", 10), section("Recents", 20)] } } } };
    }
    case "libraryV3":
      return { me: { libraryV3: { totalCount: 30, items: Array.from({ length: 30 }, (_, i) => playlistCard(i)) } } };
    case "fetchPlaylist": {
      const offset = (v.offset as number) ?? 0;
      const limit = (v.limit as number) ?? 100;
      const n = Math.max(0, Math.min(limit, TRACKS - offset));
      return {
        playlistV2: {
          uri: PLAYLIST,
          name: "Bench 2000",
          ownerV2: { data: { name: "bench" } },
          content: { totalCount: TRACKS, items: Array.from({ length: n }, (_, k) => rawTrack(offset + k)) },
          currentUserCapabilities: { canEditItems: true, canEditMetadata: true },
        },
      };
    }
    case "areEntitiesInLibrary":
      return { lookup: (v.uris as string[]).map((u) => ({ data: { saved: u.endsWith("0") } })) };
    default:
      return {};
  }
}

/** Every command the app sent, for checks. */
export const calls: { cmd: string; args: Record<string, unknown> }[] = [];

export async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  calls.push({ cmd, args });
  switch (cmd) {
    case "spotify_restore":
      return delay({ logged_in: true, username: "bench", profile: { display_name: "Bench", image: null } });
    case "spotify_player_state":
      return delay({ connect: view, now_playing: nowPlaying(500) });
    case "spotify_query":
      return delay(query(args.op as string, args.variables as Record<string, unknown>));
    case "spotify_rootlist_has":
      return delay((args.uris as string[]).map(() => false));
    case "spotify_tracks":
      return delay((args.uris as string[]).map((u) => nowPlaying(Number(u.slice("spotify:track:t".length)))));
    default:
      return delay(null);
  }
}

const handlers = new Map<string, Set<(e: { payload: unknown }) => void>>();
export async function listen(event: string, handler: (e: { payload: unknown }) => void) {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  return () => set!.delete(handler);
}

export async function getVersion() {
  return "bench";
}

Object.assign(window, {
  __emit: (event: string, payload: unknown) => handlers.get(event)?.forEach((h) => h({ payload })),
  __bench: { view, nowPlaying, calls },
});
