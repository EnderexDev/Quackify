// One-line notices at the bottom of the window. `toast()` can be called from anywhere.
import { useEffect, useState } from "react";

type Toast = { id: number; text: string };
const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

export function toast(message: unknown) {
  const text = String(message).replace(/^Error: /, "");
  const t = { id: nextId++, text };
  listeners.forEach((l) => l(t));
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((xs) => [...xs.filter((x) => x.text !== t.text), t].slice(-3));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 5000);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className="toast" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
