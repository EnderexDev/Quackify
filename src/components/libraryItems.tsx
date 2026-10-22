// What the sidebar and the Your Library page share: the pages of items, the right-click menu
// with Pin, and songs dropped on a playlist or Liked Songs.
import { useEffect, useRef, useState } from "react";
import { areSaved, save } from "../api/library";
import { library, pinInLibrary, type LibraryQuery } from "../api/spotify";
import type { Card } from "../api/types";
import { useNav } from "../state/nav";
import { markSaved, notifyLibraryChanged, onLibraryChanged } from "../state/saved";
import { toast } from "../state/toast";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { addAll, cardMenu, TRACKS_MIME } from "./menus";

/** A setting of Your Library kept for the next start. Storage that fails only loses the
 * memory: the choice still applies. */
export function usePersisted<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = readStored(key) as T | null;
    return saved && allowed.includes(saved) ? saved : fallback;
  });
  return [
    value,
    (v: T) => {
      writeStored(key, v);
      setValue(v);
    },
  ];
}

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Full or unavailable: the setting lasts until the app closes.
  }
}

/** A clickable row reached by Tab and run with Enter (Space is left to peek, on a card). */
export function pressable(run: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" || e.target !== e.currentTarget) return;
      e.preventDefault();
      run();
    },
  };
}

/** How many items a page of Your Library has. */
export const LIBRARY_PAGE = 50;

/**
 * Your Library a page at a time for `query`: the next page loads when `sentinel` comes into
 * view, or all of them at once with `all` (grouping needs every item). A save or a removal
 * anywhere reloads it.
 */
export function useLibraryPages(query: LibraryQuery, all = false) {
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // Where the next page starts on Spotify's side (items shown can be fewer: duplicates are
  // dropped), and which query the pages belong to: an answer for an older query is ignored.
  const nextOffset = useRef(0);
  const generation = useRef(0);
  const loadingMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // Bumped when something is saved or removed, to reload the list.
  const [version, setVersion] = useState(0);
  useEffect(() => onLibraryChanged(() => setVersion((v) => v + 1)), []);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const gen = ++generation.current;
    // A new query starts empty, and no next page is asked before its first page is in.
    nextOffset.current = Number.POSITIVE_INFINITY;
    loadingMore.current = false;
    setItems([]);
    setTotal(0);
    setLoaded(false);
    setError("");
    // Typing waits for a pause.
    const id = setTimeout(
      () =>
        library(query, 0).then(
          (page) => {
            if (gen !== generation.current) return;
            nextOffset.current = LIBRARY_PAGE;
            setItems(page.items);
            setTotal(page.total);
            setLoaded(true);
          },
          (e) => gen === generation.current && setError(String(e)),
        ),
      query.text ? 250 : 0,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, version]);

  const loadMore = () => {
    if (loadingMore.current || !loaded || nextOffset.current >= total) return;
    const gen = generation.current;
    const offset = nextOffset.current;
    loadingMore.current = true;
    setError("");
    library(query, offset)
      .then((page) => {
        if (gen !== generation.current) return;
        // Moves on even when the page added nothing new, so the same page is not asked again;
        // an empty page ends the list.
        nextOffset.current = page.items.length ? offset + LIBRARY_PAGE : total;
        setItems((prev) => {
          const have = new Set(prev.map((p) => p.uri));
          return [...prev, ...page.items.filter((c) => !have.has(c.uri))];
        });
      })
      .catch((e) => gen === generation.current && setError(String(e)))
      .finally(() => {
        if (gen === generation.current) loadingMore.current = false;
      });
  };

  // Every page, one after the other, when all of them are wanted.
  useEffect(() => {
    if (all) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, items, loaded]);

  // Next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || all) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, total, loaded, all, queryKey]);

  const reload = () => setVersion((v) => v + 1);
  const complete = loaded && (nextOffset.current >= total || items.length >= total);
  // A failed next page stops the loading; `loadMore` tries it again.
  return { items, total, loaded, complete, error, sentinel, reload, loadMore };
}

/** The line under an item's name in the sidebar. */
export function librarySubtitle(c: Card): string {
  return c.kind === "liked"
    ? `Playlist • ${c.subtitle}`
    : c.kind === "artist"
      ? "Artist"
      : c.kind === "show"
        ? `Podcast • ${c.subtitle}`
        : c.kind === "folder"
          ? `Folder • ${c.subtitle}`
          : c.subtitle;
}

/**
 * The right-click menu of an item (the card menu plus Pin or Unpin), and songs dragged from a
 * list onto a playlist (added) or Liked Songs (liked). `onPinned` hears a pin change.
 */
export function useLibraryActions(onPinned?: () => void) {
  const nav = useNav();
  const openMenu = useContextMenu();
  const [dropOn, setDropOn] = useState<string | null>(null);

  const pinItem = (c: Card): MenuItem[] =>
    c.pinnable
      ? [
          "separator",
          {
            label: c.pinned ? (c.kind === "folder" ? "Unpin folder" : "Unpin") : c.kind === "folder" ? "Pin folder" : "Pin",
            onClick: () =>
              pinInLibrary(c.uri, !c.pinned).then(() => {
                toast(c.pinned ? "Unpinned" : "Pinned to the top of Your Library");
                notifyLibraryChanged();
                onPinned?.();
              }, toast),
          },
        ]
      : [];

  const onMenu = (e: React.MouseEvent, c: Card) => {
    e.preventDefault();
    e.stopPropagation();
    const at = { clientX: e.clientX, clientY: e.clientY, preventDefault: () => {} };
    if (c.kind === "folder") return openMenu(at, [{ label: "Open", onClick: () => nav.open(c.uri, c.title) }, ...pinItem(c)]);
    if (c.kind === "liked") return openMenu(at, [...cardMenu(c, undefined, nav), ...pinItem(c)]);
    areSaved([c.uri]).then(
      ([saved]) => openMenu(at, [...cardMenu(c, saved, nav), ...pinItem(c)]),
      () => openMenu(at, [...cardMenu(c, undefined, nav), ...pinItem(c)]),
    );
  };

  const takesSongs = (c: Card) => c.kind === "playlist" || c.kind === "liked";
  const dropSongs = (c: Card, data: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    // Only a list of song or episode URIs is taken.
    if (!Array.isArray(parsed)) return;
    const uris = parsed.filter((u): u is string => typeof u === "string" && /^spotify:(track|episode):\w+$/.test(u));
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

  /** Handlers that make an item take dropped songs; `dropOn` is the item under the drag. */
  const dropProps = (c: Card) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!takesSongs(c) || !e.dataTransfer.types.includes(TRACKS_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropOn(c.uri);
    },
    onDragLeave: () => setDropOn((d) => (d === c.uri ? null : d)),
    onDrop: (e: React.DragEvent) => {
      setDropOn(null);
      const data = e.dataTransfer.getData(TRACKS_MIME);
      if (!takesSongs(c) || !data) return;
      e.preventDefault();
      dropSongs(c, data);
    },
  });

  return { onMenu, dropProps, dropOn };
}
