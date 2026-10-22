// Reduce animations: System (follows Windows' "Animation effects") or On. Kept on this
// computer like the theme and put on <html> as the "reduce-motion" class before the first
// render; with it nothing loops and every transition becomes a short fade (motion.css).
import { useSyncExternalStore } from "react";

export type Motion = "system" | "on";

const KEY = "reduceMotion";
const query = window.matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<() => void>();

let choice: Motion = localStorage.getItem(KEY) === "on" ? "on" : "system";

/** Whether animations are reduced now, by the choice here or by Windows. */
export const reducedMotion = () => choice === "on" || query.matches;

function apply() {
  document.documentElement.classList.toggle("reduce-motion", reducedMotion());
  listeners.forEach((f) => f());
}

apply();
query.addEventListener("change", apply);

export function setMotion(m: Motion) {
  choice = m;
  if (m === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, m);
  apply();
}

/** The choice (System or On). */
export const useMotion = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => choice,
  );

/** Whether animations are reduced now, kept up to date. */
export const useReducedMotion = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    reducedMotion,
  );
