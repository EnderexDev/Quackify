// The app's language: System (follows Windows), English or Português. English is written in the
// code itself, as the key: t("Added to queue") shows it as is in English and looks it up in the
// Portuguese dictionary (src/i18n/pt/*.ts, one file per group of screens, merged here).
// Names that come from Spotify (home sections, genres) already arrive in the account's language.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Lang = "system" | "en" | "pt";
export const LANGS: Lang[] = ["system", "en", "pt"];

const KEY = "lang";
const listeners = new Set<() => void>();

const files = import.meta.glob<{ default: Record<string, string> }>("./pt/*.ts", { eager: true });
const pt: Record<string, string> = Object.assign({}, ...Object.values(files).map((f) => f.default));

const read = (): Lang => {
  const saved = localStorage.getItem(KEY) as Lang | null;
  return saved && LANGS.includes(saved) ? saved : "system";
};

let choice = read();
const systemIsPt = () => (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase().startsWith("pt");
/** The language shown now. */
export const lang = (): "en" | "pt" => (choice === "pt" || (choice === "system" && systemIsPt()) ? "pt" : "en");

const apply = () => {
  document.documentElement.lang = lang() === "pt" ? "pt-BR" : "en";
  listeners.forEach((f) => f());
};
apply();

// Following System: Windows' language changing while the app runs.
window.addEventListener("languagechange", () => {
  if (choice !== "system") return;
  apply();
  syncLang();
});

// The other window (the mini player) follows a change made here, and the other way round.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  choice = read();
  apply();
});

/** Saves the choice; the Rust side (tray menu, the browser page after login) follows it too. */
export function setLang(l: Lang) {
  choice = l;
  if (l === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, l);
  apply();
  invoke("settings_set_language", { language: lang() }).catch(() => {});
}

/** Tells the Rust side the language at start, so the tray menu is in it. */
export const syncLang = () => invoke("settings_set_language", { language: lang() }).catch(() => {});

/** Own keys only: "toString" and the like are not translations or values. */
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * `text` in the language shown, with {name} filled from `vars`. In English it is `text` itself;
 * a Portuguese one missing from the dictionary shows the English (i18n-check.mjs lists those).
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = lang() === "pt" && own(pt, text) ? pt[text] : text;
  // One pass over the template: a value that itself holds "{x}" (a playlist's name) stays as is.
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (own(vars, k) ? String(vars[k]) : m)) : out;
}

/** The choice (System, English or Português), kept up to date. */
export const useLangChoice = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => choice,
  );

/** The language shown, kept up to date: a component that calls it re-renders on a change. */
export const useLang = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    lang,
  );

/** Numbers and dates in the language shown. */
export const locale = () => (lang() === "pt" ? "pt-BR" : "en-US");
