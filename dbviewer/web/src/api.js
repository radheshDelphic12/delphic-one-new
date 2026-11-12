// The viewer is served from the app's own domain, so it reuses the app's login: the app keeps the access token in sessionStorage
// (per tab) and a shared copy in localStorage (client/src/lib/sessionStore.js). A new tab only has the shared copy.
function token() {
  try {
    return window.sessionStorage.getItem('access_token') || window.localStorage.getItem('access_token');
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function failure(res) {
  let message = `Request failed (${res.status})`;
  try {
    message = (await res.json()).error || message;
  } catch { /* not JSON */ }
  return new ApiError(res.status, message);
}

function headers(extra = {}) {
  const t = token();
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res);
  return res.json();
}

// Downloads need the Authorization header, so they are fetched as a blob and saved from memory.
export async function download(path, filename) {
  const res = await fetch(`api/${path}`, { headers: headers() });
  if (!res.ok) throw await failure(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== null && v !== false) p.set(k, v === true ? '1' : v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
