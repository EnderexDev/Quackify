import { useState } from "react";
import type { Kind } from "../api/types";
import { FolderIcon, HeartIcon, MusicIcon } from "./icons";

/** The kinds whose shape reaches outside the square: a playlist's tab, an album's disc, a podcast's dot, a folder's stack. */
const SHAPED = new Set<Kind>(["playlist", "album", "show", "folder"]);

/**
 * Cover art with a placeholder for a missing or broken image. `kind` gives the shape: round for
 * an artist or a profile, rounder corners for a podcast, the gradient for Liked Songs, a folder
 * icon for a folder. `shaped` adds what reaches outside the square, for covers big enough to
 * show it (cards and page headers); then `className` sizes the wrapper.
 */
export function Cover({
  src,
  kind,
  shaped,
  className = "",
}: {
  src: string | null;
  kind?: Kind;
  shaped?: boolean;
  className?: string;
}) {
  // The URL that failed, not a flag: a cover reused for the next song shows the new image.
  const [failed, setFailed] = useState<string | null>(null);
  const broken = !!src && src === failed;
  const wrap = shaped && kind && SHAPED.has(kind);
  const round = kind === "artist" || kind === "user";
  const cls = `cover ${round ? "round" : ""} ${kind === "show" ? "shape-show" : ""} ${wrap ? "" : className}`;

  let art;
  if (kind === "liked") {
    art = (
      <div className={`${cls} cover-liked`}>
        <HeartIcon size={40} />
      </div>
    );
  } else if (kind === "folder" && (!src || broken)) {
    art = (
      <div className={`${cls} cover-folder`}>
        <FolderIcon size={40} />
      </div>
    );
  } else if (!src || broken) {
    art = (
      <div className={`${cls} cover-empty`}>
        <MusicIcon size={36} />
      </div>
    );
  } else {
    art = <img className={cls} src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(src)} />;
  }
  if (!wrap) return art;
  return (
    <div className={`cover-shaped shape-${kind} ${className}`}>
      <span className="cover-deco" />
      {art}
    </div>
  );
}
