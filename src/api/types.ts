// The app's own shapes. normalize.ts turns Spotify's GraphQL responses into these.

export type Named = { uri: string; name: string };

export type Kind = "playlist" | "album" | "artist" | "liked";

/** Anything shown as a tile: a playlist, album, artist or the Liked Songs entry. */
export type Card = {
  uri: string;
  kind: Kind;
  title: string;
  subtitle: string;
  image: string | null;
};

export type Track = {
  uri: string;
  name: string;
  artists: Named[];
  album: Named | null;
  image: string | null;
  durationMs: number;
  playable: boolean;
  addedAt: string | null;
  /** Which row of a playlist this is (two copies of a song have different uids). */
  uid: string | null;
};

export type Section = { title: string; cards: Card[] };

export type Home = { greeting: string; sections: Section[] };

export type SearchResults = {
  top: Card | null;
  tracks: Track[];
  artists: Card[];
  albums: Card[];
  playlists: Card[];
};

export type LibraryFilter = "Playlists" | "Artists" | "Albums" | null;

export type LibraryPage = { items: Card[]; total: number };

/** A playlist, album or Liked Songs: the header plus one page of its tracks. */
export type Collection = {
  uri: string;
  kind: Kind;
  title: string;
  description: string;
  owner: string;
  image: string | null;
  color: string | null;
  total: number;
  tracks: Track[];
  /** The user can add, remove and reorder songs. */
  canEditItems: boolean;
  /** The user can rename it and change the description. */
  canEditMetadata: boolean;
};

export type Artist = {
  uri: string;
  name: string;
  image: string | null;
  header: string | null;
  monthlyListeners: number | null;
  topTracks: Track[];
  albums: Card[];
  singles: Card[];
};

/** A song's lyrics. When `synced`, each line starts at `start_ms`. Colors are `#rrggbb`. */
export type Lyrics = {
  synced: boolean;
  lines: { start_ms: number; words: string }[];
  provider: string;
  background: string | null;
  text: string | null;
  highlight: string | null;
};

/** What the Now Playing panel shows besides the track: its main artist and its credits. */
export type TrackDetails = {
  artist: {
    uri: string;
    name: string;
    image: string | null;
    monthlyListeners: number | null;
    bio: string;
    verified: boolean;
  } | null;
  credits: { uri: string | null; name: string; roles: string[] }[];
};
