import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch + optional polling. `fetcher` must be stable per `deps` (it is re-run when deps change).
 * Polling pauses while the tab is hidden and resumes with an immediate refresh on return,
 * so a dashboard left open in a background tab does not hammer the API.
 *
 * Returns { data, loading, error, refresh, updatedAt }.
 */
export default function useLiveData(fetcher, { intervalMs = 0, deps = [], enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const run = useCallback(async (silent) => {
    const mine = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (mine === seq.current) setState({ data, loading: false, error: null, updatedAt: new Date() });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    run(false);
    if (!intervalMs) return undefined;
    const tick = () => {
      if (!document.hidden) run(true);
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's explicit dependency list
  }, [enabled, intervalMs, run, ...deps]);

  return { ...state, refresh: () => run(true) };
}
