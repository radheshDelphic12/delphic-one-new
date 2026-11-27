import { useEffect, useState } from 'react';
import { useAuth } from './authContext.jsx';

/**
 * useState that survives a page refresh: the value is kept in this browser (localStorage), per person and per company, under `name`.
 * Used for report filters, so a refresh (or coming back later) shows the same report with the same filters.
 * Falls back to plain state when the browser does not allow storage (a private window).
 */
export default function useSavedState(name, initial) {
  const { user } = useAuth();
  const key = `saved.${user?.id || 'anon'}.${user?.org_id || 'none'}.${name}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw);
    } catch { /* no storage: start from the default */ }
    return typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* no storage */ }
  }, [key, value]);
  return [value, setValue];
}
