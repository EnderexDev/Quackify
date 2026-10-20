// The app's own shapes. normalize.ts turns Spotify's GraphQL responses into these.

export type Named = { uri: string; name: string };

export type Kind = "playlist" | "album" | "artist" | "liked" | "track" | "show" | "episode" | "user";

/** Anything shown as a tile: a playlist, album, artist, the Liked Songs entry, or a song (recent searches). */
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

/** A row of cards. `uri` and `more` say whether "Show all" can open the whole section. */
export type Section = { title: string; cards: Card[]; uri: string | null; more: boolean };

/** One page of a whole section ("Show all"), a discography or a list of artists. */
export type CardPage = { title: string; cards: Card[]; total: number; next: number | null };

/** A tile of Browse all: a genre or mood, in Spotify's color. */
export type Category = { uri: string; title: string; color: string; image: string | null };

/** A genre or mood page: its title and its rows. */
export type BrowsePage = { title: string; sections: Section[] };

export type Home = { greeting: string; sections: Section[] };

export type SearchResults = {
  top: Card | null;
  tracks: Track[];
  artists: Card[];
  albums: Card[];
  playlists: Card[];
  podcasts: Card[];
  episodes: Card[];
};

export type LibraryFilter = "Playlists" | "Artists" | "Albums" | "Podcasts & Shows" | null;

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
  /** Albums plus singles and EPs: the whole discography is one "Show all" away. */
  releaseCount: number;
  appearsOn: Card[];
  /** "Fans also like". */
  related: Card[];
  relatedCount: number;
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

/** A podcast episode, as a show's list and the episode page show it. */
export type Episode = {
  uri: string;
  name: string;
  description: string;
  image: string | null;
  durationMs: number;
  /** ISO date. */
  released: string | null;
  show: Named;
  /** Where the user left it; `finished` when listened to the end. */
  playedMs: number;
  finished: boolean;
  playable: boolean;
};

/** A podcast: its header and one page of episodes, newest first. */
export type Show = {
  uri: string;
  name: string;
  publisher: string;
  description: string;
  image: string | null;
  color: string | null;
  rating: number | null;
  topics: string[];
};

export type EpisodePage = { episodes: Episode[]; total: number; next: number | null };

/** Everyone credited on a song, grouped like Spotify's credits dialog. */
export type Credits = {
  title: string;
  groups: { role: string; people: { uri: string | null; name: string; roles: string[] }[] }[];
  sources: string[];
};

/** The search tabs: everything, or one kind with every result as you scroll. */
export type SearchTab = "all" | "tracks" | "artists" | "albums" | "playlists" | "podcasts" | "episodes" | "users";

/** One page of a search tab: songs for "tracks", cards for the others. */
export type SearchPage = { tracks: Track[]; cards: Card[]; total: number; next: number | null };

/** A Spotify user's profile. Top artists and songs only come for the logged-in user. */
export type Profile = {
  uri: string;
  username: string;
  name: string;
  image: string | null;
  followers: number;
  following: number;
  isMe: boolean;
  playlists: Card[];
  playlistCount: number;
  recentArtists: Card[];
};

export type TopContent = { artists: Card[]; tracks: Track[] };
