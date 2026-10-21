// The colour theme: System (follows Windows), Dark or Light. Kept on this computer and put on
// <html> as data-theme before the first render, so the app never opens in the wrong one.
import { useSyncExternalStore } from "react";

export type Theme = "system" | "dark" | "light";
export const THEMES: Theme[] = ["system", "dark", "light"];

const KEY = "theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function read(): Theme {
  const saved = localStorage.getItem(KEY) as Theme | null;
  return saved && THEMES.includes(saved) ? saved : "system";
}

let current = read();

function apply() {
  const dark = current === "dark" || (current === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

apply();
darkQuery.addEventListener("change", apply);

export function setTheme(t: Theme) {
  current = t;
  if (t === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, t);
  apply();
  listeners.forEach((f) => f());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}
