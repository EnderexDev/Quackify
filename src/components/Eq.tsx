/** The little equalizer on what is playing: three bars, still while `paused`. Each bar moves by
 * transform, so the GPU alone animates it; the old background-size animation repainted it on
 * every frame (with the window at 165 Hz, about 45% of a core for one 14px icon, 23/10/26). */
export function Eq({ paused = false }: { paused?: boolean }) {
  return (
    <span className={`eq ${paused ? "paused" : ""}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
