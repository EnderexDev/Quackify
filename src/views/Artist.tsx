import { useState } from "react";
import { artist, play } from "../api/spotify";
import { Shelf } from "../components/Card";
import { SaveButton } from "../components/LikeButton";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useContextMenu } from "../components/ContextMenu";
import { ShuffleIcon } from "../components/icons";
import { followMenu } from "../components/menus";
import { useNav } from "../state/nav";
import { useSaved } from "../state/saved";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { formatCount } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** An artist: header, popular tracks, releases (all of them one click away), related artists. */
export function Artist({ uri }: { uri: string }) {
  const player = usePlayer();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [following] = useSaved(uri);
  const [showAll, setShowAll] = useState(false);
  const { data, error, loading } = useAsync(() => artist(uri), uri);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;

  const top = data.topTracks;
  const topUris = top.map((t) => t.uri);
  const isCurrent = !!player.track && topUris.includes(player.track.uri);
  const shownReleases = data.albums.length + data.singles.length;
  const showDiscography =
    data.releaseCount > shownReleases ? () => nav.go({ page: "cards", source: "discography", uri, title: data.name }) : undefined;

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
        <button
          className={`icon-btn big ${player.shuffle ? "on" : ""}`}
          onClick={() => player.setShuffle(!player.shuffle)}
          aria-label={player.shuffle ? "Disable shuffle" : "Enable shuffle"}
          title={player.shuffle ? "Disable shuffle" : "Enable shuffle"}
        >
          <ShuffleIcon size={28} />
        </button>
        <SaveButton uri={uri} kind="artist" />
        <button className="more-btn" aria-label={`More options for ${data.name}`} title="More options" onClick={(e) => openMenu(e, followMenu(uri, following))}>
          •••
        </button>
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
      <Shelf title="Albums" cards={data.albums} onShowAll={showDiscography} />
      <Shelf title="Singles and EPs" cards={data.singles} onShowAll={showDiscography} />
      <Shelf
        title="Fans also like"
        cards={data.related}
        onShowAll={data.relatedCount > data.related.length ? () => nav.go({ page: "cards", source: "related", uri, title: data.name }) : undefined}
      />
      <Shelf title="Appears On" cards={data.appearsOn} />
    </div>
  );
}
