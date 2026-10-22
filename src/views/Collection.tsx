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
import { SearchIcon, ShuffleIcon, SortIcon } from "../components/icons";
import { OPEN_PALETTE_EVENT } from "../components/Palette";
import { PlayButton } from "../components/PlayButton";
import { TrackList } from "../components/TrackList";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { notifyLibraryChanged } from "../state/saved";
import { notify, toast } from "../state/toast";
import { formatCount, formatLength } from "../util/format";
import { kindLabel } from "../util/kinds";
import { useAsync } from "../util/useAsync";
import { Empty, Failed, Loading } from "./common";

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


/** A playlist, album or Liked Songs: header, play button, and every track (paged on scroll). */
export function Collection({ uri }: { uri: string }) {
  const { data, error, loading, retry } = useAsync(() => collection(uri, 0), uri);
  if (error) return <Failed error={error} onRetry={retry} />;
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
  // While pages are loading, the list is not edited: an edit moves the server's page offsets.
  const [bulkLoading, setBulkLoading] = useState(false);
  const loadAll = (): Promise<Track[]> => {
    if (doneRef.current) return Promise.resolve(tracksRef.current);
    if (!loadingAll.current) setBulkLoading(true);
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
    })().finally(() => {
      loadingAll.current = null;
      if (alive.current) setBulkLoading(false);
    });
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
  const removeAt = (indices: number[]) => {
    const gone = indices.map((i) => tracks[i]).filter((t) => t?.uid);
    if (gone.length === 0) return;
    const before = tracks;
    setTracks(tracks.filter((_, j) => !indices.includes(j)));
    removeFromPlaylist(
      uri,
      gone.map((t) => t.uid!),
    ).then(
      () => {
        setRemoved((n) => n + gone.length);
        notify(gone.length === 1 ? `Removed from ${title}` : `Removed ${gone.length} songs from ${title}`);
      },
      (e) => {
        setTracks(before);
        toast(e);
      },
    );
  };
  // Rows `from` (in order) go to just before row `to` (or to the end).
  const move = (from: number[], to: number) => {
    const moving = from.map((i) => tracks[i]);
    if (moving.some((t) => !t?.uid) || from.includes(to)) return;
    // Dropped right after a single row being moved: nothing changes.
    if (from.length === 1 && from[0] + 1 === to) return;
    // The first row below the drop point that is not being moved anchors the move.
    let anchorAt = to;
    while (anchorAt < tracks.length && from.includes(anchorAt)) anchorAt++;
    const anchorRow = tracks[anchorAt];
    const before = tracks;
    const rest = tracks.filter((_, j) => !from.includes(j));
    const at = anchorRow ? rest.indexOf(anchorRow) : rest.length;
    rest.splice(at, 0, ...moving);
    setTracks(rest);
    moveInPlaylist(
      uri,
      moving.map((t) => t.uid!),
      anchorRow?.uid ?? null,
    ).catch((e) => {
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
  // The length shows once every song is known: an album at once, a long playlist when all of it loaded.
  const totalMs = done ? tracks.reduce((s, t) => s + t.durationMs, 0) : 0;
  // An album's guests: artists on its songs besides its own, at most 6.
  const albumArtists = new Set(first.kind === "album" ? (tracks[0]?.artists ?? []).map((a) => a.uri) : []);
  const guests =
    first.kind === "album"
      ? [...new Map(tracks.flatMap((t) => t.artists).filter((a) => a.uri && !albumArtists.has(a.uri)).map((a) => [a.uri, a])).values()].slice(0, 6)
      : [];
  const color = first.color ?? "#3a3a3a";

  return (
    <div className="page collection" style={{ ["--tint" as string]: color }}>
      <header className={`hero ${first.kind === "album" ? "big" : ""}`}>
        <Cover src={first.image} kind={first.kind} shaped className="hero-cover" />
        <div className="hero-text">
          <span className="hero-kind">{kindLabel(first)}</span>
          <h1
            className={`hero-title ${title.length > 28 ? "long" : ""} ${own ? "editable" : ""}`}
            onClick={() => own && setDialog("edit")}
            title={own ? "Edit details" : undefined}
          >
            {title}
          </h1>
          {first.kind === "playlist" && description && <p className="hero-desc">{description}</p>}
          <p className="hero-meta">
            {first.ownerImage && <Cover src={first.ownerImage} kind={first.kind === "album" ? "artist" : "user"} className="hero-owner-image" />}
            {[
              first.owner &&
                (first.ownerUri ? (
                  <a key="o" className="hero-owner" onClick={() => nav.open(first.ownerUri!)}>
                    {first.owner}
                  </a>
                ) : (
                  <b key="o">{first.owner}</b>
                )),
              first.kind === "album" && first.description,
              `${formatCount(first.total - removed)} ${first.total - removed === 1 ? "song" : "songs"}`,
              totalMs > 0 && formatLength(totalMs),
            ]
              .filter(Boolean)
              .map((x, i) => (
                <span key={i}>
                  {i > 0 && " • "}
                  {x}
                </span>
              ))}
          </p>
          {guests.length > 0 && (
            <div className="hero-guests">
              {guests.map((g) => (
                <button key={g.uri} className="chip" onClick={() => nav.open(g.uri)}>
                  with {g.name}
                </button>
              ))}
            </div>
          )}
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
            <label className="list-sort-pill">
              <SortIcon size={14} />
              <select className="list-sort" value={sort} aria-label="Sort by" onChange={(e) => setSort(e.currentTarget.value as Sort)}>
                {(Object.keys(SORT_LABEL) as Sort[])
                  .filter((k) => first.kind !== "liked" || k !== "custom")
                  .map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABEL[k]}
                    </option>
                  ))}
              </select>
            </label>
            <label className="list-search">
              <SearchIcon size={16} />
              <input
                value={filter}
                placeholder={first.kind === "liked" ? "Search in Liked Songs" : "Search in playlist"}
                onChange={(e) => setFilter(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  setFilter("");
                  e.currentTarget.blur();
                }}
              />
            </label>
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
        showAdded={first.kind !== "album"}
        onPlay={(i) => play.context(uri, view.tracks[i].uri).catch(toast)}
        // While the rest of the list loads, rows are not removed or moved: their places are still moving.
        onRemove={first.canEditItems && !bulkLoading ? (rows) => removeAt(rows.map((i) => view.positions[i])) : undefined}
        // Dragging only means something in the list's own order.
        onMove={first.canEditItems && !reordered && !bulkLoading ? move : undefined}
        playlistName={title}
      />
      {!done && !reordered && (
        <div ref={sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
      {first.kind === "playlist" && tracks.length === 0 && done && (
        <Empty title="This playlist is empty" text="Find songs and add them with the right click, or drag them onto it in Your Library.">
          <button className="pill-btn white" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}>
            <SearchIcon size={14} />
            Find songs
          </button>
        </Empty>
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
