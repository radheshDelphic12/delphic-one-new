const prisma = require('../config/db');

// Ending a person's sessions after an admin password reset. Tokens are stateless, so instead of storing every token we store ONE moment per person
// (users.sessions_valid_after): a token issued before it is refused. Only people who had a reset have a value, so this is an empty, cached lookup for
// everyone else and changes nothing for them.
const TTL_MS = 10000;
let map = new Map();
let loadedAt = 0;

const clearCache = () => { loadedAt = 0; };

async function load() {
  if (Date.now() - loadedAt < TTL_MS) return map;
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT id::text AS id, sessions_valid_after FROM users WHERE sessions_valid_after IS NOT NULL');
    map = new Map(rows.map((r) => [r.id, new Date(r.sessions_valid_after).getTime()]));
  } catch (_err) {
    map = new Map(); // never block sign-in because of this check
  }
  loadedAt = Date.now();
  return map;
}

// iat is the token's issue time in seconds. A token issued in the same second as the reset or later is accepted (so the new sign-in works at once).
async function isRevoked(userId, iat) {
  if (!userId || !iat) return false;
  const at = (await load()).get(String(userId));
  return at !== undefined && iat * 1000 < at;
}

// the moment to store: now, floored to the second, to line up with token issue times
const cutoffNow = () => new Date(Math.floor(Date.now() / 1000) * 1000);

module.exports = { isRevoked, clearCache, cutoffNow };
