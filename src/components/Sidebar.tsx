import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { library } from "../api/spotify";
import type { Card, LibraryFilter } from "../api/types";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { useContextMenu } from "./ContextMenu";
import { Cover } from "./Cover";
import { addAll, cardMenuHandler, TRACKS_MIME } from "./menus";
import { save } from "../api/library";
import { markSaved, notifyLibraryChanged, onLibraryChanged } from "../state/saved";
import { createPlaylist } from "../api/library";
import { toast } from "../state/toast";
import { LibraryIcon, PlusIcon } from "./icons";

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "Playlists", label: "Playlists" },
  { id: "Artists", label: "Artists" },
  { id: "Albums", label: "Albums" },
  { id: "Podcasts & Shows", label: "Podcasts" },
];

/** Your Library: Liked Songs, saved playlists, artists and albums, loaded 50 at a time. */
export function Sidebar() {
  const nav = useNav();
  const player = usePlayer();
  const openMenu = useContextMenu();
  const [filter, setFilter] = useState<LibraryFilter>(null);
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  // Bumped when something is saved or removed, to reload the list.
  const [version, setVersion] = useState(0);
  useEffect(() => onLibraryChanged(() => setVersion((v) => v + 1)), []);
  // The compact layout is a setting; it changes from the Settings page or another window.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const read = () =>
      invoke<{ settings: { compact_library: boolean } }>("settings_get").then((v) => setCompact(v.settings.compact_library), () => {});
    read();
    const off = listen("settings-changed", read);
    return () => {
      off.then((f) => f());
    };
  }, []);
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
    setItems([]);
    setTotal(0);
    setError("");
    library(filter, 0).then(
      (page) => {
        if (!alive) return;
        setItems(page.items);
        setTotal(page.total);
      },
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [filter, version]);

  // Next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || loadingMore.current || items.length === 0 || items.length >= total) return;
      loadingMore.current = true;
      library(filter, items.length)
        .then((page) => setItems((prev) => [...prev, ...page.items.filter((c) => !prev.some((p) => p.uri === c.uri))]))
        .catch((e) => setError(String(e)))
        .finally(() => (loadingMore.current = false));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [items, total, filter]);

  const route = nav.route;
  const openUri = route.page === "collection" || route.page === "artist" ? route.uri : null;

  return (
    <aside className="sidebar panel">
      <div className="sidebar-head">
        <LibraryIcon size={22} />
        <span>Your Library</span>
        <button
          className="round-btn small create-btn"
          aria-label="Create playlist"
          title="Create playlist"
          onClick={() => {
            const n = items.filter((c) => /^My Playlist #d+$/.test(c.title)).length + 1;
            createPlaylist(`My Playlist #${n}`).then((uri) => {
              setVersion((v) => v + 1);
              nav.open(uri);
            }, toast);
          }}
        >
          <PlusIcon size={16} />
        </button>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            className={`chip ${filter === f.id ? "on" : ""}`}
            onClick={() => setFilter(filter === f.id ? null : f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className={`library-list ${compact ? "compact" : ""}`}>
        {error && <div className="muted small pad">{error}</div>}
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
              onClick={() => nav.open(c.uri)}
              onContextMenu={cardMenuHandler(c, nav, openMenu)}
              title={c.title}
            >
              <Cover src={c.image} round={c.kind === "artist"} liked={c.kind === "liked"} className="library-cover" />
              <div className="library-text">
                <div className={`library-title ${playingHere ? "accent" : ""}`}>{c.title}</div>
                <div className="library-sub">
                  {c.kind === "liked" ? `Playlist • ${c.subtitle}` : c.kind === "artist" ? "Artist" : c.kind === "show" ? `Podcast • ${c.subtitle}` : c.subtitle}
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
