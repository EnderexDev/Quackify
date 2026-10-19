import { useEffect, useRef, useState } from "react";
import { collection, PAGE_SIZE, play } from "../api/spotify";
import type { Collection as Data, Track } from "../api/types";
import { Cover } from "../components/Cover";
import { SaveButton } from "../components/LikeButton";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { formatCount, formatDuration } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

const KIND_LABEL = { playlist: "Playlist", album: "Album", liked: "Playlist", artist: "Artist" } as const;

/** A playlist, album or Liked Songs: header, play button, and every track (paged on scroll). */
export function Collection({ uri }: { uri: string }) {
  const { data, error, loading } = useAsync(() => collection(uri, 0), uri);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;
  return <Loaded key={uri} first={data} />;
}

function Loaded({ first }: { first: Data }) {
  const player = usePlayer();
  const [tracks, setTracks] = useState<Track[]>(first.tracks);
  const [done, setDone] = useState(first.tracks.length >= first.total || first.tracks.length < PAGE_SIZE);
  const loadingMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const uri = first.uri;

  // Next page when the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loadingMore.current) return;
        loadingMore.current = true;
        collection(uri, tracks.length)
          .then((page) => {
            setTracks((prev) => [...prev, ...page.tracks]);
            if (page.tracks.length < PAGE_SIZE || tracks.length + page.tracks.length >= first.total) setDone(true);
          })
          .catch((e) => {
            toast(e);
            setDone(true);
          })
          .finally(() => (loadingMore.current = false));
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tracks.length, done, uri, first.total]);

  const isCurrent = player.contextUri === uri;
  const totalMs = first.kind === "album" ? tracks.reduce((s, t) => s + t.durationMs, 0) : 0;
  const color = first.color ?? "#3a3a3a";

  return (
    <div className="page collection" style={{ ["--tint" as string]: color }}>
      <header className="hero">
        <Cover src={first.image} liked={first.kind === "liked"} className="hero-cover" />
        <div className="hero-text">
          <span className="hero-kind">{KIND_LABEL[first.kind]}</span>
          <h1 className={`hero-title ${first.title.length > 28 ? "long" : ""}`}>{first.title}</h1>
          {first.kind === "playlist" && first.description && <p className="hero-desc">{first.description}</p>}
          <p className="hero-meta">
            {[
              first.owner && <b key="o">{first.owner}</b>,
              first.kind === "album" && first.description,
              `${formatCount(first.total)} songs`,
              totalMs > 0 && formatDuration(totalMs),
            ]
              .filter(Boolean)
              .map((x, i) => (
                <span key={i}>
                  {i > 0 && " • "}
                  {x}
                </span>
              ))}
          </p>
        </div>
      </header>
      <div className="actions">
        <PlayButton
          size={56}
          playing={isCurrent && player.playing}
          onClick={() => (isCurrent ? player.toggle() : play.context(uri).catch(toast))}
        />
        {(first.kind === "album" || first.kind === "playlist") && <SaveButton uri={uri} kind={first.kind} />}
      </div>
      <TrackList
        tracks={tracks}
        contextUri={uri}
        showAlbum={first.kind !== "album"}
        showCover={first.kind !== "album"}
        onPlay={(i) => play.context(uri, tracks[i].uri).catch(toast)}
      />
      {!done && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
    </div>
  );
}
