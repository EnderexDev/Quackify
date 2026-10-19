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
