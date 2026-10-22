// The command palette (Ctrl K, Ctrl L, Ctrl T or the magnifier in the top bar): search in one
// list, the best result first, and app commands after a ">".
import { useEffect, useMemo, useRef, useState } from "react";
import { areSaved } from "../api/library";
import { play, recentSearches, removeRecentSearches, saveRecentSearch, search } from "../api/spotify";
import type { Card, SearchResults, Track } from "../api/types";
import { useNav } from "../state/nav";
import { toast } from "../state/toast";
import { formatDuration } from "../util/format";
import { kindLabel } from "../util/kinds";
import { useContextMenu } from "./ContextMenu";
import { Cover } from "./Cover";
import { CloseIcon, MoreIcon, PlayIcon, QueueIcon, SearchIcon } from "./icons";
import { cardMenu, trackMenu } from "./menus";

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 5;


/** One line of the palette: a result, a recent search or a command. */
type Item = {
  key: string;
  title: string;
  sub: string;
  image?: string | null;
  round?: boolean;
  /** A result or recent search; commands have none. */
  card?: Card;
  track?: Track;
  /** The songs found, to play one of them with the rest after it. */
  tracks?: Track[];
  run: () => void;
};

export type PaletteCommand = { label: string; keys?: string; run: () => void };

/** Fired by a page to open the palette (an empty playlist's "Find songs"). */
export const OPEN_PALETTE_EVENT = "quackify:open-palette";

/** "Album · The Mallards", "Song · Lua Teal · 2:57". */
function describe(card: Card): string {
  const kind = kindLabel(card);
  if (card.kind === "artist" || card.kind === "user" || !card.subtitle) return kind;
  // Spotify's top result already starts with its kind ("Song • A2O"): not said twice.
  const parts = card.subtitle.split(" • ");
  if (parts.length > 1 && parts[0].toLowerCase() === kind.toLowerCase()) parts.shift();
  return [kind, ...parts].join(" · ");
}

/** The results in one list: the top one first, then songs and the rest, no repeats. */
function flatten(r: SearchResults): { cards: Card[]; tracks: Track[] } {
  const cards: Card[] = [];
  const seen = new Set<string>();
  const add = (c: Card) => {
    if (seen.has(c.uri)) return;
    seen.add(c.uri);
    cards.push(c);
  };
  if (r.top) add(r.top);
  const songs = r.tracks.slice(0, 3).map(
    (t): Card => ({
      uri: t.uri,
      kind: "track",
      title: t.name,
      subtitle: `${t.artists.map((a) => a.name).join(", ")} · ${formatDuration(t.durationMs)}`,
      image: t.image,
    }),
  );
  songs.forEach(add);
  [r.artists[0], r.albums[0], r.playlists[0], r.podcasts[0], ...r.artists.slice(1), ...r.albums.slice(1), ...r.playlists.slice(1)]
    .filter(Boolean)
    .forEach(add);
  return { cards: cards.slice(0, MAX_RESULTS), tracks: r.tracks };
}

const remember = (uri: string) => {
  saveRecentSearch(uri).catch((e) => console.warn("recent search not saved", e));
};

export function Palette({ initialTerm = "", onClose, commands }: { initialTerm?: string; onClose: () => void; commands: PaletteCommand[] }) {
  const nav = useNav();
  const openMenu = useContextMenu();
  const [term, setTerm] = useState(initialTerm);
  const [settled, setSettled] = useState(initialTerm.trim());
  const [results, setResults] = useState<{ term: string; cards: Card[]; tracks: Track[] } | null>(null);
  const [recent, setRecent] = useState<Card[] | null>(null);
  const [error, setError] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuAsk = useRef(0);
  const isCommand = term.trimStart().startsWith(">");

  // Focus goes back where it was when the palette closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    input.current?.select();
    return () => {
      menuAsk.current++;
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    recentSearches().then(
      (r) => alive && setRecent(r),
      () => alive && setRecent([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setSettled(isCommand ? "" : term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term, isCommand]);

  useEffect(() => {
    if (!settled) return;
    let alive = true;
    setError("");
    search(settled).then(
      (r) => alive && setResults({ term: settled, ...flatten(r) }),
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [settled]);

  const close = onClose;
  const open = (card: Card, tracks?: Track[]) => {
    remember(card.uri);
    close();
    // A song has no page of its own yet: it plays, with the other songs found after it.
    if (card.kind === "track" || card.kind === "episode") {
      // The top result can be a song missing from the song list: then it plays alone.
      const uris = tracks?.map((t) => t.uri) ?? [];
      const i = uris.indexOf(card.uri);
      (i >= 0 ? play.tracks(uris, i) : play.tracks([card.uri], 0)).catch(toast);
    } else nav.open(card.uri);
  };
  const playCard = (card: Card, tracks?: Track[]) => {
    if (card.kind === "track" || card.kind === "episode") return open(card, tracks);
    remember(card.uri);
    close();
    play.context(card.uri).catch(toast);
  };

  const removeRecent = (uris: string[]) => {
    // Optimistic; a failure puts back only these, so other removals made meanwhile stay done.
    const before = recent ?? [];
    const removed = before.filter((c) => uris.includes(c.uri));
    setRecent((r) => (r ?? []).filter((c) => !uris.includes(c.uri)));
    removeRecentSearches(uris).catch((e) => {
      toast(e);
      // Merged into what is shown now, each back near where it was.
      setRecent((r) => {
        const next = [...(r ?? [])];
        for (const c of removed) {
          if (next.some((x) => x.uri === c.uri)) continue;
          next.splice(Math.min(before.indexOf(c), next.length), 0, c);
        }
        return next;
      });
    });
  };

  const items: Item[] = useMemo(() => {
    if (isCommand) {
      const q = term.trimStart().slice(1).trim().toLowerCase();
      return commands
        .filter((c) => !q || c.label.toLowerCase().includes(q))
        .map((c) => ({ key: c.label, title: c.label, sub: c.keys ?? "", run: () => (close(), c.run()) }));
    }
    if (!term.trim()) {
      return (recent ?? []).slice(0, 8).map((c) => ({
        key: c.uri,
        title: c.title,
        sub: describe(c),
        image: c.image,
        round: c.kind === "artist" || c.kind === "user",
        card: c,
        run: () => open(c),
      }));
    }
    if (!results || results.term !== settled) return [];
    return results.cards.map((c) => ({
      key: c.uri,
      title: c.title,
      sub: describe(c),
      image: c.image,
      round: c.kind === "artist" || c.kind === "user",
      card: c,
      tracks: c.kind === "track" ? results.tracks : undefined,
      run: () => open(c, c.kind === "track" ? results.tracks : undefined),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCommand, term, recent, results, settled, commands]);

  // The selection goes back to the top when the list changes.
  useEffect(() => setAt(0), [items.length, settled, isCommand]);
  useEffect(() => {
    list.current?.querySelector(".palette-item.on")?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const seeAll = () => {
    const t = term.trim();
    if (!t || isCommand) return;
    close();
    nav.go({ page: "search", term: t });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // The focused action button goes away with the selection: keys go back to the search box.
      input.current?.focus();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      // Enter on a focused button presses that button; only the search box opens the result.
      if (e.target !== input.current) return;
      e.preventDefault();
      if (e.ctrlKey) return seeAll();
      items[at]?.run();
    }
  };

  const more = (e: React.MouseEvent, item: Item) => {
    e.stopPropagation();
    const card = item.card;
    if (!card) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const where = { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} };
    const track = item.tracks?.find((t) => t.uri === card.uri);
    const navAndClose = { open: (uri: string) => (close(), nav.open(uri)) };
    if (card.kind === "liked") return openMenu(where, cardMenu(card, undefined, navAndClose));
    // An answer that comes after the palette closed, or after another ••• was clicked, is dropped.
    const asked = ++menuAsk.current;
    const show = (saved: boolean | undefined) =>
      asked === menuAsk.current && openMenu(where, track ? trackMenu(track, saved, navAndClose) : cardMenu(card, saved, navAndClose));
    areSaved([card.uri]).then(
      ([saved]) => show(saved),
      () => show(undefined),
    );
  };

  const searching = !!term.trim() && !isCommand;
  const waiting = searching && (!results || results.term !== term.trim()) && !error;
  const nothing = searching && !waiting && !error && items.length === 0;

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label className="palette-input">
          <SearchIcon size={18} />
          <input
            ref={input}
            value={term}
            placeholder="What do you want to play?  ( > for commands )"
            onChange={(e) => setTerm(e.currentTarget.value)}
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
          />
          <kbd>Esc</kbd>
        </label>
        {!term.trim() && recent && recent.length > 0 && (
          <div className="palette-head">
            <span>Recent searches</span>
            <button className="link small" onClick={() => removeRecent(recent.map((c) => c.uri))}>
              Clear
            </button>
          </div>
        )}
        {isCommand && <div className="palette-head">Commands</div>}
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {items.map((item, i) => {
            const on = i === at;
            const card = item.card;
            const isSong = card?.kind === "track" || card?.kind === "episode";
            return (
              <div
                key={item.key}
                role="option"
                aria-selected={on}
                className={`palette-item ${on ? "on" : ""} ${searching && i === 0 ? "top" : ""}`}
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                onMouseMove={() => at !== i && setAt(i)}
                onClick={item.run}
              >
                {card ? (
                  <Cover src={item.image ?? null} kind={item.round ? "artist" : card.kind} className="palette-cover" />
                ) : (
                  <span className="palette-cover palette-cmd">&gt;</span>
                )}
                <div className="palette-text">
                  <div className="palette-title">{item.title}</div>
                  {item.sub && <div className="palette-sub">{item.sub}</div>}
                </div>
                {on && card && searching && (
                  <div className="palette-actions">
                    {card.kind !== "user" && card.kind !== "folder" && (
                      <button
                        className="palette-act"
                        aria-label="Play"
                        title="Play"
                        onClick={(e) => {
                          e.stopPropagation();
                          playCard(card, item.tracks);
                        }}
                      >
                        <PlayIcon size={14} />
                      </button>
                    )}
                    {isSong && (
                      <button
                        className="palette-act"
                        aria-label="Add to queue"
                        title="Add to queue"
                        onClick={(e) => {
                          e.stopPropagation();
                          play.addToQueue(card.uri).then(() => toast("Added to queue"), toast);
                        }}
                      >
                        <QueueIcon size={16} />
                      </button>
                    )}
                    <button className="palette-act" aria-label="More" title="More" onClick={(e) => more(e, item)}>
                      <MoreIcon size={16} />
                    </button>
                    <span className="palette-enter" aria-hidden>
                      ↵
                    </span>
                  </div>
                )}
                {!term.trim() && card && (
                  <button
                    className="palette-remove"
                    aria-label="Remove from recent searches"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecent([card.uri]);
                    }}
                  >
                    <CloseIcon size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {waiting && items.length === 0 && (
            <div className="palette-empty">
              <div className="spinner small" />
            </div>
          )}
          {error && searching && <div className="palette-empty error">{error}</div>}
          {nothing && (
            <div className="palette-empty">
              <strong>Nothing for “{term.trim()}”</strong>
              <span className="muted small">Check the spelling, or try fewer words.</span>
              <button
                className="link small"
                onClick={() => {
                  close();
                  nav.go({ page: "explore" });
                }}
              >
                Go to Explore
              </button>
            </div>
          )}
          {!term.trim() && recent && recent.length === 0 && (
            <div className="palette-empty muted small">Search for songs, artists, albums, podcasts and more. Type &gt; for commands.</div>
          )}
        </div>
        {searching && items.length > 0 && (
          <button className="palette-all" onClick={seeAll}>
            See all results for “{term.trim()}” <kbd>Ctrl ↵</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
