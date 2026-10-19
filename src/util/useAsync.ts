import { useEffect, useState } from "react";

/** Runs `load` when `key` changes; a result for an older key is ignored. */
export function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key });

  useEffect(() => {
    let alive = true;
    setState((s) => (s.key === key ? s : { key }));
    load().then(
      (data) => alive && setState({ key, data }),
      (e) => alive && setState({ key, error: String(e) }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current || (state.data === undefined && state.error === undefined),
  };
}
