import { useEffect, useRef, useState, type ReactNode } from "react";

/** A centered modal. Escape or a click outside closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="muted">{message}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
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
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);

  const save = async () => {
    if (!n.trim()) return;
    setBusy(true);
    try {
      await onSave(n.trim(), d.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Edit details" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input ref={input} value={n} maxLength={100} onChange={(e) => setN(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea value={d} maxLength={300} rows={4} placeholder="Add an optional description" onChange={(e) => setD(e.currentTarget.value)} />
      </label>
      <div className="dialog-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary" onClick={save} disabled={busy || !n.trim()}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
