import { useEffect, useRef, useState } from "react";
import { library } from "../api/spotify";
import type { Card, LibraryFilter } from "../api/types";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { onLibraryChanged } from "../state/saved";
import { useContextMenu } from "./ContextMenu";
import { Cover } from "./Cover";
import { cardMenuHandler } from "./menus";
import { createPlaylist } from "../api/library";
import { toast } from "../state/toast";
import { LibraryIcon, PlusIcon } from "./icons";

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "Playlists", label: "Playlists" },
  { id: "Artists", label: "Artists" },
  { id: "Albums", label: "Albums" },
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
      <div className="library-list">
        {error && <div className="muted small pad">{error}</div>}
        {items.map((c) => {
          const playingHere = player.contextUri === c.uri;
          return (
            <div
              key={c.uri}
              className={`library-item ${openUri === c.uri ? "open" : ""}`}
              onClick={() => nav.open(c.uri)}
              onContextMenu={cardMenuHandler(c, nav, openMenu)}
              title={c.title}
            >
              <Cover src={c.image} round={c.kind === "artist"} liked={c.kind === "liked"} className="library-cover" />
              <div className="library-text">
                <div className={`library-title ${playingHere ? "accent" : ""}`}>{c.title}</div>
                <div className="library-sub">
                  {c.kind === "liked" ? `Playlist • ${c.subtitle}` : c.kind === "artist" ? "Artist" : c.subtitle}
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
