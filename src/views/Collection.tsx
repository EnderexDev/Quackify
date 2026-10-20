import { useEffect, useMemo, useRef, useState } from "react";
import { editPlaylist, moveInPlaylist, removeFromPlaylist, unsave } from "../api/library";
import { collection, PAGE_SIZE, play } from "../api/spotify";
import type { Collection as Data, Track } from "../api/types";
import { useContextMenu } from "../components/ContextMenu";
import { Cover } from "../components/Cover";
import { ConfirmDialog, EditDetailsDialog } from "../components/Dialog";
import { SaveButton } from "../components/LikeButton";
import { collectionMenu } from "../components/menus";
import { useSaved } from "../state/saved";
import { SearchIcon, ShuffleIcon } from "../components/icons";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { notifyLibraryChanged } from "../state/saved";
import { toast } from "../state/toast";
import { formatCount, formatDuration } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

type Sort = "custom" | "added" | "title" | "artist" | "album" | "duration";

const SORT_LABEL: Record<Sort, string> = {
  custom: "Custom order",
  added: "Date added",
  title: "Title",
  artist: "Artist",
  album: "Album",
  duration: "Duration",
};

const byText = (pick: (t: Track) => string) => (a: Track, b: Track) =>
  pick(a).localeCompare(pick(b), undefined, { sensitivity: "base" });
const COMPARE: Record<Exclude<Sort, "custom">, (a: Track, b: Track) => number> = {
  // Newest first, like Spotify.
  added: (a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""),
  title: byText((t) => t.name),
  artist: byText((t) => t.artists[0]?.name ?? ""),
  album: byText((t) => t.album?.name ?? ""),
  duration: (a, b) => a.durationMs - b.durationMs,
};

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
  const [saved] = useSaved(first.kind === "album" || (first.kind === "playlist" && !own) ? uri : undefined);
  // Search and sort, for playlists and Liked Songs. Liked Songs comes newest first already.
  const listTools = first.kind !== "album";
  const naturalSort: Sort = first.kind === "liked" ? "added" : "custom";
  const [sort, setSort] = useState<Sort>(naturalSort);
  const [filter, setFilter] = useState("");
  const [searching, setSearching] = useState(false);
  const reordered = sort !== naturalSort || filter.trim() !== "";

  // Every page, for sorting, searching and whole-list actions: they need all the songs.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const doneRef = useRef(done);
  doneRef.current = done;
  const loadingAll = useRef<Promise<Track[]> | null>(null);
  // Loading every page stops when the page closes.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const loadAll = (): Promise<Track[]> => {
    if (doneRef.current) return Promise.resolve(tracksRef.current);
    loadingAll.current ??= (async () => {
      // Only the pages fetched here are added, onto whatever the list is by then, so an edit
      // made meanwhile is kept.
      const fetched: Track[] = [];
      let at = tracksRef.current.length;
      while (alive.current && at < first.total) {
        const page = await collection(uri, at);
        if (page.tracks.length === 0) break;
        fetched.push(...page.tracks);
        at += page.tracks.length;
      }
      if (!alive.current) throw new Error("left the page");
      const all = [...tracksRef.current, ...fetched];
      setTracks((prev) => [...prev, ...fetched]);
      setDone(true);
      return all;
    })().finally(() => (loadingAll.current = null));
    return loadingAll.current;
  };
  const [loadingForView, setLoadingForView] = useState(false);
  useEffect(() => {
    if (!reordered || done) return;
    setLoadingForView(true);
    loadAll()
      .catch((e) => alive.current && toast(e))
      .finally(() => alive.current && setLoadingForView(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reordered, done]);

  // The rows shown, and where each sits in the list's own order.
  const view = useMemo(() => {
    let rows = tracks.map((t, i) => ({ t, i }));
    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter(({ t }) =>
        [t.name, t.album?.name ?? "", ...t.artists.map((a) => a.name)].some((x) => x.toLowerCase().includes(q)),
      );
    }
    if (sort !== naturalSort && sort !== "custom") rows = [...rows].sort((a, b) => COMPARE[sort](a.t, b.t));
    return { tracks: rows.map((r) => r.t), positions: rows.map((r) => r.i) };
  }, [tracks, filter, sort, naturalSort]);

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

  // Optimistic: the list changes at once and comes back if Spotify refuses. `i` is the row's
  // place in the list's own order.
  const removeAt = (i: number) => {
    const t = tracks[i];
    if (!t?.uid) return;
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
  const playList = () => (isCurrent ? player.toggle() : play.context(uri).catch(toast));
  const openMore = (e: React.MouseEvent) =>
    openMenu(
      e,
      collectionMenu({
        kind: first.kind as "playlist" | "album" | "liked",
        uri,
        title,
        saved,
        own,
        artists: first.kind === "album" ? (tracks[0]?.artists ?? []) : [],
        songs: () => loadAll().then((all) => all.filter((t) => t.playable).map((t) => t.uri)),
        nav,
        onEdit: () => setDialog("edit"),
        onDelete: () => setDialog("delete"),
      }),
    );
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
        <PlayButton size={56} playing={isCurrent && player.playing} onClick={playList} />
        <button
          className={`icon-btn big ${player.shuffle ? "on" : ""}`}
          onClick={() => player.setShuffle(!player.shuffle)}
          aria-label={player.shuffle ? "Disable shuffle" : "Enable shuffle"}
          title={player.shuffle ? "Disable shuffle" : "Enable shuffle"}
        >
          <ShuffleIcon size={28} />
        </button>
        {(first.kind === "album" || (first.kind === "playlist" && !own)) && <SaveButton uri={uri} kind={first.kind} />}
        <button className="more-btn" aria-label={`More options for ${title}`} title="More options" onClick={openMore}>
          •••
        </button>
        {listTools && (
          <div className="list-tools">
            {searching || filter ? (
              <label className="list-search">
                <SearchIcon size={16} />
                <input
                  autoFocus
                  value={filter}
                  placeholder={first.kind === "liked" ? "Search in Liked Songs" : "Search in playlist"}
                  onChange={(e) => setFilter(e.currentTarget.value)}
                  onBlur={() => !filter && setSearching(false)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    setFilter("");
                    setSearching(false);
                  }}
                />
              </label>
            ) : (
              <button
                className="icon-btn"
                aria-label="Search in this list"
                title="Search in this list"
                onClick={() => setSearching(true)}
              >
                <SearchIcon size={18} />
              </button>
            )}
            <select className="list-sort" value={sort} aria-label="Sort by" onChange={(e) => setSort(e.currentTarget.value as Sort)}>
              {(Object.keys(SORT_LABEL) as Sort[])
                .filter((k) => first.kind !== "liked" || k !== "custom")
                .map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
      {loadingForView && (
        <div className="more">
          <div className="spinner small" />
        </div>
      )}
      {reordered && !loadingForView && view.tracks.length === 0 && (
        <p className="muted pad">No songs match “{filter.trim()}”.</p>
      )}
      <TrackList
        tracks={view.tracks}
        positions={reordered ? view.positions : undefined}
        contextUri={uri}
        showAlbum={first.kind !== "album"}
        showCover={first.kind !== "album"}
        onPlay={(i) => play.context(uri, view.tracks[i].uri).catch(toast)}
        // While the rest of the list loads, rows are not removed: their places are still moving.
        onRemove={first.canEditItems && !loadingForView ? (i) => removeAt(view.positions[i]) : undefined}
        // Dragging only means something in the list's own order.
        onMove={first.canEditItems && !reordered ? move : undefined}
        playlistName={title}
      />
      {!done && !reordered && (
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
