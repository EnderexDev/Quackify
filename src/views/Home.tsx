import { useEffect, useMemo, useRef, useState } from "react";
import { kindOf } from "../api/normalize";
import { artist, collection, getHome, library, play, show, showEpisodes } from "../api/spotify";
import type { Card as CardData, Episode, Section } from "../api/types";
import { Card, ShelfRow } from "../components/Card";
import { Cover } from "../components/Cover";
import { ClockIcon, CloseIcon, EditIcon, PinIcon, PlusIcon } from "../components/icons";
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
import {
  dayPart,
  finished,
  FOR_NOW_MIN,
  forNow,
  historyReady,
  leftHalfway,
  useListening,
  type Log,
  type Spot,
} from "../state/listening";
import { usePlayer } from "../state/player";
import { toast } from "../state/toast";
import { kindLabel } from "../util/kinds";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** A row of Home: For now, Continue, the shortcuts, one of Spotify's sections, or a row of the
 * user's library. */
type Row =
  | { id: string; title: string; type: "forNow" }
  | { id: string; title: string; type: "shortcuts" }
  | { id: string; title: string; type: "spotify"; section: Section }
  | { id: string; title: string; type: "continue" }
  | { id: string; title: string; type: "library"; filter: (typeof LIBRARY_ROWS)[number]["filter"] };

const FOR_NOW_ID = "forNow";
const SHORTCUTS_ID = "shortcuts";
const CONTINUE_ID = "continue";
/** Continue shows at most two rows of four. */
const CONTINUE_MAX = 8;
/** The podcasts read for Continue: the most recent ones in Your Library. */
const CONTINUE_SHOWS = 12;

/**
 * Spotify's own home for this account, arranged the way the user left it: For now, Continue,
 * the shortcuts and Spotify's sections, which scroll sideways. In the first weeks, while the
 * local history (state/listening.ts) has no habit for this hour, For now stays out and the
 * shortcuts are a grid on top; once it has one, they move down to a row of their own.
 */
export function Home({ name }: { name: string }) {
  const nav = useNav();
  const layout = useHomeLayout();
  const { data, error, loading } = useAsync(getHome, "home");
  const log = useListening();
  const slot = useHour();
  // Read once an hour, not on each song: the panel does not reshuffle under the mouse.
  const forNowUris = useMemo(() => (historyReady(log, slot) ? forNow(log, slot) : []), [slot]); // eslint-disable-line react-hooks/exhaustive-deps
  const forNowCards = useContextCards(forNowUris);
  const continuing = useContinuing(!layout.hidden.includes(CONTINUE_ID), log);
  const [editing, setEditing] = useState(false);
  if (error) return <Failed error={error} />;
  if (loading || !data) return <Loading />;

  // The untitled first section is the grid of shortcuts Spotify puts at the top.
  const [first, ...rest] = data.sections;
  const shortcuts = first && !first.title ? first.cards.slice(0, 8) : [];
  const sections = shortcuts.length ? rest : data.sections;
  const hasForNow = forNowUris.length >= FOR_NOW_MIN;

  const rows: Row[] = [
    ...(hasForNow ? [{ id: FOR_NOW_ID, title: "For now", type: "forNow" as const }] : []),
    // A hidden Continue reads nothing, but stays listed so Customize can bring it back.
    ...(continuing.length || layout.hidden.includes(CONTINUE_ID) ? [{ id: CONTINUE_ID, title: "Continue", type: "continue" as const }] : []),
    ...(hasForNow && shortcuts.length ? [{ id: SHORTCUTS_ID, title: "Your shortcuts", type: "shortcuts" as const }] : []),
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
      {!hasForNow && shortcuts.length > 0 && (
        <div className="shortcuts">
          {shortcuts.map((c) => (
            <Shortcut key={c.uri} card={c} />
          ))}
        </div>
      )}
      {arranged
        .filter((r) => !layout.hidden.includes(r.id))
        .map((r) =>
          r.type === "forNow" ? (
            <ForNow key={r.id} at={slot} cards={forNowUris.map((u) => forNowCards.get(u)).filter((c): c is ContextCard => !!c)} />
          ) : r.type === "shortcuts" ? (
            <ShelfRow key={r.id} title={r.title} note="picked by Spotify" rowClass="tiles">
              {shortcuts.map((c) => (
                <Shortcut key={c.uri} card={c} />
              ))}
            </ShelfRow>
          ) : r.type === "continue" ? (
            <ContinueGrid key={r.id} items={continuing} />
          ) : r.type === "library" ? (
            <LibraryShelf key={r.id} title={r.title} filter={r.filter} />
          ) : (
            <ShelfRow
              key={r.id}
              title={r.title}
              onShowAll={
                r.section.more && r.section.uri
                  ? () => nav.go({ page: "cards", source: "home", uri: r.section.uri!, title: r.section.title, from: "Home" })
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

/** The start of the current hour, moving on when the clock does. */
function useHour(): number {
  const hour = () => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.getTime();
  };
  const [at, setAt] = useState(hour);
  useEffect(() => {
    const id = window.setInterval(() => setAt(hour()), 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  return at;
}

/** An album, playlist, artist or podcast the history names, as a card, with its length. */
type ContextCard = CardData & { total: number | null };

async function contextCard(uri: string): Promise<ContextCard> {
  const kind = kindOf(uri);
  if (kind === "artist") {
    const a = await artist(uri);
    return { uri, kind, title: a.name, subtitle: "Artist", image: a.image, total: null };
  }
  if (kind === "show") {
    const p = await show(uri);
    return { uri, kind, title: p.name, subtitle: p.publisher, image: p.image, total: null };
  }
  const c = await collection(uri);
  return {
    uri,
    kind: c.kind,
    albumType: c.albumType,
    title: c.title,
    subtitle: [kindLabel(c), c.owner].filter(Boolean).join(" • "),
    image: c.image,
    total: c.total,
  };
}

/** The cards of these contexts as they arrive; one that fails to load is left out. */
function useContextCards(uris: string[]): Map<string, ContextCard> {
  const [cards, setCards] = useState(() => new Map<string, ContextCard>());
  const key = uris.join(" ");
  useEffect(() => {
    let live = true;
    for (const uri of uris) {
      contextCard(uri)
        .then((c) => live && setCards((m) => new Map(m).set(uri, c)))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cards;
}

/** "For now": what the user usually plays at this hour on this kind of day. */
function ForNow({ at, cards }: { at: number; cards: ContextCard[] }) {
  const d = new Date(at);
  const when = `${d.toLocaleString("en-US", { weekday: "short" })} · ${d.toLocaleString("en-US", { hour: "numeric" })}`;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return (
    <ShelfRow
      className="for-now"
      title={
        <>
          <ClockIcon size={18} />
          For now
          <span className="for-now-when">{when}</span>
        </>
      }
      aside={<span className="for-now-why">{`You usually play these on ${weekend ? "weekend" : "weekday"} ${dayPart(d.getHours())}s`}</span>}
    >
      {cards.map((c) => (
        <Card key={c.uri} card={c} />
      ))}
    </ShelfRow>
  );
}

/** One thing left halfway: an episode (Spotify keeps its place) or an album or playlist (the
 * local history does). `at` is when it was left, for the order; 0 when not known. */
type Halfway = { at: number } & ({ type: "episode"; episode: Episode } | { type: "context"; card: ContextCard; spot: Spot });

/**
 * What was left halfway: episodes of the podcasts in Your Library, which carry where the user
 * stopped, and the albums, playlists and Liked Songs the local history left in the middle.
 * The latest first; an episode played here takes the time its podcast was left.
 */
function useContinuing(enabled: boolean, log: Log): Halfway[] {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const shows = (await library({ filter: "Podcasts & Shows" })).items.filter((c) => c.kind === "show").slice(0, CONTINUE_SHOWS);
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
  }, [enabled]);
  const spots = enabled ? leftHalfway(log, Date.now()).slice(0, CONTINUE_MAX) : [];
  const cards = useContextCards(spots.map(([c]) => c));
  if (!enabled) return [];
  const contexts: Halfway[] = spots.flatMap(([uri, spot]) => {
    const card = cards.get(uri);
    // Shown once its card is in, and not when it turns out to be at its very end.
    return card && !(card.total !== null && finished(spot, card.total)) ? [{ at: spot.at, type: "context" as const, card, spot }] : [];
  });
  const eps: Halfway[] = episodes.map((e) => {
    const spot = e.show.uri ? log.spots[e.show.uri] : undefined;
    return { at: spot?.track === e.uri ? spot.at : 0, type: "episode" as const, episode: e };
  });
  return [...contexts, ...eps].sort((a, b) => b.at - a.at).slice(0, CONTINUE_MAX);
}

function ContinueGrid({ items }: { items: Halfway[] }) {
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>Continue</h2>
      </div>
      <div className="continue-grid">
        {items.map((h) =>
          h.type === "episode" ? (
            <ContinueTile key={h.episode.uri} episode={h.episode} />
          ) : (
            <ContinueContext key={h.card.uri} card={h.card} spot={h.spot} />
          ),
        )}
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

/** An album or playlist left halfway: the song it was on, of how many, and how far along.
 * Play picks up at that song and place. */
function ContinueContext({ card, spot }: { card: ContextCard; spot: Spot }) {
  const nav = useNav();
  const player = usePlayer();
  const isCurrent = player.contextUri === card.uri;
  const row = (spot.index ?? 0) + 1;
  const total = Math.max(card.total ?? row, row);
  const done = Math.min(1, ((spot.index ?? 0) + (spot.dur ? spot.pos / spot.dur : 0)) / total);
  const playThis = () => (isCurrent ? player.toggle() : play.context(card.uri, spot.track, spot.pos).catch(toast));
  return (
    <div className="continue-tile" onClick={() => nav.open(card.uri, card.title)} title={card.title}>
      <Cover src={card.image} kind={card.kind} className="continue-cover" />
      <div className="continue-text">
        <div className={`continue-title ${isCurrent ? "accent" : ""}`}>{card.title}</div>
        <div className="continue-sub">{`Track ${row.toLocaleString()} of ${total.toLocaleString()}`}</div>
      </div>
      <PlayButton size={32} className="continue-play" playing={isCurrent && player.playing} onClick={playThis} />
      <div className="continue-progress" style={{ width: `${100 * done}%` }} />
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
  // Where the dragged row would land: before or after the row under the mouse.
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
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
  const drop = (target: string, after: boolean) => {
    if (!dragId || dragId === target) return;
    const next = ids.filter((id) => id !== dragId);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, dragId);
    setHomeLayout({ ...layout, order: next });
  };
  const half = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
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
              className={`customize-row ${shown ? "" : "off"} ${dragId === r.id ? "dragged" : ""} ${over?.id === r.id && dragId !== r.id ? (over.after ? "over-after" : "over") : ""}`}
              draggable
              onDragStart={(e) => {
                setDragId(r.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver({ id: r.id, after: half(e) });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(r.id, half(e));
              }}
              onDragEnd={() => {
                setDragId(null);
                setOver(null);
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
