import { useEffect, useState } from "react";
import { play, search } from "../api/spotify";
import { Shelf } from "../components/Card";
import { Cover } from "../components/Cover";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useAsync } from "../util/useAsync";
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
      <div className="page center">
        <p className="muted">Search for songs, artists, albums or playlists.</p>
      </div>
    );
  }
  return <Results term={settled} />;
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
            <div className="top-result" onClick={() => nav.open(top.uri)}>
              <Cover src={top.image} round={top.kind === "artist"} className="top-cover" />
              <div className="top-title">{top.title}</div>
              <div className="top-sub">
                <span className="pill">{top.kind[0].toUpperCase() + top.kind.slice(1)}</span>
                {top.kind !== "artist" && <span className="muted">{top.subtitle}</span>}
              </div>
              <PlayButton
                className="top-play"
                playing={topIsCurrent && player.playing}
                onClick={() => (topIsCurrent ? player.toggle() : play.context(top.uri).catch(toast))}
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
              onPlay={(i) => play.tracks(data.tracks.map((t) => t.uri), i).catch(toast)}
            />
          </section>
        )}
      </div>
      <Shelf title="Artists" cards={data.artists} />
      <Shelf title="Albums" cards={data.albums} />
      <Shelf title="Playlists" cards={data.playlists} />
    </div>
  );
}
