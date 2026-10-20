import { useEffect, useRef, useState } from "react";
import { createPlaylist, save } from "../api/library";
import { library, pinInLibrary } from "../api/spotify";
import type { Card, LibraryFilter, LibrarySort } from "../api/types";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { markSaved, notifyLibraryChanged, onLibraryChanged } from "../state/saved";
import { toast } from "../state/toast";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { Cover } from "./Cover";
import { BackIcon, LibraryIcon, PlusIcon, SearchIcon } from "./icons";
import { addAll, cardMenu, TRACKS_MIME } from "./menus";
import { areSaved } from "../api/library";

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "Playlists", label: "Playlists" },
  { id: "Artists", label: "Artists" },
  { id: "Albums", label: "Albums" },
  { id: "Podcasts & Shows", label: "Podcasts" },
];

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "Recents", label: "Recents" },
  { id: "Recently Added", label: "Recently added" },
  { id: "Alphabetical", label: "Alphabetical" },
  { id: "Creator", label: "Creator" },
];

type View = "list" | "compact" | "grid";
const VIEWS: { id: View; label: string }[] = [
  { id: "list", label: "List" },
  { id: "compact", label: "Compact" },
  { id: "grid", label: "Grid" },
];

/** A setting of Your Library kept for the next start. */
function usePersisted<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = localStorage.getItem(key) as T | null;
    return saved && allowed.includes(saved) ? saved : fallback;
  });
  return [
    value,
    (v: T) => {
      localStorage.setItem(key, v);
      setValue(v);
    },
  ];
}

/**
 * Your Library: Liked Songs, saved playlists, artists, albums, podcasts and folders, loaded 50 at
 * a time. It can be filtered, searched, sorted and shown as a list, a compact list or a grid;
 * items can be pinned to the top, and folders opened.
 */
export function Sidebar() {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [filter, setFilter] = useState<LibraryFilter>(null);
  const [sort, setSort] = usePersisted<LibrarySort>("librarySort", "Recents", SORTS.map((s) => s.id));
  const [view, setView] = usePersisted<View>("libraryView", "list", VIEWS.map((v) => v.id));
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  // The folders opened, the innermost last.
  const [folders, setFolders] = useState<Card[]>([]);
  const folder = folders[folders.length - 1] ?? null;
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  // Bumped when something is saved or removed, to reload the list.
  const [version, setVersion] = useState(0);
  useEffect(() => onLibraryChanged(() => setVersion((v) => v + 1)), []);
  const query = { filter, sort, text: text.trim(), folder: folder?.uri ?? null };
  const queryKey = JSON.stringify(query);

  // Songs dragged from a list onto a playlist (added) or Liked Songs (liked).
  const [dropOn, setDropOn] = useState<string | null>(null);
  const takesSongs = (c: Card) => c.kind === "playlist" || c.kind === "liked";
  const dropSongs = (c: Card, data: string) => {
    let uris: string[];
    try {
      uris = JSON.parse(data);
    } catch {
      return;
    }
    if (!uris.length) return;
    const n = uris.length === 1 ? "1 song" : `${uris.length} songs`;
    if (c.kind === "liked") {
      save(uris).then(() => {
        uris.forEach((u) => markSaved(u, true));
        notifyLibraryChanged();
        toast(`Saved ${n} to Liked Songs`);
      }, toast);
    } else {
      // Spotify refuses it for a playlist that is not yours; the toast says so.
      addAll(c.uri, uris).then(() => toast(`Added ${n} to ${c.title}`), toast);
    }
  };
  const loadingMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setError("");
    // Typing waits for a pause.
    const id = setTimeout(
      () =>
        library(query, 0).then(
          (page) => {
            if (!alive) return;
            setItems(page.items);
            setTotal(page.total);
          },
          (e) => alive && setError(String(e)),
        ),
      query.text ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, version]);

  // Next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || loadingMore.current || items.length === 0 || items.length >= total) return;
      loadingMore.current = true;
      library(query, items.length)
        .then((page) => setItems((prev) => [...prev, ...page.items.filter((c) => !prev.some((p) => p.uri === c.uri))]))
        .catch((e) => setError(String(e)))
        .finally(() => (loadingMore.current = false));
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, total, queryKey]);

  const route = nav.route;
  const openUri = route.page === "collection" || route.page === "artist" || route.page === "show" ? route.uri : null;

  const open = (c: Card) => (c.kind === "folder" ? setFolders((f) => [...f, c]) : nav.open(c.uri));

  const pinItem = (c: Card): MenuItem[] =>
    c.pinnable
      ? [
          "separator",
          {
            label: c.pinned ? (c.kind === "folder" ? "Unpin folder" : "Unpin") : c.kind === "folder" ? "Pin folder" : "Pin",
            onClick: () =>
              pinInLibrary(c.uri, !c.pinned).then(() => {
                toast(c.pinned ? "Unpinned" : "Pinned to the top of Your Library");
                setVersion((v) => v + 1);
              }, toast),
          },
        ]
      : [];

  const onMenu = (e: React.MouseEvent, c: Card) => {
    e.preventDefault();
    const at = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {} };
    if (c.kind === "folder") return openMenu(at, [{ label: "Open", onClick: () => open(c) }, ...pinItem(c)]);
    if (c.kind === "liked") return openMenu(at, [...cardMenu(c, undefined, nav), ...pinItem(c)]);
    areSaved([c.uri]).then(
      ([saved]) => openMenu(at, [...cardMenu(c, saved, nav), ...pinItem(c)]),
      () => openMenu(at, [...cardMenu(c, undefined, nav), ...pinItem(c)]),
    );
  };

  const subtitle = (c: Card) =>
    c.kind === "liked"
      ? `Playlist • ${c.subtitle}`
      : c.kind === "artist"
        ? "Artist"
        : c.kind === "show"
          ? `Podcast • ${c.subtitle}`
          : c.kind === "folder"
            ? `Folder • ${c.subtitle}`
            : c.subtitle;

  return (
    <aside className="sidebar panel">
      <div className="sidebar-head">
        <LibraryIcon size={22} />
        <span>Your Library</span>
        <button
          className="round-btn small create-btn"
          aria-label="Create playlist"
          title="Create playlist"
          onClick={() => window.dispatchEvent(new Event(NEW_PLAYLIST_EVENT))}
        >
          <PlusIcon size={16} />
        </button>
      </div>
      {folder ? (
        <div className="library-folder-head">
          <button className="icon-btn" aria-label="Back" title="Back" onClick={() => setFolders((f) => f.slice(0, -1))}>
            <BackIcon size={18} />
          </button>
          <span className="library-folder-name" title={folder.title}>
            {folder.title}
          </span>
        </div>
      ) : (
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.label} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(filter === f.id ? null : f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="library-tools">
        {searching || text ? (
          <label className="list-search">
            <SearchIcon size={14} />
            <input
              autoFocus
              value={text}
              placeholder="Search in Your Library"
              onChange={(e) => setText(e.currentTarget.value)}
              onBlur={() => !text && setSearching(false)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                setText("");
                setSearching(false);
              }}
            />
          </label>
        ) : (
          <button className="icon-btn" aria-label="Search in Your Library" title="Search in Your Library" onClick={() => setSearching(true)}>
            <SearchIcon size={16} />
          </button>
        )}
        <select className="list-sort" value={sort} aria-label="Sort by" onChange={(e) => setSort(e.currentTarget.value as LibrarySort)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="list-sort" value={view} aria-label="View as" onChange={(e) => setView(e.currentTarget.value as View)}>
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className={`library-list ${view}`}>
        {error && <div className="muted small pad">{error}</div>}
        {!error && items.length === 0 && text.trim() && <div className="muted small pad">Nothing in Your Library matches “{text.trim()}”.</div>}
        {items.map((c) => {
          const playingHere = player.contextUri === c.uri;
          return (
            <div
              key={c.uri}
              className={`library-item ${openUri === c.uri ? "open" : ""} ${dropOn === c.uri ? "drop-target" : ""}`}
              onDragOver={(e) => {
                if (!takesSongs(c) || !e.dataTransfer.types.includes(TRACKS_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDropOn(c.uri);
              }}
              onDragLeave={() => setDropOn((d) => (d === c.uri ? null : d))}
              onDrop={(e) => {
                setDropOn(null);
                const data = e.dataTransfer.getData(TRACKS_MIME);
                if (!takesSongs(c) || !data) return;
                e.preventDefault();
                dropSongs(c, data);
              }}
              onClick={() => open(c)}
              onContextMenu={(e) => onMenu(e, c)}
              title={c.title}
            >
              {c.kind === "folder" ? (
                <div className="cover library-cover folder-cover">
                  <FolderIcon />
                </div>
              ) : (
                <Cover src={c.image} round={c.kind === "artist"} liked={c.kind === "liked"} className="library-cover" />
              )}
              <div className="library-text">
                <div className={`library-title ${playingHere ? "accent" : ""}`}>{c.title}</div>
                <div className="library-sub">
                  {c.pinned && (
                    <span className="pin" title="Pinned">
                      <PinIcon />
                    </span>
                  )}
                  {subtitle(c)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={sentinel} style={{ height: 1 }} />
      </div>
    </aside>
  );
}

/** Ctrl+N and the + button make a playlist through this, so both count names the same way. */
export const NEW_PLAYLIST_EVENT = "quackify:new-playlist";

/** Makes "My Playlist #N" (the next free N among your playlists) and opens it. */
export function useNewPlaylist() {
  const nav = useNav();
  useEffect(() => {
    const make = async () => {
      try {
        const own = await library({ filter: "Playlists", text: "My Playlist #" }, 0);
        const taken = new Set(own.items.map((c) => /^My Playlist #(\d+)$/.exec(c.title)?.[1]).filter(Boolean).map(Number));
        let n = 1;
        while (taken.has(n)) n++;
        const uri = await createPlaylist(`My Playlist #${n}`);
        notifyLibraryChanged();
        nav.open(uri);
      } catch (e) {
        toast(e);
      }
    };
    window.addEventListener(NEW_PLAYLIST_EVENT, make);
    return () => window.removeEventListener(NEW_PLAYLIST_EVENT, make);
  }, [nav]);
}

function FolderIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-5-5 5-1-1 5-5-5-4 2-2 5 1 4-4z" />
    </svg>
  );
}
