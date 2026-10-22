import { useState } from "react";
import { t } from "../i18n";
import { useSaved } from "../state/saved";
import { HeartIcon, HeartOutlineIcon } from "./icons";

/** The heart: saves a song to Liked Songs (or an album, playlist or artist to the library).
 * Liking makes it pop and throw six sparks (motion.css). */
export function LikeButton({ uri, size = 18, className = "" }: { uri: string; size?: number; className?: string }) {
  const [saved, toggle] = useSaved(uri);
  // Bumped on each like: a new key replays the pop and the sparks.
  const [burst, setBurst] = useState(0);
  return (
    <button
      className={`like-btn ${saved ? "on" : ""} ${burst && saved ? "pop" : ""} ${className}`}
      aria-label={saved ? t("Remove from Liked Songs") : t("Save to Liked Songs")}
      title={saved ? t("Remove from Liked Songs") : t("Save to Liked Songs")}
      disabled={saved === undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!saved) setBurst((n) => n + 1);
        toggle();
      }}
    >
      {saved ? <HeartIcon key={burst} size={size} /> : <HeartOutlineIcon size={size} />}
      {burst > 0 && saved && (
        <span className="like-burst" key={burst} aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
    </button>
  );
}

/** "Save" / "Saved" for albums and playlists, "Follow" / "Following" for artists. */
export function SaveButton({ uri, kind }: { uri: string; kind: "album" | "playlist" | "artist" | "show" }) {
  const [saved, toggle] = useSaved(uri);
  const follows = kind === "artist" || kind === "show";
  const label = follows ? (saved ? t("Following") : t("Follow")) : saved ? t("Saved") : t("Save");
  // Albums and playlists save with a heart, white (yellow stays for liked songs).
  if (!follows) {
    const name = saved ? t("Remove from Your Library") : t("Save to Your Library");
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
