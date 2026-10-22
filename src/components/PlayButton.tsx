import { t } from "../i18n";
import { PauseIcon, PlayIcon } from "./icons";

/** The round yellow play button. */
export function PlayButton({
  playing,
  onClick,
  size = 48,
  className = "",
}: {
  playing: boolean;
  onClick: () => void;
  size?: number;
  className?: string;
}) {
  return (
    <button
      className={`play-button ${className}`}
      style={{ width: size, height: size }}
      aria-label={playing ? t("Pause") : t("Play")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {playing ? <PauseIcon size={size * 0.42} /> : <PlayIcon size={size * 0.42} />}
    </button>
  );
}
