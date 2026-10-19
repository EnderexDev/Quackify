import { useState } from "react";
import { artist, play } from "../api/spotify";
import { Shelf } from "../components/Card";
import { SaveButton } from "../components/LikeButton";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { formatCount } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** A simple artist page: header, popular tracks, albums and singles. */
export function Artist({ uri }: { uri: string }) {
  const player = usePlayer();
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading } = useAsync(() => artist(uri), uri);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;

  const top = data.topTracks;
  const topUris = top.map((t) => t.uri);
  const isCurrent = !!player.track && topUris.includes(player.track.uri);

  return (
    <div className="page artist">
      <header
        className="artist-hero"
        style={{ backgroundImage: data.header ? `url(${data.header})` : data.image ? `url(${data.image})` : undefined }}
      >
        <div className="artist-hero-shade" />
        <div className="artist-hero-text">
          <h1>{data.name}</h1>
          {data.monthlyListeners !== null && <p>{formatCount(data.monthlyListeners)} monthly listeners</p>}
        </div>
      </header>
      <div className="actions">
        <PlayButton
          size={56}
          playing={isCurrent && player.playing}
          onClick={() => (isCurrent ? player.toggle() : top.length && play.tracks(topUris, 0).catch(toast))}
        />
        <SaveButton uri={uri} kind="artist" />
      </div>
      {top.length > 0 && (
        <section className="artist-popular">
          <h2>Popular</h2>
          <TrackList
            tracks={showAll ? top : top.slice(0, 5)}
            showAlbum={false}
            showHeader={false}
            contextUri={null}
            onPlay={(i) => play.tracks(topUris, i).catch(toast)}
          />
          {top.length > 5 && (
            <button className="link see-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : "See more"}
            </button>
          )}
        </section>
      )}
      <Shelf title="Albums" cards={data.albums} />
      <Shelf title="Singles and EPs" cards={data.singles} />
    </div>
  );
}
