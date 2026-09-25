import { useEffect, useState } from 'react';

const THEME_KEY = 'delphic_auth_theme';
const ORDER = ['system', 'light', 'dark'];

function readPreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return ORDER.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Light / dark / system preference for the sign-in screen only. Returns the
 * stored preference, whether dark is currently in effect, and a `cycle()` that
 * steps system -> light -> dark. The class is applied by the caller
 * (`.auth-dark`, see tailwind.config.js) so nothing outside sign-in is affected.
 */
export function useAuthTheme() {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
    setPreference(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Theme preference is a convenience; ignore blocked storage.
    }
  }

  return { preference, dark: preference === 'dark' || (preference === 'system' && systemDark), cycle };
}
