import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A centered modal. Escape or a click outside closes it, unless `busy`. Keyboard focus moves
 * into it, Tab stays inside, and focus goes back where it was when it closes.
 */
export function Dialog({
  title,
  onClose,
  busy = false,
  className,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  /** Extra class on the card, for its width. */
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = () => !busy && onClose();
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!box.current?.contains(document.activeElement)) (first ?? box.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        e.preventDefault();
        // While busy every control is disabled: focus stays on the dialog itself.
        if (items.length === 0) return box.current.focus();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        items[next].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div ref={box} className={`dialog ${className ?? ""}`} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Runs `action` once at a time; a failure keeps the dialog open (the caller shows the error). */
function useSubmit(action: () => Promise<void> | void, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const submit = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let ok = false;
    try {
      await action();
      ok = true;
    } catch {
      // Already reported by the caller; stay open so the user can retry.
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (ok) onDone();
  };
  return { busy, submit };
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  /** The action deletes something: the button is red. */
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { busy, submit } = useSubmit(onConfirm, onClose);
  return (
    <Dialog title={title} onClose={onClose} busy={busy} className="confirm">
      <p className="muted">{message}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </button>
        <button className={`primary ${danger ? "danger" : ""}`} disabled={busy} onClick={submit}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

/** Edit a playlist's name and description. */
export function EditDetailsDialog({
  name,
  description,
  onSave,
  onClose,
}: {
  name: string;
  description: string;
  onSave: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [n, setN] = useState(name);
  const [d, setD] = useState(description);
  const input = useRef<HTMLInputElement>(null);
  const { busy, submit } = useSubmit(() => onSave(n.trim(), d.trim()), onClose);
  const save = () => n.trim() && submit();
  useEffect(() => input.current?.select(), []);

  return (
    <Dialog title={t("Edit details")} onClose={onClose} busy={busy}>
      <label className="field">
        <span>{t("Name")}</span>
        <input
          ref={input}
          value={n}
          maxLength={100}
          disabled={busy}
          onChange={(e) => setN(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>
      <label className="field">
        <span>{t("Description")}</span>
        <textarea
          value={d}
          maxLength={300}
          rows={2}
          disabled={busy}
          placeholder={t("Add an optional description")}
          onChange={(e) => setD(e.currentTarget.value)}
        />
      </label>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </button>
        <button className="primary" onClick={save} disabled={busy || !n.trim()}>
          {t("Save")}
        </button>
      </div>
    </Dialog>
  );
}
