import { useEffect, useRef, useState } from "react";
import { getHome, library, play, showEpisodes } from "../api/spotify";
import type { Card as CardData, Episode, Section } from "../api/types";
import { Card, ShelfRow } from "../components/Card";
import { Cover } from "../components/Cover";
import { CloseIcon, EditIcon, PinIcon, PlusIcon } from "../components/icons";
import { PlayButton } from "../components/PlayButton";
import { Toggle } from "../components/Toggle";
import {
  arrange,
  LIBRARY_ROWS,
  libraryRowId,
  resetHomeLayout,
  setHomeLayout,
  useHomeLayout,
  type HomeLayout,
} from "../state/homeLayout";
import { useNav } from "../state/nav";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** A row of Home: one of Spotify's sections, Continue, or a row of the user's library. */
type Row =
  | { id: string; title: string; type: "spotify"; section: Section }
  | { id: string; title: string; type: "continue" }
  | { id: string; title: string; type: "library"; filter: (typeof LIBRARY_ROWS)[number]["filter"] };

const CONTINUE_ID = "continue";
/** Continue shows at most two rows of four. */
const CONTINUE_MAX = 8;

/**
 * Spotify's own home for this account, arranged the way the user left it: the shortcuts on
 * top, then Continue and Spotify's sections, which scroll sideways. "For now" and the
 * shortcuts as a row of their own come with the local listening history (phase 5); until
 * then the shortcuts stay a grid on top, as the spec's first weeks say.
 */
export function Home({ name }: { name: string }) {
  const nav = useNav();
  const layout = useHomeLayout();
  const { data, error, loading } = useAsync(getHome, "home");
  const continuing = useContinuing();
  const [editing, setEditing] = useState(false);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;

  // The untitled first section is the grid of shortcuts Spotify puts at the top.
  const [first, ...rest] = data.sections;
  const shortcuts = first && !first.title ? first.cards.slice(0, 8) : [];
  const sections = shortcuts.length ? rest : data.sections;

  const rows: Row[] = [
    ...(continuing.length ? [{ id: CONTINUE_ID, title: "Continue", type: "continue" as const }] : []),
    ...sections.map((s, i) => ({ id: s.uri ?? `${s.title}:${i}`, title: s.title, type: "spotify" as const, section: s })),
    ...layout.added.map((f) => ({
      id: libraryRowId(f),
      title: LIBRARY_ROWS.find((r) => r.filter === f)!.title,
      type: "library" as const,
      filter: f,
    })),
  ];
  const arranged = arrange(rows, layout);
  const firstName = name.split(" ")[0];

  return (
    <div className="page home">
      <div className="home-head">
        <h1 className="greeting">{firstName ? `${data.greeting}, ${firstName}` : data.greeting}</h1>
        <div className="home-customize">
          <button className={`pill-button ${editing ? "on" : ""}`} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <EditIcon size={14} />
            Customize home
          </button>
          {editing && <Customize rows={arranged} layout={layout} onClose={() => setEditing(false)} />}
        </div>
      </div>
      {shortcuts.length > 0 && (
        <div className="shortcuts">
          {shortcuts.map((c) => (
            <Shortcut key={c.uri} card={c} />
          ))}
        </div>
      )}
      {arranged
        .filter((r) => !layout.hidden.includes(r.id))
        .map((r) =>
          r.type === "continue" ? (
            <ContinueGrid key={r.id} episodes={continuing} />
          ) : r.type === "library" ? (
            <LibraryShelf key={r.id} title={r.title} filter={r.filter} />
          ) : (
            <ShelfRow
              key={r.id}
              title={r.title}
              onShowAll={
                r.section.more && r.section.uri
                  ? () => nav.go({ page: "cards", source: "home", uri: r.section.uri!, title: r.section.title })
                  : undefined
              }
            >
              {r.section.cards.map((c) => (
                <Card key={c.uri} card={c} />
              ))}
            </ShelfRow>
          ),
        )}
    </div>
  );
}

function Shortcut({ card }: { card: CardData }) {
  const nav = useNav();
  const player = usePlayer();
  const isCurrent = player.contextUri === card.uri;
  return (
    <div className="shortcut" onClick={() => nav.open(card.uri)} title={card.title}>
      <Cover src={card.image} kind={card.kind} className="shortcut-cover" />
      <span className={`shortcut-title ${isCurrent ? "accent" : ""}`}>{card.title}</span>
      <PlayButton
        size={36}
        className="shortcut-play"
        playing={isCurrent && player.playing}
        onClick={() => (isCurrent ? player.toggle() : play.context(card.uri).catch(toast))}
      />
    </div>
  );
}

/**
 * What was left halfway that the app already knows of: episodes of the podcasts in Your
 * Library, which carry where the user stopped. Albums and playlists join once the local
 * history keeps their positions (phase 5).
 */
function useContinuing(): Episode[] {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const shows = (await library({ filter: "Podcasts & Shows" })).items.filter((c) => c.kind === "show");
      const pages = await Promise.all(shows.map((s) => showEpisodes(s.uri).catch(() => null)));
      const halfway = pages
        .flatMap((p) => p?.episodes ?? [])
        .filter((e) => e.playedMs > 0 && !e.finished)
        .sort((a, b) => (b.released ?? "").localeCompare(a.released ?? ""))
        .slice(0, CONTINUE_MAX);
      if (live) setEpisodes(halfway);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return episodes;
}

function ContinueGrid({ episodes }: { episodes: Episode[] }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>Continue</h2>
      </div>
      <div className="continue-grid">
        {episodes.map((e) => (
          <ContinueTile key={e.uri} episode={e} />
        ))}
      </div>
    </section>
  );
}

function ContinueTile({ episode: e }: { episode: Episode }) {
  const nav = useNav();
  const player = usePlayer();
  const isCurrent = player.track?.uri === e.uri;
  const left = Math.max(1, Math.round((e.durationMs - e.playedMs) / 60000));
  const playThis = () =>
    isCurrent ? player.toggle() : (e.show.uri ? play.context(e.show.uri, e.uri) : play.tracks([e.uri], 0)).catch(toast);
  return (
    <div className="continue-tile" onClick={() => nav.open(e.uri)} title={e.name}>
      <Cover src={e.image} kind="show" className="continue-cover" />
      <div className="continue-text">
        <div className={`continue-title ${isCurrent ? "accent" : ""}`}>{e.name}</div>
        <div className="continue-sub">
          {e.show.name ? `${e.show.name} • ` : ""}
          {left} min left
        </div>
      </div>
      <PlayButton size={32} className="continue-play" playing={isCurrent && player.playing} onClick={playThis} />
      <div className="continue-progress" style={{ width: `${Math.min(100, (100 * e.playedMs) / Math.max(1, e.durationMs))}%` }} />
    </div>
  );
}

/** A row of the user's own library: their playlists, albums, artists or podcasts. */
function LibraryShelf({ title, filter }: { title: string; filter: (typeof LIBRARY_ROWS)[number]["filter"] }) {
  const { data } = useAsync(() => library({ filter }), `homeLibrary:${filter}`);
  const cards = data?.items ?? [];
  if (!cards.length) return null;
  return (
    <ShelfRow title={title}>
      {cards.map((c) => (
        <Card key={c.uri} card={c} />
      ))}
    </ShelfRow>
  );
}

/** "Customize home": pin, hide and reorder rows, add rows of the library, or restore. */
function Customize({ rows, layout, onClose }: { rows: Row[]; layout: HomeLayout; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const toggleIn = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));
  const ids = rows.map((r) => r.id);
  const drop = (target: string) => {
    if (!dragId || dragId === target) return;
    const next = ids.filter((id) => id !== dragId);
    next.splice(next.indexOf(target), 0, dragId);
    setHomeLayout({ ...layout, order: next });
  };
  const addable = LIBRARY_ROWS.filter((r) => !layout.added.includes(r.filter));

  return (
    <div className="customize" ref={box} role="dialog" aria-label="Customize home">
      <div className="customize-head">
        <span>Customize home</span>
        <button className="link" onClick={resetHomeLayout}>
          Restore
        </button>
      </div>
      <div className="customize-list">
        {rows.map((r) => {
          const shown = !layout.hidden.includes(r.id);
          const pinned = layout.pinned.includes(r.id);
          return (
            <div
              key={r.id}
              className={`customize-row ${shown ? "" : "off"} ${dragId === r.id ? "dragged" : ""} ${overId === r.id && dragId !== r.id ? "over" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragId(r.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(r.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(r.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="customize-grip" aria-hidden>
                ⠿
              </span>
              <span className="customize-title">{r.title}</span>
              <button
                className={`customize-pin ${pinned ? "on" : ""}`}
                aria-label={pinned ? "Unpin row" : "Pin row to the top"}
                title={pinned ? "Unpin" : "Pin to the top"}
                onClick={() => setHomeLayout({ ...layout, pinned: toggleIn(layout.pinned, r.id, !pinned) })}
              >
                <PinIcon size={13} />
              </button>
              {r.type === "library" && (
                <button
                  className="customize-pin"
                  aria-label="Remove row"
                  title="Remove"
                  onClick={() =>
                    setHomeLayout({
                      ...layout,
                      added: layout.added.filter((f) => f !== r.filter),
                      pinned: layout.pinned.filter((x) => x !== r.id),
                      hidden: layout.hidden.filter((x) => x !== r.id),
                    })
                  }
                >
                  <CloseIcon size={13} />
                </button>
              )}
              <Toggle on={shown} onChange={(on) => setHomeLayout({ ...layout, hidden: toggleIn(layout.hidden, r.id, !on) })} />
            </div>
          );
        })}
      </div>
      {addable.length > 0 && (
        <div className="customize-add">
          {adding ? (
            addable.map((r) => (
              <button
                key={r.filter}
                className="customize-add-item"
                onClick={() => {
                  setHomeLayout({ ...layout, added: [...layout.added, r.filter] });
                  setAdding(false);
                }}
              >
                {r.title}
              </button>
            ))
          ) : (
            <button className="customize-add-item" onClick={() => setAdding(true)}>
              <PlusIcon size={14} />
              Add a row from your library
            </button>
          )}
        </div>
      )}
    </div>
  );
}
