// Inline SVG icons, 24x24 viewBox, drawn in currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" />
  </Icon>
);

export const PauseIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Icon>
);

export const NextIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 5.2v13.6a.8.8 0 0 0 1.25.66L15.5 13v5.5a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1h-1.5a1 1 0 0 0-1 1V11L6.25 4.54A.8.8 0 0 0 5 5.2z" />
  </Icon>
);

export const PrevIcon = (p: P) => (
  <Icon {...p} style={{ transform: "scaleX(-1)", ...p.style }}>
    <path d="M5 5.2v13.6a.8.8 0 0 0 1.25.66L15.5 13v5.5a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-13a1 1 0 0 0-1-1h-1.5a1 1 0 0 0-1 1V11L6.25 4.54A.8.8 0 0 0 5 5.2z" />
  </Icon>
);

export const ShuffleIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </Icon>
);

export const RepeatIcon = ({ one, ...p }: P & { one?: boolean }) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    {one && <text x="12" y="14.5" fontSize="8" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">1</text>}
  </Icon>
);

export const VolumeIcon = ({ level, ...p }: P & { level: number }) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
    {level === 0 ? (
      <path d="M22 9l-6 6M16 9l6 6" />
    ) : (
      <>
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        {level > 0.5 && <path d="M18.5 5.5a9 9 0 0 1 0 13" />}
      </>
    )}
  </Icon>
);

export const HomeIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Icon {...p} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </Icon>
);

export const SearchIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.5-4.5" />
  </Icon>
);

export const LibraryIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M4 3v18M9 3v18M14 4l6 16" />
  </Icon>
);

export const BackIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 5-7 7 7 7" />
  </Icon>
);

export const ForwardIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const ClockIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const HeartIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21s-7.5-4.6-9.7-9.4C.6 7.9 3 4 6.8 4c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3C21 4 23.4 7.9 21.7 11.6 19.5 16.4 12 21 12 21z" />
  </Icon>
);

export const MusicIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </Icon>
);

/** The duck: Quackify's mark. */
export const DuckIcon = (p: P) => (
  <Icon {...p} viewBox="0 0 64 64">
    <path
      fill="#ffd84d"
      d="M38 10c7.7 0 14 6.1 14 13.7 0 3.1-1 5.9-2.8 8.2C56.7 35 61 41 61 47.6 61 56.6 52.4 62 41 62H20C9.5 62 3 55.8 3 47.4c0-6.8 5.5-11.6 12.3-11.6 3.2 0 6 1 8.1 2.9-.7-2-1.1-4.1-1.1-6.4C22.3 18.2 29.3 10 38 10z"
    />
    <path fill="#ff9f1c" d="M50 21.5c4.8-.6 9.2.4 11 2.6-1.8 2.6-6.4 4-11.6 3.6z" />
    <circle cx="42" cy="20" r="3" fill="#1a1a1a" />
    <path fill="#f2c230" d="M20 44c6 6 18 7 26 1-3 8-13 11-21 8-4-1.5-6-5-5-9z" />
  </Icon>
);

export const DevicesIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
    <rect x="3" y="3" width="10" height="18" rx="2" />
    <circle cx="8" cy="15" r="2.5" />
    <circle cx="8" cy="7.5" r="1" fill="currentColor" />
    <path d="M16 6h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
  </Icon>
);

/** An icon per Spotify Connect device type. */
export const DeviceIcon = ({ kind, ...p }: P & { kind: string }) => {
  const k = kind.toUpperCase();
  if (k === "SMARTPHONE" || k === "TABLET") {
    return (
      <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8}>
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <path d="M11 18h2" strokeLinecap="round" />
      </Icon>
    );
  }
  if (k === "TV" || k === "STB" || k === "GAME_CONSOLE") {
    return (
      <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </Icon>
    );
  }
  if (k === "COMPUTER") {
    return (
      <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <rect x="3" y="4" width="18" height="12" rx="1.5" />
        <path d="M1.5 20h21" />
      </Icon>
    );
  }
  return (
    <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <circle cx="12" cy="14" r="4" />
      <circle cx="12" cy="6.5" r="1.2" fill="currentColor" />
    </Icon>
  );
};

export const HeartOutlineIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
    <path d="M12 20.5s-7-4.3-9-8.8C1.5 8.2 3.7 4.8 7 4.8c2 0 3.4 1 5 2.8 1.6-1.8 3-2.8 5-2.8 3.3 0 5.5 3.4 4 6.9-2 4.5-9 8.8-9 8.8z" />
  </Icon>
);

export const QueueIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <path d="M4 6h12M4 11h12M4 16h7" />
    <path d="M15 14v6l5-3z" fill="currentColor" stroke="none" />
  </Icon>
);

export const ChevronRightIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
