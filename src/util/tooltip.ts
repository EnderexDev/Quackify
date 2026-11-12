// The app's own tooltip in place of the browser's grey box: every `title` in the page becomes a
// `data-tip` the moment the mouse reaches it (before the browser's ~500 ms), and one glass bubble
// shows it above the element (under the mouse for a large one). A `title` React writes again later (Shuffle on/off after a click)
// is converted by the observer, so the native box never shows. Imported once, for its effect.

const SHOW_DELAY = 450;
/** After a tooltip hides, the next one within this time shows at once (moving along a toolbar). */
const WARM_MS = 300;
const GUTTER = 8;
const GAP = 8;

let tip: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let timer = 0;
let hiddenAt = 0;
let visible = false;
/** The delay for the current target is over: show() ran, whether it showed or held back a repeat. */
let settled = false;

function bubble() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}

/** Moves an element's `title` to `data-tip`, keeping what the title told a screen reader: the
 * name of a button with no text of its own, or else a description when it says more than the
 * name ("Shuffle on" on a button named "Shuffle"). */
function convert(el: Element) {
  const title = el.getAttribute("title");
  if (title === null) return;
  el.removeAttribute("title");
  if (!title) return clear(el);
  el.setAttribute("data-tip", title);
  // An aria-label written here (marked by data-tip-label) follows the title; one from the app stays.
  const ownLabel = el.hasAttribute("data-tip-label");
  const name = ownLabel ? "" : (el.getAttribute("aria-label") ?? el.textContent?.trim());
  if (!name) {
    el.setAttribute("aria-label", title);
    el.setAttribute("data-tip-label", "");
    el.removeAttribute("aria-description");
  } else if (name !== title) el.setAttribute("aria-description", title);
  else el.removeAttribute("aria-description");
}

/** The element no longer has a title: its tip, description and the label written here go too,
 * and its bubble closes. */
function clear(el: Element) {
  el.removeAttribute("data-tip");
  el.removeAttribute("aria-description");
  if (el.hasAttribute("data-tip-label")) {
    el.removeAttribute("aria-label");
    el.removeAttribute("data-tip-label");
  }
  if (el === target) hide();
}

/** Converts every title from the element up: an ancestor's title is what the browser would show
 * natively over a child that has none (the card's name over its Remove button). */
function convertUp(from: Element | null) {
  for (let el = from; el; el = el.parentElement) if (el.hasAttribute("title")) convert(el);
}

// React removes a `title` it no longer renders with removeAttribute; once converted the attribute
// is gone, so that call changes nothing and the observer never hears of it. Caught here instead,
// or the old tip (the last song's name) would stay on the element.
const removeAttribute = Element.prototype.removeAttribute;
Element.prototype.removeAttribute = function (this: Element, name: string) {
  if (name === "title" && !this.hasAttribute("title") && this.hasAttribute("data-tip")) clear(this);
  return removeAttribute.call(this, name);
};

/** Where the mouse is, for the bubble of a large element. */
let mouseX = 0;
let mouseY = 0;
document.addEventListener(
  "pointermove",
  (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  },
  { capture: true, passive: true },
);

/** A button gets its bubble centred above it; a large element (a card, a row, a shortcut) gets it
 * just under the mouse, where the eye already is, instead of above the whole element. */
const LARGE_W = 160;
const LARGE_H = 64;
/** Room under the mouse for the cursor's own arrow. */
const CURSOR_H = 20;

function place() {
  if (!tip || !target) return;
  const r = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const atMouse = r.width > LARGE_W || r.height > LARGE_H;
  let left = atMouse ? mouseX - w / 2 : r.left + r.width / 2 - w / 2;
  left = Math.max(GUTTER, Math.min(left, window.innerWidth - w - GUTTER));
  let top: number;
  let below: boolean;
  if (atMouse) {
    below = mouseY + CURSOR_H + h + GUTTER <= window.innerHeight;
    top = below ? mouseY + CURSOR_H : mouseY - h - GAP;
  } else {
    below = r.top - h - GAP < GUTTER;
    top = below ? r.bottom + GAP : r.top - h - GAP;
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.classList.toggle("below", below);
}

/** Whether the tip only repeats a text already shown whole inside the element (a card's name
 * written under its cover): then no bubble. A name cut with "…" still gets one. */
function repeatsVisibleText(el: HTMLElement, text: string) {
  let shown: Element | null = null;
  if (el.textContent?.trim() === text) shown = el;
  for (const child of el.querySelectorAll("*")) if (child.textContent?.trim() === text) shown = child;
  // Text hidden from sight (display none, visibility hidden, opacity 0) is not shown on screen.
  if (!shown || !shown.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  // Nor text out of the window, scrolled out of its list or under another layer (the player bar):
  // the four corners of the text must be inside the window and on top there.
  const r = shown.getBoundingClientRect();
  if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) return false;
  for (const x of [r.left + 2, r.right - 2])
    for (const y of [r.top + 2, r.bottom - 2]) {
      const top = document.elementFromPoint(x, y);
      if (!top || !(shown.contains(top) || top.contains(shown))) return false;
    }
  // The text's own box and every box around it up to the element: none cut it.
  for (let box: Element | null = shown; box; box = box === el ? null : box.parentElement) {
    if (box.clientWidth > 0 && box.scrollWidth > box.clientWidth + 1) return false;
    if (box.clientHeight > 0 && box.scrollHeight > box.clientHeight + 1) return false;
  }
  return true;
}

function show() {
  if (!target?.isConnected) return hide();
  const text = target.getAttribute("data-tip");
  if (!text) return hide();
  settled = true;
  if (repeatsVisibleText(target, text)) {
    if (visible) hiddenAt = performance.now();
    tip?.classList.remove("on");
    visible = false;
    return;
  }
  const t = bubble();
  t.textContent = text;
  place();
  t.classList.add("on");
  visible = true;
}

function hide() {
  clearTimeout(timer);
  if (visible) hiddenAt = performance.now();
  visible = false;
  settled = false;
  target = null;
  tip?.classList.remove("on");
}

document.addEventListener(
  "pointerover",
  (e) => {
    if (e.pointerType === "touch") return;
    // pointerover comes before the pointermove to the same point, and a warm bubble shows now.
    mouseX = e.clientX;
    mouseY = e.clientY;
    const from = e.target instanceof Element ? e.target : null;
    convertUp(from);
    const el = from?.closest("[data-tip]") as HTMLElement | null;
    if (el === target) return;
    const warm = visible || performance.now() - hiddenAt < WARM_MS;
    hide();
    if (!el?.getAttribute("data-tip")) return;
    target = el;
    if (warm) show();
    else timer = window.setTimeout(show, SHOW_DELAY);
  },
  true,
);

document.addEventListener(
  "pointerout",
  (e) => {
    if (!target) return;
    const to = e.relatedTarget as Node | null;
    if (to && target.contains(to)) return;
    if ((e.target as Node) === target || target.contains(e.target as Node)) hide();
  },
  true,
);

for (const type of ["pointerdown", "wheel", "keydown"] as const) document.addEventListener(type, hide, { capture: true, passive: true });
document.addEventListener("scroll", hide, { capture: true, passive: true });
window.addEventListener("blur", hide);

// A `title` written after the mouse arrived (a prop that changed) or on an element not hovered yet.
new MutationObserver((records) => {
  for (const r of records) {
    const el = r.target as HTMLElement;
    if (!el.hasAttribute("title")) continue;
    convert(el);
    // Past the delay (shown, or held back as a repeat): the new text is weighed again at once.
    if (el === target && settled) show();
  }
}).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["title"] });

export {};
