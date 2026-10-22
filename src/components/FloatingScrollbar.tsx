import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Space kept clear at the top and bottom, so the thumb never meets the panel's round corners. */
const MARGIN = 14;
const MIN_THUMB = 32;
/** How long the bar stays after the page stops moving. */
const LINGER_MS = 1000;

/**
 * The page's scrollbar, drawn over the page instead of beside it, so a coloured header reaches
 * the panel's edge. It shows while the page scrolls, with the mouse on it, and while dragged.
 * `target` scrolls as before (its own bar is hidden in CSS); this only follows and drives it.
 */
export function FloatingScrollbar({ target }: { target: HTMLElement | null }) {
  const thumb = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const placeRef = useRef<() => void>(() => {});
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    // A new page (or none, between two) ends any drag of the old one: its pointerup may never come.
    setDragging(false);
    if (!target) return;
    let timer = 0;
    const place = () => {
      const { scrollTop, scrollHeight, clientHeight } = target;
      const range = scrollHeight - clientHeight;
      setFits(range <= 1);
      const t = thumb.current;
      const tr = track.current;
      // Not drawn yet: the render that setFits causes draws it, and its layout effect places it.
      if (range <= 1 || !t || !tr) return;
      const room = tr.clientHeight;
      const h = Math.min(room, Math.max(MIN_THUMB, (room * clientHeight) / scrollHeight));
      t.style.height = `${h}px`;
      t.style.transform = `translateY(${((room - h) * scrollTop) / range}px)`;
    };
    const onScroll = () => {
      place();
      setActive(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => setActive(false), LINGER_MS);
    };
    // The page grows as rows load and shrinks as it changes, without a scroll event.
    placeRef.current = place;
    const sizes = new ResizeObserver(place);
    sizes.observe(target);
    for (const c of target.children) sizes.observe(c);
    const children = new MutationObserver((changes) => {
      for (const m of changes) {
        m.removedNodes.forEach((n) => n instanceof Element && sizes.unobserve(n));
        m.addedNodes.forEach((n) => n instanceof Element && sizes.observe(n));
      }
      // A child removed changes the page's height without resizing anything still observed.
      place();
    });
    children.observe(target, { childList: true });
    target.addEventListener("scroll", onScroll, { passive: true });
    place();
    return () => {
      clearTimeout(timer);
      sizes.disconnect();
      children.disconnect();
      target.removeEventListener("scroll", onScroll);
    };
  }, [target]);

  useLayoutEffect(() => {
    if (!fits) placeRef.current();
    // The thumb went away mid-drag (the page got short): its pointerup will never come.
    else setDragging(false);
  }, [fits]);

  if (!target || fits) return null;

  const scale = () => {
    const room = track.current?.clientHeight ?? 1;
    const h = thumb.current?.offsetHeight ?? 0;
    return (target.scrollHeight - target.clientHeight) / Math.max(1, room - h);
  };

  return (
    <div
      ref={track}
      className={`floating-scrollbar ${active || dragging ? "on" : ""}`}
      style={{ ["--margin" as string]: `${MARGIN}px` }}
      // The strip sits over the page's edge: the wheel there still scrolls the page.
      onWheel={(e) => {
        // Some mice report lines or pages instead of pixels.
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? target.clientHeight : 1;
        target.scrollBy({ top: e.deltaY * unit });
      }}
      onPointerDown={(e) => {
        // A click on the track jumps a page toward it, as the bar it replaces did.
        if (e.target !== track.current || !thumb.current) return;
        const above = e.clientY < thumb.current.getBoundingClientRect().top;
        target.scrollBy({ top: (above ? -1 : 1) * target.clientHeight * 0.9, behavior: "smooth" });
      }}
    >
      <div
        ref={thumb}
        className="floating-thumb"
        onPointerDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startTop = target.scrollTop;
          const k = scale();
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          setDragging(true);
          const move = (m: PointerEvent) => {
            // The page changed mid-drag: this drag belonged to the old one.
            if (targetRef.current !== target) return up();
            target.scrollTop = startTop + (m.clientY - startY) * k;
          };
          const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            setDragging(false);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
          el.addEventListener("pointercancel", up);
        }}
      />
    </div>
  );
}
