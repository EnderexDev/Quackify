import { useLayoutEffect, useRef, useState } from "react";

/** A row of choices with a glass pill that slides to the one picked (top bar tabs, Settings). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
  label,
}: {
  options: { id: T; label: string }[];
  /** null when none of them is the page open: the pill hides. */
  value: T | null;
  onChange: (id: T) => void;
  className?: string;
  label?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = row.current?.querySelector<HTMLElement>(".seg-btn.on");
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    // The labels change width when the font loads or the window shrinks.
    const ro = new ResizeObserver(measure);
    if (row.current) ro.observe(row.current);
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div ref={row} className={`segmented ${className}`} role="tablist" aria-label={label}>
      {pill && <span className="seg-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          className={`seg-btn ${value === o.id ? "on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
