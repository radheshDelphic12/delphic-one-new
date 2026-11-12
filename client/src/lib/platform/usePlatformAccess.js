import { useEffect, useState } from 'react';
import apiClient from '../apiClient.js';
import { useAuth } from '../authContext.jsx';

// Is the signed-in person a platform administrator? Decides whether the Platform link shows in the menu. One request per person, remembered.
const known = new Map();

export function usePlatformAccess() {
  const { user } = useAuth();
  const id = user?.id || null;
  const [state, setState] = useState(() => ({ id, yes: id ? known.get(id) === true : false }));
  useEffect(() => {
    if (!id) return undefined;
    if (known.has(id)) { setState({ id, yes: known.get(id) }); return undefined; }
    let live = true;
    apiClient.get('/platform/access').then((r) => { const yes = r.data?.data?.platform_admin === true; known.set(id, yes); if (live) setState({ id, yes }); }, () => { if (live) setState({ id, yes: false }); });
    return () => { live = false; };
  }, [id]);
  return state.id === id ? state.yes : false;
}

// Menu paths this person cannot use because their customer plan has no days on the module (SaaS module access). Empty for everyone else, which is
// every company that is not a customer and every request while the "Module access checks" switch is off: the server decides, the menu only follows.
const lockedByKey = new Map();

export function useLockedMenu() {
  const { user } = useAuth();
  const key = user?.id && user?.active_org?.id ? `${user.id}:${user.active_org.id}` : null;
  const [state, setState] = useState(() => ({ key, locked: key ? lockedByKey.get(key) || [] : [] }));
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    apiClient.get('/platform/my-modules').then((r) => { const locked = r.data?.data?.locked || []; lockedByKey.set(key, locked); if (live) setState({ key, locked }); }, () => {});
    return () => { live = false; };
  }, [key]);
  return state.key === key ? state.locked : [];
}
