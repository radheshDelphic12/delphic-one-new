import { useEffect, useState } from 'react';
import { useAuth } from '../authContext.jsx';
import { doxApi } from './api.js';

// The role + capabilities come from the server (GET /delphic-one/me), cached per user + company so the sidebar and every page share one request.
const cache = new Map();

export function isDelphicOneOrg(user) {
  return Boolean(user?.active_org?.enabled_modules?.includes('delphic_one'));
}

export function doxCan(me, cap) {
  return Boolean(me?.caps?.includes(cap));
}

export function useDelphicOne() {
  const { user } = useAuth();
  const enabled = isDelphicOneOrg(user);
  const key = enabled ? `${user.id}:${user.active_org.id}` : null;
  const [state, setState] = useState(() => ({ key, me: key ? cache.get(key) || null : null, error: null }));

  useEffect(() => {
    if (!key) return undefined;
    if (cache.has(key)) { setState({ key, me: cache.get(key), error: null }); return undefined; }
    let live = true;
    doxApi.me().then((me) => { cache.set(key, me); if (live) setState({ key, me, error: null }); }, (error) => { if (live) setState({ key, me: null, error }); });
    return () => { live = false; };
  }, [key]);

  const current = state.key === key ? state : { key, me: null, error: null };
  return { enabled, me: current.me, error: current.error, loading: enabled && !current.me && !current.error };
}
