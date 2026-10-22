export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** How long ago a date was, the way Spotify lists "Date added": "3 days ago", or the date past a month. */
export function formatAgo(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days < 1) return "Today";
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} ${w === 1 ? "week" : "weeks"} ago`;
  }
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
