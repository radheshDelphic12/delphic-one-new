// Super-admin check. The viewer holds no JWT secret and no app database access: it forwards the caller's Authorization header to
// the app's GET /api/v1/superadmin/whoami and lets the request through only on a 200. Answers are cached for 60 s per token.
const crypto = require('crypto');

function createAuth({ apiUrl, fetchImpl = fetch, ttlMs = 60000, now = Date.now, timeoutMs = 5000 }) {
  const cache = new Map(); // sha1(token) -> { until, status, user }

  function sweep() {
    const t = now();
    for (const [k, v] of cache) if (v.until <= t) cache.delete(k);
  }

  async function check(header) {
    if (!header || !/^Bearer\s+\S+/.test(header)) return { status: 401, message: 'Sign in to Delphic first, then reopen this page' };
    const key = crypto.createHash('sha1').update(header).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit;
    let result;
    try {
      const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/api/v1/superadmin/whoami`, {
        headers: { Authorization: header },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 200) {
        const body = await res.json();
        result = { status: 200, user: body.data };
      } else if (res.status === 401) {
        result = { status: 401, message: 'Your session has expired - open Delphic, then reload this page' };
      } else if (res.status === 403) {
        result = { status: 403, message: 'Super admin only' };
      } else {
        return { status: 502, message: `The app answered ${res.status}` }; // not cached
      }
    } catch {
      return { status: 502, message: 'Could not reach the app to check your login' }; // not cached
    }
    result.until = now() + ttlMs;
    cache.set(key, result);
    if (cache.size > 200) sweep();
    return result;
  }

  function middleware(req, res, next) {
    check(req.headers.authorization).then((r) => {
      if (r.status !== 200) return res.status(r.status).json({ error: r.message });
      req.user = r.user;
      return next();
    }, next);
  }

  return { check, middleware };
}

module.exports = { createAuth };
