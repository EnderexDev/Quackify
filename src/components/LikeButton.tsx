import { useSaved } from "../state/saved";
import { HeartIcon, HeartOutlineIcon } from "./icons";

/** The heart: saves a song to Liked Songs (or an album, playlist or artist to the library). */
export function LikeButton({ uri, size = 18, className = "" }: { uri: string; size?: number; className?: string }) {
  const [saved, toggle] = useSaved(uri);
  return (
    <button
      className={`like-btn ${saved ? "on" : ""} ${className}`}
      aria-label={saved ? "Remove from Liked Songs" : "Save to Liked Songs"}
      title={saved ? "Remove from Liked Songs" : "Save to Liked Songs"}
      disabled={saved === undefined}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
    >
      {saved ? <HeartIcon size={size} /> : <HeartOutlineIcon size={size} />}
    </button>
  );
}

/** "Save" / "Saved" for albums and playlists, "Follow" / "Following" for artists. */
export function SaveButton({ uri, kind }: { uri: string; kind: "album" | "playlist" | "artist" | "show" }) {
  const [saved, toggle] = useSaved(uri);
  const follows = kind === "artist" || kind === "show";
  const label = follows ? (saved ? "Following" : "Follow") : saved ? "Saved" : "Save";
  // Albums and playlists save with a heart, white (yellow stays for liked songs).
  if (!follows) {
    const name = saved ? "Remove from Your Library" : "Save to Your Library";
    return (
      <button className={`icon-btn big save-heart ${saved ? "on" : ""}`} disabled={saved === undefined} onClick={toggle} aria-label={name} title={name}>
        {saved ? <HeartIcon size={24} /> : <HeartOutlineIcon size={24} />}
      </button>
    );
  }
  return (
    <button className={`save-btn ${saved ? "on" : ""}`} disabled={saved === undefined} onClick={toggle}>
      {label}
    </button>
  );
}
