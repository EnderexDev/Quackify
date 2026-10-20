import { useEffect, useState } from "react";
import { play, recentSearches, removeRecentSearches, saveRecentSearch, search } from "../api/spotify";
import type { Card } from "../api/types";
import { CardGrid, Shelf } from "../components/Card";
import { Cover } from "../components/Cover";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useAsync } from "../util/useAsync";
import { BrowseAll } from "./Browse";
import { Failed, Loading } from "./common";

const DEBOUNCE_MS = 250;

export function Search({ term }: { term: string }) {
  // Wait for the typing to pause before asking Spotify.
  const [settled, setSettled] = useState(term.trim());
  useEffect(() => {
    const id = setTimeout(() => setSettled(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term]);

  if (!settled) {
    return (
      <div className="page search-start">
        <RecentSearches />
        <BrowseAll />
      </div>
    );
  }
  return <Results term={settled} />;
}

/** Remembers what was opened from the results, like Spotify's recent searches. */
const remember = (uri: string) => {
  saveRecentSearch(uri).catch((e) => console.warn("recent search not saved", e));
};

/** The account's recent searches: open one again, remove one, or clear them all. */
function RecentSearches() {
  const [items, setItems] = useState<Card[] | null>(null);
  useEffect(() => {
    let alive = true;
    recentSearches().then(
      (list) => alive && setItems(list),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Optimistic: gone at once, back if Spotify refuses.
  const remove = (uris: string[]) => {
    const before = items;
    setItems((list) => (list ?? []).filter((c) => !uris.includes(c.uri)));
    removeRecentSearches(uris).catch((e) => {
      toast(e);
      setItems(before);
    });
  };

  if (!items || items.length === 0) return null;
  return (
    <section className="recent-searches">
      <div className="shelf-head">
        <h2>Recent searches</h2>
        <button className="link show-all" onClick={() => remove(items.map((c) => c.uri))}>
          Clear recent searches
        </button>
      </div>
      <CardGrid cards={items.slice(0, 12)} onRemove={(c) => remove([c.uri])} oneRow />
    </section>
  );
}

function Results({ term }: { term: string }) {
  const nav = useNav();
  const player = usePlayer();
  const { data, error, loading } = useAsync(() => search(term), term);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;

  const top = data.top;
  const songs = data.tracks.slice(0, 5);
  const topIsCurrent = !!top && player.contextUri === top.uri;
  const nothing = !top && !data.tracks.length && !data.artists.length && !data.albums.length && !data.playlists.length;
  if (nothing) {
    return (
      <div className="page center">
        <p className="muted">No results for “{term}”.</p>
      </div>
    );
  }

  return (
    <div className="page search">
      <div className="search-top">
        {top && (
          <section className="top-result-wrap">
            <h2>Top result</h2>
            <div
              className="top-result"
              onClick={() => {
                remember(top.uri);
                nav.open(top.uri);
              }}
            >
              <Cover src={top.image} round={top.kind === "artist"} className="top-cover" />
              <div className="top-title">{top.title}</div>
              <div className="top-sub">
                <span className="pill">{top.kind[0].toUpperCase() + top.kind.slice(1)}</span>
                {top.kind !== "artist" && <span className="muted">{top.subtitle}</span>}
              </div>
              <PlayButton
                className="top-play"
                playing={topIsCurrent && player.playing}
                onClick={() => {
                  remember(top.uri);
                  if (topIsCurrent) player.toggle();
                  else play.context(top.uri).catch(toast);
                }}
              />
            </div>
          </section>
        )}
        {songs.length > 0 && (
          <section className="search-songs">
            <h2>Songs</h2>
            <TrackList
              tracks={songs}
              showAlbum={false}
              showHeader={false}
              contextUri={null}
              onPlay={(i) => {
                remember(data.tracks[i].uri);
                play.tracks(data.tracks.map((t) => t.uri), i).catch(toast);
              }}
            />
          </section>
        )}
      </div>
      <Shelf title="Artists" cards={data.artists} onPick={(c) => remember(c.uri)} />
      <Shelf title="Albums" cards={data.albums} onPick={(c) => remember(c.uri)} />
      <Shelf title="Playlists" cards={data.playlists} onPick={(c) => remember(c.uri)} />
    </div>
  );
}
