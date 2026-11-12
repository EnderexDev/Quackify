// The app's own tooltip in place of the browser's grey box: every `title` in the page becomes a
// `data-tip` the moment the mouse reaches it (before the browser's ~500 ms), and one glass bubble
// shows it above the element. A `title` React writes again later (Shuffle on/off after a click)
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

function bubble() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  return tip;
}

/** Moves an element's `title` to `data-tip`, keeping it as the accessible name of a button with
 * no text of its own. */
function convert(el: Element) {
  const title = el.getAttribute("title");
  if (title === null) return;
  el.removeAttribute("title");
  if (title) el.setAttribute("data-tip", title);
  else el.removeAttribute("data-tip");
  if (title && !el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
}

function place() {
  if (!tip || !target) return;
  const r = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(GUTTER, Math.min(left, window.innerWidth - w - GUTTER));
  let top = r.top - h - GAP;
  let below = false;
  if (top < GUTTER) {
    top = r.bottom + GAP;
    below = true;
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.classList.toggle("below", below);
}

function show() {
  if (!target?.isConnected) return hide();
  const text = target.getAttribute("data-tip");
  if (!text) return hide();
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
  target = null;
  tip?.classList.remove("on");
}

document.addEventListener(
  "pointerover",
  (e) => {
    if (e.pointerType === "touch") return;
    const el = (e.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
    if (el) convert(el);
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
    if (el === target && visible) {
      const text = el.getAttribute("data-tip");
      if (text && tip) {
        tip.textContent = text;
        place();
      } else hide();
    }
  }
}).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["title"] });

export {};
