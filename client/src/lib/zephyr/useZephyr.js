import { useEffect, useState } from 'react';
import { useAuth } from '../authContext.jsx';
import { zephyrApi } from './api.js';

// The Zephyr role + capabilities come from the server (GET /zephyr/me), cached
// per user + company so the sidebar and every page share one request.
const cache = new Map();
const inflight = new Map();

export function isZephyrOrg(user) {
  return Boolean(user?.active_org?.enabled_modules?.includes('zephyr'));
}

export function zxCan(me, cap) {
  return Boolean(me?.caps?.includes(cap));
}

export function useZephyr() {
  const { user } = useAuth();
  const enabled = isZephyrOrg(user);
  const key = enabled ? `${user.id}:${user.active_org.id}` : null;
  const [state, setState] = useState(() => ({ key, me: key ? cache.get(key) || null : null, error: null }));

  useEffect(() => {
    if (!key) return undefined;
    if (cache.has(key)) {
      setState({ key, me: cache.get(key), error: null });
      return undefined;
    }
    let live = true;
    if (!inflight.has(key)) {
      inflight.set(
        key,
        zephyrApi.me().then(
          (me) => {
            cache.set(key, me);
            inflight.delete(key);
            return me;
          },
          (error) => {
            inflight.delete(key);
            throw error;
          }
        )
      );
    }
    inflight.get(key).then(
      (me) => live && setState({ key, me, error: null }),
      (error) => live && setState({ key, me: null, error })
    );
    return () => {
      live = false;
    };
  }, [key]);

  const current = state.key === key ? state : { key, me: null, error: null };
  return { enabled, me: current.me, error: current.error, loading: enabled && !current.me && !current.error };
}
