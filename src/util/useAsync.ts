import { useEffect, useState } from "react";

/** A load that fails is tried again this many times on its own before the page shows the error. */
export const AUTO_RETRIES = 2;
/** The wait before each automatic try: 1 s, then 2 s. */
const RETRY_MS = 1000;

/**
 * Runs `load` when `key` changes; a result for an older key is ignored. A failure is tried again
 * on its own (AUTO_RETRIES times) before it shows; `retry` starts over from the page's button.
 */
export function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    setState((s) => (s.key === key && round === 0 ? s : { key }));
    const attempt = (n: number) =>
      load().then(
        (data) => alive && setState({ key, data }),
        (e) => {
          if (!alive) return;
          if (n < AUTO_RETRIES) timer = window.setTimeout(() => attempt(n + 1), RETRY_MS * (n + 1));
          else setState({ key, error: String(e) });
        },
      );
    attempt(0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, round]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current || (state.data === undefined && state.error === undefined),
    retry: () => setRound((r) => r + 1),
  };
}
