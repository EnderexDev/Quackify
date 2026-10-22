// Your Library, whole page: one kind (or the playlists inside a folder) as a list, a compact
// list or a grid, sorted, grouped and searched.
import { useState } from "react";
import { libraryCounts, type LibraryCounts } from "../api/spotify";
import type { Card as CardData, LibraryFilter, LibrarySort } from "../api/types";
import { Card } from "../components/Card";
import { Cover } from "../components/Cover";
import { CompactIcon, GridIcon, GroupIcon, ListIcon, PinIcon, PlusIcon, SearchIcon, SortIcon } from "../components/icons";
import { pressable, useLibraryActions, useLibraryPages, usePersisted } from "../components/libraryItems";
import { Segmented } from "../components/Segmented";
import { locale, t } from "../i18n";
import { newPlaylist } from "../state/newPlaylist";
import { DRAGGABLE, dragCard } from "../state/drag";
import { peekProps } from "../state/peek";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { formatAgo } from "../util/format";
import { kindLabel } from "../util/kinds";
import { useAsync } from "../util/useAsync";
import { Empty, Failed, Loading } from "./common";

type Filter = Exclude<LibraryFilter, null>;

const num = (n: number) => n.toLocaleString(locale());

/** Each kind's slot in the counts, and its words (functions: read when drawn, in the language shown). */
const KINDS: Record<
  Filter,
  { title: () => string; count: (n: number) => string; none: () => string; empty: () => string; slot: keyof LibraryCounts }
> = {
  Playlists: {
    title: () => t("Playlists"),
    count: (n) => (n === 1 ? t("1 playlist") : t("{n} playlists", { n: num(n) })),
    none: () => t("No playlists yet"),
    empty: () => t("Your playlists show up here."),
    slot: "playlists",
  },
  Albums: {
    title: () => t("Albums"),
    count: (n) => (n === 1 ? t("1 album") : t("{n} albums", { n: num(n) })),
    none: () => t("No albums yet"),
    empty: () => t("Your albums show up here."),
    slot: "albums",
  },
  Artists: {
    title: () => t("Artists"),
    count: (n) => (n === 1 ? t("1 artist") : t("{n} artists", { n: num(n) })),
    none: () => t("No artists yet"),
    empty: () => t("Your artists show up here."),
    slot: "artists",
  },
  "Podcasts & Shows": {
    title: () => t("Podcasts"),
    count: (n) => (n === 1 ? t("1 podcast") : t("{n} podcasts", { n: num(n) })),
    none: () => t("No podcasts yet"),
    empty: () => t("Your podcasts show up here."),
    slot: "podcasts",
  },
};

const SORTS: { id: LibrarySort; label: () => string }[] = [
  { id: "Recents", label: () => t("Recents") },
  { id: "Recently Added", label: () => t("Recently added") },
  { id: "Alphabetical", label: () => t("Alphabetical") },
  { id: "Creator", label: () => t("Creator") },
];

type View = "list" | "compact" | "grid";
const VIEWS: { id: View; label: React.ReactNode; title: () => string }[] = [
  { id: "list", label: <ListIcon size={16} />, title: () => t("List") },
  { id: "compact", label: <CompactIcon size={16} />, title: () => t("Compact") },
  { id: "grid", label: <GridIcon size={16} />, title: () => t("Grid") },
];

/** Grouping: by who made it (a playlist's owner, an album's artists, a podcast's publisher);
 * artists have no maker, so they group by their first letter. */
type Group = "none" | "creator";

export function LibraryView({ filter, folder, title }: { filter: Filter; folder?: string; title?: string }) {
  const nav = useNav();
  const kind = KINDS[filter];
  const [view, setView] = usePersisted<View>("libraryPageView", "grid", VIEWS.map((v) => v.id));
  const [savedSort, setSort] = usePersisted<LibrarySort>("librarySort", "Recents", SORTS.map((s) => s.id));
  const sort = filter === "Artists" && savedSort === "Creator" ? "Recents" : savedSort;
  const [group, setGroup] = usePersisted<Group>("libraryGroup", "none", ["none", "creator"]);
  const [text, setText] = useState("");
  const query = { filter, sort, text: text.trim(), folder: folder ?? null };
  const pages = useLibraryPages(query, group !== "none");
  const counts = useAsync(() => libraryCounts(), "library-counts");
  const actions = useLibraryActions();

  if (pages.error && !pages.items.length) return <Failed error={pages.error} onRetry={pages.reload} retried={0} />;

  const c = counts.data;
  const countLine = folder
    ? pages.loaded
      ? pages.total === 1
        ? t("1 item")
        : t("{n} items", { n: num(pages.total) })
      : ""
    : c
      ? [
          kind.count(c[kind.slot]),
          filter === "Playlists" && c.folders ? (c.folders === 1 ? t("1 folder") : t("{n} folders", { n: num(c.folders) })) : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const heading = folder ? (title ?? t("Folder")) : kind.title();
  const searchLabel = t("Search in {name}", { name: heading });
  const groups = group === "none" ? [{ name: "", items: pages.items }] : groupItems(pages.items, filter);

  return (
    <div className="page library-page">
      {folder && <p className="page-eyebrow">{t("Folder")}</p>}
      <div className="library-page-head">
        <h1 className="page-title">{heading}</h1>
        {countLine && <span className="library-count">{countLine}</span>}
      </div>
      <div className="library-page-tools">
        <Segmented className="library-views" label={t("View as")} options={VIEWS.map((v) => ({ ...v, title: v.title() }))} value={view} onChange={setView} />
        <label className="list-sort-pill">
          <SortIcon size={14} />
          <select className="list-sort" value={sort} aria-label={t("Sort by")} onChange={(e) => setSort(e.currentTarget.value as LibrarySort)}>
            {/* Spotify answers nothing for artists sorted by creator. */}
            {SORTS.filter((s) => filter !== "Artists" || s.id !== "Creator").map((s) => (
              <option key={s.id} value={s.id}>
                {s.label()}
              </option>
            ))}
          </select>
        </label>
        <label className="list-sort-pill">
          <GroupIcon size={14} />
          <select className="list-sort" value={group} aria-label={t("Group by")} onChange={(e) => setGroup(e.currentTarget.value as Group)}>
            <option value="none">{t("Group: none")}</option>
            <option value="creator">{filter === "Artists" ? t("Group: letter") : t("Group: creator")}</option>
          </select>
        </label>
        <label className="list-search">
          <SearchIcon size={14} />
          <input
            value={text}
            placeholder={searchLabel}
            aria-label={searchLabel}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setText("");
              e.currentTarget.blur();
            }}
          />
        </label>
        {filter === "Playlists" && (
          <button className="pill-btn white library-new" onClick={() => newPlaylist()}>
            <PlusIcon size={14} />
            {t("New playlist")}
          </button>
        )}
      </div>
      {!pages.loaded && <Loading />}
      {pages.loaded && pages.items.length === 0 && (
        text.trim() ? (
          <Empty title={t("Nothing matches “{term}”", { term: text.trim() })} text={t("Nothing in {name} has that in its name.", { name: heading })} />
        ) : folder ? (
          <Empty title={t("This folder is empty")} text={t("Move playlists into it in Spotify, or make a new playlist.")}>
            <button className="pill-btn white" onClick={() => newPlaylist()}>
              <PlusIcon size={14} />
              {t("New playlist")}
            </button>
            <button className="pill-btn" onClick={() => nav.go({ page: "library", filter: "Playlists" })}>
              {t("See playlists")}
            </button>
          </Empty>
        ) : (
          <Empty title={kind.none()} text={kind.empty()} />
        )
      )}
      {pages.items.length > 0 &&
        groups.map((g) => (
          <section key={g.name} className="library-group">
            {g.name && (
              <h2 className="library-group-name">
                {g.name} <span className="muted">{g.items.length}</span>
              </h2>
            )}
            <Items view={view} items={g.items} actions={actions} />
          </section>
        ))}
      {pages.error && pages.items.length > 0 && (
        <div className="library-empty">
          <p className="muted">{t("Could not load the rest: {error}", { error: pages.error })}</p>
          <button className="pill-btn" onClick={pages.loadMore}>
            {t("Try again")}
          </button>
        </div>
      )}
      {!pages.error && pages.loaded && !pages.complete && group === "none" && (
        <div ref={pages.sentinel} className="more">
          <div className="spinner small" />
        </div>
      )}
      {!pages.error && group !== "none" && pages.loaded && !pages.complete && (
        <div className="more">
          <div className="spinner small" />
        </div>
      )}
    </div>
  );
}

/** Groups in the order their first item comes in the chosen sort. Folders go together, and
 * an item with no maker joins "Other". */
function groupItems(items: CardData[], filter: Filter) {
  const groups = new Map<string, CardData[]>();
  for (const c of items) {
    const name =
      filter === "Artists"
        ? /^[a-z]/i.test(c.title)
          ? c.title[0].toUpperCase()
          : "#"
        : c.kind === "folder"
          ? t("Folders")
          : c.kind === "liked"
            ? t("You")
            : c.creator || t("Other");
    const list = groups.get(name);
    if (list) list.push(c);
    else groups.set(name, [c]);
  }
  const list = [...groups].map(([name, items]) => ({ name, items }));
  return filter === "Artists" ? list.sort((a, b) => (a.name === "#" ? 1 : b.name === "#" ? -1 : a.name.localeCompare(b.name))) : list;
}

function Items({ view, items, actions }: { view: View; items: CardData[]; actions: ReturnType<typeof useLibraryActions> }) {
  const nav = useNav();
  const player = usePlayer();
  if (view === "grid") {
    return (
      <div className="card-grid">
        {items.map((c) => (
          // display: contents, so the card stays the grid's cell while this takes the drop.
          <div key={c.uri} className={`library-cell ${actions.dropOn === c.uri ? "drop-target" : ""}`} {...actions.dropProps(c)}>
            <Card card={{ ...c, subtitle: cardSubtitle(c) }} onMenu={(e) => actions.onMenu(e, c)} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={`library-rows ${view}`}>
      <div className="library-row library-row-head">
        <span>{t("Title")}</span>
        {view === "compact" && <span>{t("Type")}</span>}
        {view === "compact" && <span>{t("Creator")}</span>}
        <span>{t("Date added")}</span>
        <span>{t("Played")}</span>
      </div>
      {items.map((c) => {
        const playing = player.contextUri === c.uri;
        return (
          <div
            key={c.uri}
            className={`library-row ${actions.dropOn === c.uri ? "drop-target" : actions.candidate(c) ? "drop-candidate" : ""}`}
            title={c.title}
            onClick={() => nav.open(c.uri, c.title)}
            {...pressable(() => nav.open(c.uri, c.title))}
            {...peekProps(c, () => nav.open(c.uri, c.title))}
            draggable={DRAGGABLE.has(c.kind)}
            onDragStart={(e) => dragCard(e, c)}
            onContextMenu={(e) => actions.onMenu(e, c)}
            {...actions.dropProps(c)}
          >
            <span className="library-row-main">
              <Cover src={c.image} kind={c.kind} className="library-row-cover" />
              <span className="library-row-text">
                <span className={`library-row-title ${playing ? "accent" : ""}`}>
                  {c.pinned && (
                    <span className="pin" title={t("Pinned")}>
                      <PinIcon size={12} />
                    </span>
                  )}
                  {c.title}
                </span>
                {view === "list" && <span className="library-row-sub">{rowSubtitle(c)}</span>}
              </span>
            </span>
            {view === "compact" && <span className="library-row-cell">{kindLabel(c)}</span>}
            {view === "compact" && <span className="library-row-cell">{c.kind === "liked" ? t("You") : (c.creator ?? "")}</span>}
            <span className="library-row-cell">{c.addedAt ? formatAgo(c.addedAt) : ""}</span>
            <span className="library-row-cell">{c.playedAt ? formatAgo(c.playedAt) : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Under a card: who made a playlist (Spotify sends a description there elsewhere). */
function cardSubtitle(c: CardData): string {
  return c.kind === "playlist" && c.creator ? t("By {name}", { name: c.creator }) : c.subtitle;
}

/** The type and the maker under a name in the list view. */
function rowSubtitle(c: CardData): string {
  if (c.kind === "folder") return `${t("Folder")} · ${c.subtitle}`;
  if (c.kind === "liked") return `${t("Playlist")} · ${c.subtitle}`;
  if (c.kind === "artist") return t("Artist");
  return [kindLabel(c), c.creator].filter(Boolean).join(" · ");
}
