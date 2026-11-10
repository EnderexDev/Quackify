import { useEffect, useRef, useState } from "react";
import { onRefreshed, readsOf } from "../api/spotify";

/** A load that fails is tried again this many times on its own before the page shows the error. */
export const AUTO_RETRIES = 2;
/** The wait before each automatic try: 1 s, then 2 s. */
const RETRY_MS = 1000;

/**
 * Runs `load` when `key` changes; a result for an older key is ignored. A failure is tried again
 * on its own (AUTO_RETRIES times) before it shows; `retry` starts over from the page's button.
 * When a read it showed from the copy kept on disk is replaced by Spotify's answer, it runs
 * again in place, keeping what it shows until the new data is in. With `refreshWithin`, only
 * that many ms after the data first shows; a later answer waits for the next mount.
 */
export function useAsync<T>(load: () => Promise<T>, key: string, opts?: { refreshWithin?: number }) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key });
  const [round, setRound] = useState(0);
  const [fresh, setFresh] = useState(0);
  const reads = useRef<Set<string>>(new Set());
  // When the data of this key first showed; 0 while it has not.
  const shownAt = useRef(0);
  const within = opts?.refreshWithin ?? Infinity;
  useEffect(
    () =>
      onRefreshed((k) => {
        if (reads.current.has(k) && (!shownAt.current || performance.now() - shownAt.current <= within)) setFresh((n) => n + 1);
      }),
    [within],
  );
  const shownRound = useRef(round);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const retried = round !== shownRound.current;
    shownRound.current = round;
    // Another key, or Try again: start from loading. A refreshed read keeps what shows.
    setState((s) => (s.key === key && !retried ? s : { key }));
    if (state.key !== key || retried) shownAt.current = 0;
    const attempt = (n: number) => {
      const [loading, keys] = readsOf(load);
      reads.current = keys;
      return loading.then(
        (data) => {
          if (!alive) return;
          if (!shownAt.current) shownAt.current = performance.now();
          setState({ key, data });
        },
        (e) => {
          if (!alive) return;
          if (n < AUTO_RETRIES) timer = window.setTimeout(() => attempt(n + 1), RETRY_MS * (n + 1));
          else setState({ key, error: String(e) });
        },
      );
    };
    attempt(0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, round, fresh]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current || (state.data === undefined && state.error === undefined),
    retry: () => setRound((r) => r + 1),
  };
}
