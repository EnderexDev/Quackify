import { useEffect, useRef, useState } from "react";
import { editPlaylist, moveInPlaylist, removeFromPlaylist, unsave } from "../api/library";
import { collection, PAGE_SIZE, play } from "../api/spotify";
import type { Collection as Data, Track } from "../api/types";
import { useContextMenu } from "../components/ContextMenu";
import { Cover } from "../components/Cover";
import { ConfirmDialog, EditDetailsDialog } from "../components/Dialog";
import { SaveButton } from "../components/LikeButton";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { notifyLibraryChanged } from "../state/saved";
import { toast } from "../state/toast";
import { formatCount, formatDuration } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

const KIND_LABEL = { playlist: "Playlist", album: "Album", liked: "Playlist", artist: "Artist", track: "Song", show: "Podcast", episode: "Episode" } as const;

/** A playlist, album or Liked Songs: header, play button, and every track (paged on scroll). */
export function Collection({ uri }: { uri: string }) {
  const { data, error, loading } = useAsync(() => collection(uri, 0), uri);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;
  return <Loaded key={uri} first={data} />;
}

function Loaded({ first }: { first: Data }) {
  const player = usePlayer();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [title, setTitle] = useState(first.title);
  const [description, setDescription] = useState(first.description);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const own = first.kind === "playlist" && first.canEditMetadata;
  // Rows removed here, so the song count follows without a reload.
  const [removed, setRemoved] = useState(0);
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

  // Optimistic: the list changes at once and comes back if Spotify refuses.
  const removeAt = (i: number) => {
    const t = tracks[i];
    if (!t.uid) return;
    const before = tracks;
    setTracks(tracks.filter((_, j) => j !== i));
    removeFromPlaylist(uri, [t.uid]).then(
      () => {
        setRemoved((n) => n + 1);
        toast(`Removed from ${title}`);
      },
      (e) => {
        setTracks(before);
        toast(e);
      },
    );
  };
  const move = (from: number, to: number) => {
    const t = tracks[from];
    if (!t.uid || from === to || from + 1 === to) return;
    const before = tracks;
    const next = tracks.filter((_, j) => j !== from);
    next.splice(to > from ? to - 1 : to, 0, t);
    setTracks(next);
    moveInPlaylist(uri, [t.uid], tracks[to]?.uid ?? null).catch((e) => {
      setTracks(before);
      toast(e);
    });
  };

  const isCurrent = player.contextUri === uri;
  const totalMs = first.kind === "album" ? tracks.reduce((s, t) => s + t.durationMs, 0) : 0;
  const color = first.color ?? "#3a3a3a";

  return (
    <div className="page collection" style={{ ["--tint" as string]: color }}>
      <header className="hero">
        <Cover src={first.image} liked={first.kind === "liked"} className="hero-cover" />
        <div className="hero-text">
          <span className="hero-kind">{KIND_LABEL[first.kind]}</span>
          <h1
            className={`hero-title ${title.length > 28 ? "long" : ""} ${own ? "editable" : ""}`}
            onClick={() => own && setDialog("edit")}
            title={own ? "Edit details" : undefined}
          >
            {title}
          </h1>
          {first.kind === "playlist" && description && <p className="hero-desc">{description}</p>}
          <p className="hero-meta">
            {[
              first.owner && <b key="o">{first.owner}</b>,
              first.kind === "album" && first.description,
              `${formatCount(first.total - removed)} ${first.total - removed === 1 ? "song" : "songs"}`,
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
        {(first.kind === "album" || (first.kind === "playlist" && !own)) && <SaveButton uri={uri} kind={first.kind} />}
        {own && (
          <button
            className="more-btn"
            aria-label="More options"
            onClick={(e) =>
              openMenu(e, [
                { label: "Edit details", onClick: () => setDialog("edit") },
                { label: "Delete", onClick: () => setDialog("delete") },
              ])
            }
          >
            •••
          </button>
        )}
      </div>
      <TrackList
        tracks={tracks}
        contextUri={uri}
        showAlbum={first.kind !== "album"}
        showCover={first.kind !== "album"}
        onPlay={(i) => play.context(uri, tracks[i].uri).catch(toast)}
        onRemove={first.canEditItems ? removeAt : undefined}
        onMove={first.canEditItems ? move : undefined}
        playlistName={title}
      />
      {!done && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
      {first.kind === "playlist" && tracks.length === 0 && done && (
        <p className="muted pad">This playlist is empty. Right-click a song anywhere and pick Add to playlist.</p>
      )}
      {dialog === "edit" && (
        <EditDetailsDialog
          name={title}
          description={description}
          onClose={() => setDialog(null)}
          onSave={async (n, d) => {
            try {
              await editPlaylist(uri, n, d);
              setTitle(n);
              setDescription(d);
              notifyLibraryChanged();
            } catch (e) {
              toast(e);
              throw e;
            }
          }}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Delete from Your Library?"
          message={`This will delete ${title} from Your Library.`}
          confirmLabel="Delete"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await unsave([uri]);
              notifyLibraryChanged();
              nav.go({ page: "home" });
            } catch (e) {
              toast(e);
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}
