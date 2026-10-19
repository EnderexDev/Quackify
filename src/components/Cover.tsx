import { useState } from "react";
import { HeartIcon, MusicIcon } from "./icons";

/** Cover art with a placeholder for a missing or broken image. */
export function Cover({
  src,
  round,
  liked,
  className = "",
}: {
  src: string | null;
  round?: boolean;
  liked?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const cls = `cover ${round ? "round" : ""} ${className}`;
  if (liked) {
    return (
      <div className={`${cls} cover-liked`}>
        <HeartIcon size={40} />
      </div>
    );
  }
  if (!src || broken) {
    return (
      <div className={`${cls} cover-empty`}>
        <MusicIcon size={36} />
      </div>
    );
  }
  return <img className={cls} src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />;
}
