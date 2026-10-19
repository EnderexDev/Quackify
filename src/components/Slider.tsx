import { useRef, useState } from "react";

/**
 * A horizontal 0..1 slider. While dragging it shows the drag position; `onCommit` fires on
 * release (or on every move when `live`, for volume).
 */
export function Slider({
  value,
  onCommit,
  live = false,
  disabled = false,
  className = "",
}: {
  value: number;
  onCommit: (v: number) => void;
  live?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const shown = Math.min(1, Math.max(0, drag ?? value));

  return (
    <div
      ref={bar}
      className={`slider ${disabled ? "disabled" : ""} ${drag !== null ? "dragging" : ""} ${className}`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = at(e.clientX);
        setDrag(v);
        if (live) onCommit(v);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const v = at(e.clientX);
        setDrag(v);
        if (live) onCommit(v);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        const v = at(e.clientX);
        setDrag(null);
        onCommit(v);
      }}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${shown * 100}%` }} />
      </div>
      <div className="slider-thumb" style={{ left: `${shown * 100}%` }} />
    </div>
  );
}
