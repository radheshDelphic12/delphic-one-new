// Per-tab login session. The tokens live in sessionStorage so each browser tab keeps its own company: a super admin can have
// Delphic in one tab and Gulati in another without one tab's company switch or token refresh logging the other out.
// localStorage keeps a shared copy of the latest session only to start a new tab (and to sign every tab out together).
const KEYS = ['access_token', 'refresh_token', 'active_org_id'];

function tabStore() {
  try {
    return window.sessionStorage;
  } catch {
    return window.localStorage;
  }
}

function seedStore() {
  return window.localStorage;
}

// A tab with no session of its own starts from the shared copy (a new tab, or a browser restart).
function adoptSeed() {
  const tab = tabStore();
  if (tab.getItem('access_token')) return;
  for (const key of KEYS) {
    const value = seedStore().getItem(key);
    if (value) tab.setItem(key, value);
  }
}

export function getSessionItem(key) {
  adoptSeed();
  return tabStore().getItem(key);
}

export function setSessionItem(key, value) {
  tabStore().setItem(key, value);
  seedStore().setItem(key, value);
}

export function clearSession() {
  for (const key of KEYS) {
    tabStore().removeItem(key);
    seedStore().removeItem(key);
  }
}

// Calls back when another tab signs out, so every tab ends together.
export function onSessionCleared(callback) {
  const handler = (event) => {
    if (event.storageArea === window.localStorage && event.key === 'access_token' && !event.newValue) callback();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
