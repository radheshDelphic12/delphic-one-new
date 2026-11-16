const prisma = require('../../config/db');
const switches = require('./switches.service');
const entitlements = require('./entitlements.service');

// The module-access check that runs inside authenticate() for every signed-in request (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, section 10 mapping).
//
// It does nothing, and costs nothing beyond a cached read of one switch, unless the "Module access checks" switch is ON. When ON it still lets every
// request through unless ALL of these hold: the person's company is a SaaS customer, the path belongs to a module in saas_route_modules, and the
// person's slot has no usable days for that module. Companies that are not customers (our own group and everything that existed before) are never blocked.

const TTL_MS = 30000;
let table = null;
let loadedAt = 0;
let deleted = new Set();
let deletedAt = 0;
const clearCache = () => { table = null; loadedAt = 0; deletedAt = 0; };

// Companies of soft-deleted customers. A signed-in session of one of their users is refused at once (the users are also deactivated, which stops sign-in and
// refresh; this stops the access token that is still valid). Empty today, so it costs one cached read and changes nothing for anyone else.
async function isDeletedOrg(orgId) {
  if (!orgId) return false;
  if (Date.now() - deletedAt > TTL_MS) {
    try {
      const rows = await prisma.$queryRawUnsafe("SELECT org_id::text AS org_id FROM saas_customers WHERE status = 'deleted'");
      deleted = new Set(rows.map((r) => r.org_id));
    } catch (_err) { deleted = new Set(); }
    deletedAt = Date.now();
  }
  return deleted.has(orgId);
}

async function rules() {
  if (table && Date.now() - loadedAt < TTL_MS) return table;
  const rows = await prisma.saasRouteModule.findMany({ where: { active: true } });
  table = rows.sort((a, b) => b.path_prefix.length - a.path_prefix.length); // longest prefix first
  loadedAt = Date.now();
  return table;
}

const apiPath = (url) => String(url || '').split('?')[0].replace(/^\/api\/v1/, '');
const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

// The module code a request path belongs to, or null when the path is not gated.
async function moduleFor(url) {
  const path = apiPath(url);
  const hit = (await rules()).find((r) => under(path, r.path_prefix));
  return hit ? hit.module_code : null;
}

// Returns a message when the request must be refused, otherwise null. Never throws: a failure of the check lets the request through.
async function check(req, user) {
  try {
    if (!(await switches.isOn('enforce'))) return null;
    if (!user?.org_id) return null;
    const code = await moduleFor(req.originalUrl);
    if (!code) return null;
    const ent = await entitlements.entitlementsFor(user, user.org_id);
    if (!ent.applies) return null; // not a customer company: never gated
    if (ent.modules.includes(code)) return null;
    if (ent.read_only && req.method === 'GET') return null; // a read-only customer can still look
    return ent.read_only ? 'This account is read-only' : `The ${code} module is not active for your user`;
  } catch (err) {
    require('../../config/logger').error('saas_gate_failed', { err });
    return null;
  }
}

// Client menu paths to hide for this person: those whose module is not available. Empty when nothing is enforced for them.
async function lockedMenu(user) {
  if (!(await switches.isOn('enforce')) || !user?.org_id) return { applies: false, locked: [] };
  const ent = await entitlements.entitlementsFor(user, user.org_id);
  if (!ent.applies) return { applies: false, locked: [] };
  const rows = (await rules()).filter((r) => r.menu_prefix && !ent.modules.includes(r.module_code));
  return { applies: true, status: ent.status, modules: ent.modules, locked: [...new Set(rows.map((r) => r.menu_prefix))] };
}

module.exports = { check, moduleFor, lockedMenu, clearCache, rules, isDeletedOrg };
