// The states every page shares: loading (a skeleton the size of a page, so nothing jumps when
// it arrives), failed (after the automatic tries, with Try again and Copy details) and empty
// (the duck, a line and up to two ways out).
import type { ReactNode } from "react";
import { DuckIcon } from "../components/icons";
import { notify, toast } from "../state/toast";
import { t } from "../i18n";
import { AUTO_RETRIES } from "../util/useAsync";

/** A page loading: a title, a row of shortcuts and a row of cards, shimmering every 1.2 s. */
export function Loading() {
  return (
    <div className="page skeleton" aria-busy="true" aria-label={t("Loading")}>
      <div className="sk sk-title" />
      <div className="sk-row">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="sk sk-tile" />
        ))}
      </div>
      <div className="sk sk-label" />
      <div className="sk-row">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="sk-card">
            <div className="sk sk-cover" />
            <div className="sk sk-line" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** `retried`: how many times the load was already tried again on its own (useAsync's). */
export function Failed({ error, onRetry, retried = AUTO_RETRIES }: { error: string; onRetry?: () => void; retried?: number }) {
  const detail = error.replace(/^Error: /, "");
  return (
    <div className="page center state">
      <span className="state-icon danger" aria-hidden>
        !
      </span>
      <h3>{t("Couldn't load this page")}</h3>
      <p className="muted">
        {t("Spotify didn't answer.")}
        {retried > 0 ? ` ${t("Tried {n} more times already.", { n: retried })}` : ""}
      </p>
      <div className="state-actions">
        {onRetry && (
          <button className="pill-btn white" onClick={onRetry}>
            {t("Try again")}
          </button>
        )}
        <button
          className="pill-btn"
          onClick={() => navigator.clipboard.writeText(detail).then(() => notify(t("Details copied"), { kind: "info" }), toast)}
        >
          {t("Copy details")}
        </button>
      </div>
    </div>
  );
}

/** Nothing here: the duck on a stack of cards (or `icon`), a title, a line and up to two actions. */
export function Empty({
  title,
  text,
  icon,
  children,
  className = "",
}: {
  title: string;
  text?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`state empty-state ${className}`}>
      {icon ? (
        <span className="state-icon plain" aria-hidden>
          {icon}
        </span>
      ) : (
        <span className="state-duck" aria-hidden>
          <span />
          <span>
            <DuckIcon size={34} />
          </span>
        </span>
      )}
      <h3>{title}</h3>
      {text && <p className="muted">{text}</p>}
      {children && <div className="state-actions">{children}</div>}
    </div>
  );
}
