import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { libraryCounts, type LibraryCounts } from "../api/spotify";
import type { Card, LibraryFilter, LibrarySort } from "../api/types";
import { locale, t } from "../i18n";
import { useNav } from "../state/nav";
import { usePlayerSelect } from "../state/player";
import { newPlaylist } from "../state/newPlaylist";
import { onLibraryChanged } from "../state/saved";
import { DRAGGABLE, dragCard } from "../state/drag";
import { peekProps } from "../state/peek";
import { useAsync } from "../util/useAsync";
import { Cover } from "./Cover";
import { ChevronDownIcon, ChevronRightIcon, DiscIcon, HeartIcon, LibraryIcon, PinIcon, PlaylistIcon, PlusIcon, PodcastIcon, SearchIcon, UserIcon } from "./icons";
import { librarySubtitle, pressable, readStored, useLibraryActions, useLibraryPages, usePersisted, writeStored } from "./libraryItems";
import { Eq } from "./Eq";

type Filter = Exclude<LibraryFilter, null>;

/** The kinds of the tree, each with its icon on a square of its color at 16%. */
const CATEGORIES: { filter: Filter; label: () => string; icon: React.ReactNode; tint: string; count: keyof LibraryCounts }[] = [
  { filter: "Playlists", label: () => t("Playlists"), icon: <PlaylistIcon size={16} />, tint: "#ffd84d", count: "playlists" },
  { filter: "Albums", label: () => t("Albums"), icon: <DiscIcon size={16} />, tint: "#ff8a3d", count: "albums" },
  { filter: "Artists", label: () => t("Artists"), icon: <UserIcon size={16} />, tint: "#29d39a", count: "artists" },
  { filter: "Podcasts & Shows", label: () => t("Podcasts"), icon: <PodcastIcon size={16} />, tint: "#a78bfa", count: "podcasts" },
];

const LIKED_TINT = "#a78bfa";
/** The Liked Songs row's card; its title is filled in when drawn (see `Tree`). */
const LIKED: Card = { uri: "spotify:collection:tracks", kind: "liked", title: "", subtitle: "", image: null };

/** How many items a category shows in the tree before "See all". */
const TREE_SHOWN = 4;
const OPEN_KEY = "libraryOpen";

/** The categories (and folders) opened in the tree, kept for the next start. */
function useOpened(): [Set<string>, (id: string, open?: boolean) => void] {
  const [opened, setOpened] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(readStored(OPEN_KEY) ?? "null");
      if (Array.isArray(saved)) return new Set(saved.filter((x): x is string => typeof x === "string"));
    } catch {
      // A broken value starts over.
    }
    return new Set(["Playlists"]);
  });
  const toggle = (id: string, open?: boolean) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      writeStored(OPEN_KEY, JSON.stringify([...next]));
      return next;
    });
  return [opened, toggle];
}

/** How many of each kind, read again when the library changes. */
function useCounts() {
  const [version, setVersion] = useState(0);
  useEffect(() => onLibraryChanged(() => setVersion((v) => v + 1)), []);
  return useAsync(() => libraryCounts(), `library-counts:${version}`).data;
}

/**
 * Your Library as a tree: the pinned items as big covers, then Liked Songs and one row per kind
 * with its count. A kind opens in place with its first items (folders open inside Playlists),
 * and its row opens the whole page. Narrow, it collapses to the pinned covers and the kinds.
 */
export function Sidebar({ collapsed = false, onExpand }: { collapsed?: boolean; onExpand?: () => void }) {
  const nav = useNav();
  const playingContext = usePlayerSelect((p) => p.contextUri);
  const isPlaying = usePlayerSelect((p) => p.playing);
  const actions = useLibraryActions();
  const counts = useCounts();
  // Pinned items come first in Your Library, whatever the kind.
  const root = useLibraryPages({ filter: null, sort: "Recents" });
  const pinned = root.items.filter((c) => c.pinned).slice(0, 4);
  const [opened, toggle] = useOpened();
  const [pinsOpen, setPinsOpen] = usePersisted<"1" | "0">("libraryPinsOpen", "1", ["1", "0"]);
  const [searching, setSearching] = useState(false);
  const [text, setText] = useState("");

  const route = nav.route;
  const openFilter = route.page === "library" && !route.folder ? route.filter : null;
  const openUri =
    route.page === "collection" || route.page === "artist" || route.page === "show"
      ? route.uri
      : route.page === "library"
        ? (route.folder ?? null)
        : null;
  const openKind = (filter: Filter) => nav.go({ page: "library", filter });

  if (collapsed) {
    // Narrow: the pinned covers and one icon per kind; a kind opens its whole page.
    return (
      <aside className="sidebar sidebar-collapsed panel">
        <button className="side-icon" aria-label={t("Expand Your Library")} title={t("Expand Your Library (Ctrl B)")} onClick={onExpand}>
          <LibraryIcon size={22} />
        </button>
        <div className="side-sep" />
        <div className="side-pins">
          {pinned.map((c) => (
            <button
              key={c.uri}
              className={`side-pin ${playingContext === c.uri ? "playing" : ""} ${openUri === c.uri ? "open" : ""}`}
              title={c.title}
              aria-label={c.title}
              onClick={() => nav.open(c.uri, c.title)}
              onContextMenu={(e) => actions.onMenu(e, c)}
            >
              <Cover src={c.image} kind={c.kind} />
            </button>
          ))}
        </div>
        <div className="side-sep" />
        <button
          className={`side-kind ${openUri === LIKED.uri ? "open" : ""}`}
          style={{ "--kind": LIKED_TINT } as React.CSSProperties}
          title={t("Liked Songs")}
          aria-label={t("Liked Songs")}
          onClick={() => nav.open(LIKED.uri)}
        >
          <HeartIcon size={16} />
        </button>
        {CATEGORIES.map((k) => (
          <button
            key={k.filter}
            className={`side-kind ${openFilter === k.filter ? "open" : ""}`}
            style={{ "--kind": k.tint } as React.CSSProperties}
            title={k.label()}
            aria-label={k.label()}
            onClick={() => openKind(k.filter)}
          >
            {k.icon}
          </button>
        ))}
        <button className="side-new" aria-label={t("Create playlist")} title={t("Create playlist (Ctrl N)")} onClick={() => newPlaylist()}>
          <PlusIcon size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar panel">
      <div className="sidebar-head">
        <button className="sidebar-title" title={t("Open Your Library")} onClick={() => openKind(openFilter ?? "Playlists")}>
          <LibraryIcon size={22} />
          <span>{t("Your Library")}</span>
        </button>
        <button
          className={`round-btn small ${searching ? "on" : ""}`}
          aria-label={t("Search in Your Library")}
          title={t("Search in Your Library")}
          onClick={() => {
            setSearching(!searching);
            setText("");
          }}
        >
          <SearchIcon size={16} />
        </button>
        <button className="round-btn small" aria-label={t("Create playlist")} title={t("Create playlist (Ctrl N)")} onClick={() => newPlaylist()}>
          <PlusIcon size={16} />
        </button>
      </div>
      {searching ? (
        <LibrarySearch
          text={text}
          setText={setText}
          onClose={() => {
            setSearching(false);
            setText("");
          }}
          openUri={openUri}
          actions={actions}
        />
      ) : (
        <div className="side-scroll">
          {pinned.length > 0 && (
            <section className="side-pinned">
              <button className="side-label" aria-expanded={pinsOpen === "1"} onClick={() => setPinsOpen(pinsOpen === "1" ? "0" : "1")}>
                <PinIcon size={12} />
                <span>{t("Pinned")}</span>
                <ChevronDownIcon size={14} className={pinsOpen === "1" ? "" : "turned"} />
              </button>
              {pinsOpen === "1" && (
                <div className="side-pin-grid">
                  {pinned.map((c) => {
                    const playing = playingContext === c.uri;
                    return (
                      <button
                        key={c.uri}
                        className={`side-pin-big ${playing ? "playing" : ""} ${actions.dropOn === c.uri ? "drop-target" : actions.candidate(c) ? "drop-candidate" : ""}`}
                        draggable={DRAGGABLE.has(c.kind)}
                        onDragStart={(e) => dragCard(e, c)}
                        {...peekProps(c)}
                        title={c.title}
                        aria-label={c.title}
                        onClick={() => nav.open(c.uri, c.title)}
                        onContextMenu={(e) => actions.onMenu(e, c)}
                        {...actions.dropProps(c)}
                      >
                        <Cover src={c.image} kind={c.kind} />
                        {playing && (
                          <span className="side-pin-eq">
                            <Eq paused={!isPlaying} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          <Tree
            counts={counts}
            opened={opened}
            toggle={toggle}
            openFilter={openFilter}
            openUri={openUri}
            openKind={openKind}
            actions={actions}
          />
        </div>
      )}
      <button className="side-new-wide" onClick={() => newPlaylist()}>
        <PlusIcon size={14} />
        {t("New playlist")}
      </button>
    </aside>
  );
}

type Actions = ReturnType<typeof useLibraryActions>;

/** Liked Songs and the kinds, with a white bar that slides to the one open in the main panel. */
function Tree({
  counts,
  opened,
  toggle,
  openFilter,
  openUri,
  openKind,
  actions,
}: {
  counts: LibraryCounts | undefined;
  opened: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  openFilter: Filter | null;
  openUri: string | null;
  openKind: (f: Filter) => void;
  actions: Actions;
}) {
  const nav = useNav();
  const liked: Card = { ...LIKED, title: t("Liked Songs") };
  const tree = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ y: number; h: number } | null>(null);
  const likedOpen = openUri === LIKED.uri;
  const openCategory = (f: Filter) => {
    openKind(f);
    toggle(f, true);
  };

  // The bar follows the open row, and moves when a category above it opens or closes.
  useLayoutEffect(() => {
    const measure = () => {
      const row = tree.current?.querySelector<HTMLElement>(".side-cat.open");
      setBar(row ? { y: row.offsetTop, h: row.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (tree.current) ro.observe(tree.current);
    return () => ro.disconnect();
  }, [openFilter, likedOpen]);

  return (
    <div ref={tree} className="side-tree">
      {bar && <span className="side-indicator" style={{ transform: `translateY(${bar.y}px)`, height: bar.h }} />}
      <div
        className={`side-cat ${likedOpen ? "open" : ""} ${actions.dropOn === LIKED.uri ? "drop-target" : actions.candidate(liked) ? "drop-candidate" : ""}`}
        draggable
        onDragStart={(e) => dragCard(e, liked)}
        style={{ "--kind": LIKED_TINT } as React.CSSProperties}
        onClick={() => nav.open(LIKED.uri)}
        {...pressable(() => nav.open(LIKED.uri))}
        onContextMenu={(e) => actions.onMenu(e, liked)}
        {...actions.dropProps(liked)}
      >
        <span className="side-cat-icon">
          <HeartIcon size={14} />
        </span>
        <span className="side-cat-name">{t("Liked Songs")}</span>
        <span className="side-cat-count">{counts ? counts.liked.toLocaleString(locale()) : ""}</span>
        <span className="side-cat-toggle" />
      </div>
      {CATEGORIES.map((k) => {
        const isOpen = opened.has(k.filter);
        const total = counts?.[k.count];
        return (
          <div key={k.filter} className="side-cat-group">
            <div
              className={`side-cat ${openFilter === k.filter ? "open" : ""} ${isOpen ? "expanded" : ""}`}
              style={{ "--kind": k.tint } as React.CSSProperties}
              onClick={() => openCategory(k.filter)}
              {...pressable(() => openCategory(k.filter))}
            >
              <span className="side-cat-icon">{k.icon}</span>
              <span className="side-cat-name">{k.label()}</span>
              <span className="side-cat-count">{total != null ? total.toLocaleString(locale()) : ""}</span>
              <button
                className="side-cat-toggle"
                aria-label={isOpen ? t("Close {name}", { name: k.label() }) : t("Open {name}", { name: k.label() })}
                aria-expanded={isOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(k.filter);
                }}
              >
                <ChevronRightIcon size={14} />
              </button>
            </div>
            {isOpen && (
              <Branch
                filter={k.filter}
                folder={null}
                total={total}
                opened={opened}
                toggle={toggle}
                openUri={openUri}
                onSeeAll={() => openKind(k.filter)}
                actions={actions}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The first items of a kind (or of a folder) under its row, on a guide line. */
function Branch({
  filter,
  folder,
  total,
  opened,
  toggle,
  openUri,
  onSeeAll,
  actions,
}: {
  filter: Filter;
  folder: Card | null;
  total: number | undefined;
  opened: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  openUri: string | null;
  onSeeAll: () => void;
  actions: Actions;
}) {
  const nav = useNav();
  const playingContext = usePlayerSelect((p) => p.contextUri);
  const isPlaying = usePlayerSelect((p) => p.playing);
  const [savedSort] = usePersisted<LibrarySort>("librarySort", "Recents", ["Recents", "Recently Added", "Alphabetical", "Creator"]);
  // Spotify answers nothing for artists sorted by creator.
  const sort = filter === "Artists" && savedSort === "Creator" ? "Recents" : savedSort;
  const pages = useLibraryPages({ filter, sort, folder: folder?.uri ?? null });
  // Liked Songs has its own row.
  const items = pages.items.filter((c) => c.kind !== "liked");
  const shown = items.slice(0, TREE_SHOWN);
  const all = total ?? (folder ? pages.total : undefined);

  return (
    <div className="side-branch">
      {!pages.loaded && !pages.error && <div className="side-leaf side-leaf-loading" />}
      {pages.loaded && items.length === 0 && <div className="side-leaf-note">{folder ? t("This folder is empty") : t("Nothing here yet")}</div>}
      {shown.map((c, i) => {
        const playing = playingContext === c.uri;
        const isFolder = c.kind === "folder";
        const folderOpen = isFolder && opened.has(c.uri);
        return (
          <div key={c.uri} className="side-leaf-group" style={{ "--i": i } as React.CSSProperties}>
            <div
              className={`side-leaf ${openUri === c.uri ? "open" : ""} ${playing ? "playing" : ""} ${actions.dropOn === c.uri ? "drop-target" : actions.candidate(c) ? "drop-candidate" : ""}`}
              draggable={DRAGGABLE.has(c.kind)}
              onDragStart={(e) => dragCard(e, c)}
              title={c.title}
              onClick={() => (isFolder ? toggle(c.uri) : nav.open(c.uri, c.title))}
              {...pressable(() => (isFolder ? toggle(c.uri) : nav.open(c.uri, c.title)))}
              {...peekProps(c, () => (isFolder ? toggle(c.uri) : nav.open(c.uri, c.title)))}
              aria-expanded={isFolder ? folderOpen : undefined}
              onContextMenu={(e) => actions.onMenu(e, c)}
              {...actions.dropProps(c)}
            >
              <Cover src={c.image} kind={c.kind} className="side-leaf-cover" />
              <span className="side-leaf-name">{c.title}</span>
              {playing ? (
                <Eq paused={!isPlaying} />
              ) : isFolder ? (
                <span className="side-leaf-count">
                  {/^\d+/.exec(c.subtitle)?.[0] ?? ""}
                  <ChevronRightIcon size={12} className={folderOpen ? "turned-down" : ""} />
                </span>
              ) : null}
            </div>
            {folderOpen && (
              <Branch
                filter="Playlists"
                folder={c}
                total={undefined}
                opened={opened}
                toggle={toggle}
                openUri={openUri}
                onSeeAll={() => nav.open(c.uri, c.title)}
                actions={actions}
              />
            )}
          </div>
        );
      })}
      {all != null && all > shown.length && (
        <button className="side-see-all" onClick={onSeeAll}>
          {t("See all {n}", { n: all.toLocaleString(locale()) })}
        </button>
      )}
    </div>
  );
}

/** Searching Your Library from the sidebar: every kind, a flat list. */
function LibrarySearch({
  text,
  setText,
  onClose,
  openUri,
  actions,
}: {
  text: string;
  setText: (t: string) => void;
  onClose: () => void;
  openUri: string | null;
  actions: Actions;
}) {
  const nav = useNav();
  const playingContext = usePlayerSelect((p) => p.contextUri);
  const term = text.trim();
  const pages = useLibraryPages({ filter: null, sort: "Recents", text: term });
  return (
    <>
      <label className="list-search side-search">
        <SearchIcon size={14} />
        <input
          autoFocus
          value={text}
          placeholder={t("Search in Your Library")}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
      </label>
      <div className="library-list list">
        {pages.error && <div className="muted small pad">{pages.error}</div>}
        {pages.loaded && pages.items.length === 0 && term && <div className="muted small pad">{t("Nothing in Your Library matches “{term}”.", { term })}</div>}
        {pages.items.map((c) => (
          <div
            key={c.uri}
            className={`library-item ${openUri === c.uri ? "open" : ""} ${actions.dropOn === c.uri ? "drop-target" : actions.candidate(c) ? "drop-candidate" : ""}`}
            draggable={DRAGGABLE.has(c.kind)}
            onDragStart={(e) => dragCard(e, c)}
            onClick={() => nav.open(c.uri, c.title)}
            {...pressable(() => nav.open(c.uri, c.title))}
            onContextMenu={(e) => actions.onMenu(e, c)}
            {...actions.dropProps(c)}
            title={c.title}
          >
            <Cover src={c.image} kind={c.kind} className="library-cover" />
            <div className="library-text">
              <div className={`library-title ${playingContext === c.uri ? "accent" : ""}`}>{c.title}</div>
              <div className="library-sub">{librarySubtitle(c)}</div>
            </div>
          </div>
        ))}
        <div ref={pages.sentinel} style={{ height: 1 }} />
      </div>
    </>
  );
}
