import { lazy } from 'react';

const RELOAD_FLAG = 'delphic:chunk-reload';

/**
 * React.lazy for route pages, hardened for deployments:
 *  - retries the import once (flaky network),
 *  - if the file is gone (a new build replaced the old hashed chunks) it reloads the tab ONCE
 *    so the user lands on the fresh build instead of an error screen. The guard flag stops reload loops.
 */
export function lazyPage(importer) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (firstError) {
      try {
        return await importer();
      } catch (error) {
        try {
          if (typeof window !== 'undefined' && !window.sessionStorage.getItem(RELOAD_FLAG)) {
            window.sessionStorage.setItem(RELOAD_FLAG, '1');
            window.location.reload();
            return new Promise(() => {}); // page is reloading; never resolve
          }
        } catch { /* storage unavailable: fall through to the error boundary */ }
        throw error || firstError;
      }
    }
  });
}

/** Call once the app has rendered fine, so a later deployment can reload again if needed. */
export function clearChunkReloadFlag() {
  try { window.sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
}
