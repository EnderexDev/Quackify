// How the user arranged Home (spec "Personalizar início"): rows pinned to the top, hidden,
// reordered, and rows of their own library added. Kept on this computer, by section id.
import { useSyncExternalStore } from "react";
import type { LibraryFilter } from "../api/types";
import { t } from "../i18n";

export type HomeLayout = {
  /** Row ids in the order the user left them; rows not listed keep Spotify's order after them. */
  order: string[];
  hidden: string[];
  pinned: string[];
  /** Library rows added, as their filter. */
  added: Exclude<LibraryFilter, null>[];
};

const KEY = "homeLayout";
const EMPTY: HomeLayout = { order: [], hidden: [], pinned: [], added: [] };

/** The library rows a user can add, with their titles (getters: read when drawn, in the language shown then). */
export const LIBRARY_ROWS: { filter: Exclude<LibraryFilter, null>; readonly title: string }[] = [
  { filter: "Playlists", get title() { return t("Your playlists"); } },
  { filter: "Albums", get title() { return t("Your albums"); } },
  { filter: "Artists", get title() { return t("Your artists"); } },
  { filter: "Podcasts & Shows", get title() { return t("Your podcasts"); } },
];

export const libraryRowId = (filter: string) => `library:${filter}`;

function read(): HomeLayout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return EMPTY;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    const filters = LIBRARY_ROWS.map((r) => r.filter as string);
    return {
      order: list(v.order),
      hidden: list(v.hidden),
      pinned: list(v.pinned),
      added: list(v.added).filter((f) => filters.includes(f)) as HomeLayout["added"],
    };
  } catch {
    return EMPTY;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function setHomeLayout(next: HomeLayout) {
  current = next;
  const empty = !next.order.length && !next.hidden.length && !next.pinned.length && !next.added.length;
  try {
    if (empty) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or off: the change still shows, it just will not outlive the app.
  }
  listeners.forEach((f) => f());
}

export const resetHomeLayout = () => setHomeLayout(EMPTY);

export function useHomeLayout(): HomeLayout {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

/**
 * The rows in the order to show them: pinned first, then the user's order, then rows the user
 * never placed in the order Spotify sent them. Hidden rows stay in the list (the editor shows
 * them); `visible` drops them.
 */
export function arrange<T extends { id: string }>(rows: T[], layout: HomeLayout): T[] {
  const rank = (id: string) => {
    const i = layout.order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const pa = layout.pinned.includes(a.row.id) ? 0 : 1;
      const pb = layout.pinned.includes(b.row.id) ? 0 : 1;
      return pa - pb || rank(a.row.id) - rank(b.row.id) || a.i - b.i;
    })
    .map((x) => x.row);
}
