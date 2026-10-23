// Icons v2 of the redesign: one 1.75px stroke on a 24 grid, round ends, drawn in currentColor.
// Two styles: outline (the default) and active. Active is solid on play, pause, next, previous
// and the liked heart; on the others it is the stroke over a 25% fill.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };

function Icon({ size = 20, active = false, solid = false, children, ...rest }: P & { solid?: boolean; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      fillOpacity={active && !solid ? 0.25 : undefined}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Dots drawn solid in both styles (more, list). */
const Dot = ({ cx, cy, r }: { cx: number; cy: number; r: number }) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" fillOpacity={1} stroke="none" />
);

// Transport buttons are solid unless asked otherwise: they sit on the player and on play buttons.
export const PlayIcon = ({ active = true, ...p }: P) => (
  <Icon {...p} active={active} solid>
    <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.3-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" />
  </Icon>
);

export const PauseIcon = ({ active = true, ...p }: P) => (
  <Icon {...p} active={active} solid>
    <rect x="6.5" y="5" width="3.6" height="14" rx="1.3" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1.3" />
  </Icon>
);

export const NextIcon = ({ active = true, ...p }: P) => (
  <Icon {...p} active={active} solid>
    <path d="M5.5 6.4v11.2a.9.9 0 0 0 1.42.74l8.1-5.6a.9.9 0 0 0 0-1.48l-8.1-5.6A.9.9 0 0 0 5.5 6.4z" />
    <path d="M18.5 5.5v13" />
  </Icon>
);

export const PrevIcon = ({ active = true, ...p }: P) => (
  <Icon {...p} active={active} solid>
    <path d="M18.5 6.4v11.2a.9.9 0 0 1-1.42.74l-8.1-5.6a.9.9 0 0 1 0-1.48l8.1-5.6a.9.9 0 0 1 1.42.74z" />
    <path d="M5.5 5.5v13" />
  </Icon>
);

export const ShuffleIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 7.5h2.8c2 0 3.3.9 4.4 2.5l2.6 4c1.1 1.6 2.4 2.5 4.4 2.5h2.8" />
    <path d="m18 14 2.5 2.5L18 19" />
    <path d="M3.5 16.5h2.8c1.4 0 2.4-.5 3.2-1.3m5-6.4c.8-.8 1.8-1.3 3.2-1.3h2.8" />
    <path d="m18 5 2.5 2.5L18 10" />
  </Icon>
);

export const RepeatIcon = ({ one, ...p }: P & { one?: boolean }) => (
  <Icon {...p}>
    <path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H19" />
    <path d="m16.5 4 2.5 2.5L16.5 9" />
    <path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H5" />
    <path d="M7.5 20 5 17.5 7.5 15" />
    {one && (
      <text x="12" y="14.6" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" fillOpacity={1} stroke="none">
        1
      </text>
    )}
  </Icon>
);

/** Back 15 seconds: an open circle turning left with 15 inside (episodes). */
export const Back15Icon = (p: P) => (
  <Icon {...p}>
    <path d="M5.2 9.2A7.6 7.6 0 1 1 4.6 14" />
    <path d="M4.6 4.8v4.6h4.6" />
    <text x="12.6" y="15.3" fontSize="7.2" fontWeight="700" textAnchor="middle" fill="currentColor" fillOpacity={1} stroke="none">
      15
    </text>
  </Icon>
);

/** Forward 15 seconds: the mirror of Back15Icon. */
export const Forward15Icon = (p: P) => (
  <Icon {...p}>
    <path d="M18.8 9.2A7.6 7.6 0 1 0 19.4 14" />
    <path d="M19.4 4.8v4.6h-4.6" />
    <text x="11.4" y="15.3" fontSize="7.2" fontWeight="700" textAnchor="middle" fill="currentColor" fillOpacity={1} stroke="none">
      15
    </text>
  </Icon>
);

/** Muted at 0, one wave up to half, two above. */
export const VolumeIcon = ({ level, ...p }: P & { level: number }) => (
  <Icon {...p}>
    <path d="M4.5 9.5h2.8l4.2-3.8v12.6l-4.2-3.8H4.5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" />
    {level === 0 ? (
      <path d="m15.5 9.5 5 5m0-5-5 5" />
    ) : (
      <>
        <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
        {level > 0.5 && <path d="M18.3 6.5a7.8 7.8 0 0 1 0 11" />}
      </>
    )}
  </Icon>
);

export const HomeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 10.4 12 4.2l8 6.2v8.4a1.7 1.7 0 0 1-1.7 1.7H15v-5.3a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.3H5.7A1.7 1.7 0 0 1 4 18.8z" />
  </Icon>
);

export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.6" />
    <path d="m20 20-4.3-4.3" />
  </Icon>
);

export const LibraryIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4.5" width="4" height="15" rx="1.4" />
    <rect x="10" y="4.5" width="4" height="15" rx="1.4" />
    <path d="m16 6.2 3.6-1L23 18.5l-3.6 1z" />
  </Icon>
);

export const BackIcon = (p: P) => (
  <Icon {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);

export const ForwardIcon = (p: P) => (
  <Icon {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

const HEART = "M12 19.6s-7.6-4.4-7.6-9.8a4.4 4.4 0 0 1 7.6-2.7 4.4 4.4 0 0 1 7.6 2.7c0 5.4-7.6 9.8-7.6 9.8z";

/** The liked heart: solid. */
export const HeartIcon = (p: P) => (
  <Icon {...p} active solid>
    <path d={HEART} />
  </Icon>
);

export const HeartOutlineIcon = (p: P) => (
  <Icon {...p}>
    <path d={HEART} />
  </Icon>
);

export const MusicIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Icon>
);

/** The duck: Quackify's mark. */
export const DuckIcon = ({ size = 20, ...p }: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden {...p}>
    <path
      fill="#ffd84d"
      d="M38 10c7.7 0 14 6.1 14 13.7 0 3.1-1 5.9-2.8 8.2C56.7 35 61 41 61 47.6 61 56.6 52.4 62 41 62H20C9.5 62 3 55.8 3 47.4c0-6.8 5.5-11.6 12.3-11.6 3.2 0 6 1 8.1 2.9-.7-2-1.1-4.1-1.1-6.4C22.3 18.2 29.3 10 38 10z"
    />
    <path fill="#ff9f1c" d="M50 21.5c4.8-.6 9.2.4 11 2.6-1.8 2.6-6.4 4-11.6 3.6z" />
    <circle cx="42" cy="20" r="3" fill="#1a1a1a" />
    <path fill="#f2c230" d="M20 44c6 6 18 7 26 1-3 8-13 11-21 8-4-1.5-6-5-5-9z" />
  </svg>
);

export const DevicesIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="10" height="16" rx="2.2" />
    <circle cx="8.5" cy="14.5" r="2.2" />
    <path d="M17 7.5h1.8a1.7 1.7 0 0 1 1.7 1.7v9.1a1.7 1.7 0 0 1-1.7 1.7H17" />
  </Icon>
);

/** An icon per Spotify Connect device type. */
export const DeviceIcon = ({ kind, ...p }: P & { kind: string }) => {
  const k = kind.toUpperCase();
  if (k === "SMARTPHONE" || k === "TABLET") {
    return (
      <Icon {...p}>
        <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
        <path d="M11 17.5h2" />
      </Icon>
    );
  }
  if (k === "TV" || k === "STB" || k === "GAME_CONSOLE") {
    return (
      <Icon {...p}>
        <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" />
        <path d="M8 20.5h8M12 17v3.5" />
      </Icon>
    );
  }
  if (k === "COMPUTER") {
    return (
      <Icon {...p}>
        <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.6" />
        <path d="M2 19.5h20" />
      </Icon>
    );
  }
  return (
    <Icon {...p}>
      <rect x="5.5" y="3" width="13" height="18" rx="2.2" />
      <circle cx="12" cy="14" r="3.5" />
      <path d="M12 6.8v.01" />
    </Icon>
  );
};

export const QueueIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6.5h12M4 11.5h12M4 16.5h6.5" />
    <path d="M15 14.4v5.2l4.4-2.6z" />
  </Icon>
);

export const ChevronRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
  </Icon>
);

export const ChevronUpIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6.5 14.5 12 9l5.5 5.5" />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6.5 9.5 12 15l5.5-5.5" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const MicIcon = (p: P) => (
  <Icon {...p}>
    <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
    <path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v2.8" />
  </Icon>
);

/** A disc: an album (it was the Now playing button). */
export const NowPlayingIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.3" />
    <path d="M12 6.6a5.4 5.4 0 0 1 5.4 5.4" />
  </Icon>
);

export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h9m5 0h2M4 17h2m5 0h9" />
    <circle cx="15.5" cy="7" r="2.4" />
    <circle cx="8.5" cy="17" r="2.4" />
  </Icon>
);

export const PinIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 4.5h6l-.9 5.4 2.9 2.6V14H7v-1.5l2.9-2.6z" />
    <path d="M12 14v6" />
  </Icon>
);

export const EditIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 19.5h3.6L18.9 8.7a2.3 2.3 0 0 0-3.1-3.1L5 16.4z" />
    <path d="m14.2 7.3 2.5 2.5" />
  </Icon>
);

export const PlaylistAddIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6.5h12M4 11.5h12M4 16.5h6.5M17.5 13v7M14 16.5h7" />
  </Icon>
);

export const MoreIcon = (p: P) => (
  <Icon {...p}>
    <Dot cx={5.5} cy={12} r={1.6} />
    <Dot cx={12} cy={12} r={1.6} />
    <Dot cx={18.5} cy={12} r={1.6} />
  </Icon>
);

export const DiscIcon = NowPlayingIcon;

export const UserIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="8.4" r="3.8" />
    <path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6z" />
  </Icon>
);

/** Two people: the Jam. */
export const JamIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8.6" r="3.3" />
    <path d="M2.8 19.5c.8-3.2 3.2-5 6.2-5s5.4 1.8 6.2 5z" />
    <path d="M15.2 5.6a3.3 3.3 0 0 1 0 6.1M17.6 14.8c1.8.6 3 2.2 3.6 4.7h-2.6" />
  </Icon>
);

export const PodcastIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="10.4" r="2.4" />
    <path d="M8.3 14.4a5.3 5.3 0 1 1 7.4 0M5.7 17.2a8.9 8.9 0 1 1 12.6 0M12 14v6.5" />
  </Icon>
);

export const FolderIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 7.4a1.9 1.9 0 0 1 1.9-1.9h3.7l2 2h7.5a1.9 1.9 0 0 1 1.9 1.9v8.2a1.9 1.9 0 0 1-1.9 1.9H5.4a1.9 1.9 0 0 1-1.9-1.9z" />
  </Icon>
);

export const PlaylistIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6.5h11M4 11.5h11M4 16.5h6" />
    <circle cx="16.5" cy="17.5" r="2.1" />
    <path d="M18.6 17.5V9l2.4-.8" />
  </Icon>
);

export const GridIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4" width="6.8" height="6.8" rx="1.8" />
    <rect x="13.2" y="4" width="6.8" height="6.8" rx="1.8" />
    <rect x="4" y="13.2" width="6.8" height="6.8" rx="1.8" />
    <rect x="13.2" y="13.2" width="6.8" height="6.8" rx="1.8" />
  </Icon>
);

export const ListIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <Dot cx={4.6} cy={6.5} r={1.2} />
    <Dot cx={4.6} cy={12} r={1.2} />
    <Dot cx={4.6} cy={17.5} r={1.2} />
  </Icon>
);

export const CompactIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 5.5h16M4 9.8h16M4 14.2h16M4 18.5h16" />
  </Icon>
);

export const SortIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7.5 4.5v15M11 16l-3.5 3.5L4 16M16.5 19.5v-15M20 8l-3.5-3.5L13 8" />
  </Icon>
);

export const GroupIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4.5 6.5h15M7 12h10M9.5 17.5h5" />
  </Icon>
);

export const MiniPlayerIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.6" />
    <rect x="12" y="11.3" width="6" height="5" rx="1.3" />
  </Icon>
);

/** Not in the Figma set: the cinema mode and the keyboard (avatar menu). */
export const ExpandIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6" />
  </Icon>
);

export const KeyboardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2.2" />
    <path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8" />
  </Icon>
);

export const LogOutIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4M6 12h9.5" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="m6.5 6.5 11 11m0-11-11 11" />
  </Icon>
);
