// Notices over the player, centered: up to three stacked, gone after 5 s or on a click, and
// the same text replaces the one already shown. `toast()` is for errors (what a `catch` hands
// over); `notify()` for what went right (success) or is just worth knowing (info). Either can
// carry one action: Open, Undo, Try again.
import { useEffect, useState } from "react";
import { CheckIcon } from "../components/icons";

export type ToastKind = "success" | "info" | "error";
export type ToastAction = { label: string; run: () => void };
type Toast = { id: number; text: string; kind: ToastKind; action?: ToastAction };

const SHOWN_MS = 5000;
const MAX = 3;
const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

const show = (text: string, kind: ToastKind, action?: ToastAction) => {
  const t = { id: nextId++, text, kind, action };
  listeners.forEach((l) => l(t));
};

/** An error, from anything a `catch` gets. */
export function toast(error: unknown, action?: ToastAction) {
  show(String(error).replace(/^Error: /, ""), "error", action);
}

/** Something that went right ("success", the default) or is just worth knowing ("info"). */
export function notify(text: string, opts: { kind?: Exclude<ToastKind, "error">; action?: ToastAction } = {}) {
  show(text, opts.kind ?? "success", opts.action);
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((xs) => [...xs.filter((x) => x.text !== t.text), t].slice(-MAX));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), SHOWN_MS);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => close(t.id)}>
          <span className="toast-icon" aria-hidden>
            {t.kind === "success" ? <CheckIcon size={14} /> : t.kind === "error" ? "!" : "i"}
          </span>
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation();
                close(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
