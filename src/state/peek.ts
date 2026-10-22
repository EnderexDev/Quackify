// Peek: holding the click still on a card for 400 ms (or Space on it) opens a preview beside
// it. Moving first makes it a drag. Released, the preview closes; released on one of its
// buttons or songs, that runs. The layer that draws it is components/Peek.tsx.
import { useEffect, useState } from "react";
import type { Card, Kind } from "../api/types";

export type PeekOpen = { card: Card; rect: DOMRect; cover: DOMRect | null; mode: "hold" | "key"; from: HTMLElement };

/** The kinds a peek can show: their songs can be listed. */
export const PEEKABLE = new Set<Kind>(["playlist", "album", "liked", "artist"]);

const HOLD_MS = 400;
/** How far the pointer may move while held before it is a drag instead. */
const SLOP = 5;

let open: PeekOpen | null = null;
const listeners = new Set<(p: PeekOpen | null) => void>();
const set = (p: PeekOpen | null) => {
  open = p;
  listeners.forEach((f) => f(p));
};

export const peeking = () => open !== null;
export const closePeek = () => set(null);

export function usePeekState(): PeekOpen | null {
  const [p, setP] = useState(open);
  useEffect(() => {
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return p;
}

// The click that ends a hold would open the card under it: it is swallowed.
let swallowClick = false;
document.addEventListener(
  "click",
  (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);
/** Presses a button of the open peek on release: past the guard, which stays up for the
 * browser's own click that follows. */
export function pressInPeek(el: HTMLElement) {
  const was = swallowClick;
  swallowClick = false;
  el.click();
  swallowClick = was;
}

// A release away from the card makes no click: the next press starts clean.
document.addEventListener("pointerdown", () => (swallowClick = false), true);

function openFrom(el: HTMLElement, card: Card, mode: PeekOpen["mode"]) {
  const cover = el.querySelector<HTMLElement>(".cover");
  set({ card, rect: el.getBoundingClientRect(), cover: cover?.getBoundingClientRect() ?? null, mode, from: el });
}

/**
 * What makes an element peek its card: hold the pointer still on it, or press Space with it
 * in focus. While the hold runs the element has the class peek-holding (the ring fills).
 * `onEnter` runs on Enter, so a row keeps its own key in the same handler.
 */
export function peekProps(card: Card, onEnter?: () => void) {
  const enter = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!onEnter || e.key !== "Enter" || e.target !== e.currentTarget) return false;
    e.preventDefault();
    onEnter();
    return true;
  };
  if (!PEEKABLE.has(card.kind)) return onEnter ? { onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void enter(e) } : {};
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const el = e.currentTarget;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let timer = 0;
    const stop = () => {
      clearTimeout(timer);
      el.classList.remove("peek-holding");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("dragstart", stop);
    };
    const move = (m: PointerEvent) => Math.hypot(m.clientX - x0, m.clientY - y0) > SLOP && stop();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("dragstart", stop);
    el.classList.add("peek-holding");
    timer = window.setTimeout(() => {
      stop();
      swallowClick = true;
      openFrom(el, card, "hold");
    }, HOLD_MS);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (enter(e) || e.key !== " " || e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    if (open?.card.uri === card.uri) closePeek();
    else openFrom(e.currentTarget, card, "key");
  };
  return { onPointerDown, onKeyDown };
}
