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
