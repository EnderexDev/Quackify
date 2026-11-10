import type { Card, Section } from "../api/types";

/** A Spotify section with fewer cards than this is not a row of its own. */
export const ROW_MIN = 3;

/**
 * Spotify's Home sends about twenty sections of a single card ("Made For You", "Fans of X",
 * "Similar to Y"), several under the same title, and gives them a new id on every read. Shown
 * as they come, Home is a column of one-card rows that come and go and lose their saved place.
 *
 * Here sections with the same title become one row, and those still short of ROW_MIN cards go
 * to `picks`, a single row whose cards say, under the name, why Spotify picked them. A card is
 * left out of `picks` when a row the user sees already has it (`hidden` says which rows they
 * hid); rows of their own keep Spotify's cards as sent, even when two rows share one.
 */
export function tidySections(
  sections: Section[],
  hidden: (row: Section) => boolean = () => false,
): { rows: Section[]; picks: Card[] } {
  const byTitle = new Map<string, Section>();
  // Titles whose row already took its id and Show all from a full section.
  const settled = new Set<string>();
  for (const s of sections) {
    const same = byTitle.get(s.title);
    // A row made of one-card sections takes no id from them (theirs change on every read, so
    // Home names it by its title) and no Show all (it would open the single card).
    const small = s.cards.length < ROW_MIN;
    if (!same) byTitle.set(s.title, { ...s, cards: [...s.cards], uri: small ? null : s.uri, more: small ? false : s.more });
    else {
      same.cards.push(...s.cards.filter((c) => !same.cards.some((k) => k.uri === c.uri)));
      // Id and Show all come from the first full section of that title, wherever it is in the list.
      if (!small && !settled.has(s.title)) {
        same.uri = s.uri;
        same.more = s.more;
      }
    }
    if (!small) settled.add(s.title);
  }
  const rows: Section[] = [];
  const short: Section[] = [];
  for (const s of byTitle.values()) (s.cards.length >= ROW_MIN ? rows : short).push(s);
  const seen = new Set(rows.filter((s) => !hidden(s)).flatMap((s) => s.cards.map((c) => c.uri)));
  const picks: Card[] = [];
  for (const s of short) {
    for (const c of s.cards) {
      if (seen.has(c.uri)) continue;
      seen.add(c.uri);
      picks.push(s.title ? { ...c, subtitle: s.title } : c);
    }
  }
  return { rows, picks };
}
