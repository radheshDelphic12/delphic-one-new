const prisma = require('../../config/db');
const { fail } = require('../../utils/response');
const { dayStr } = require('./credits.service');

// Which modules a person may use (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, phase 2.4).
//
// SAFE BY DEFAULT: nothing below changes any behaviour unless SAAS_ENFORCE_ENTITLEMENTS=true, and even then it applies only to companies that are
// SaaS customers (a row in saas_customers). Our own companies, and every company that existed before the SaaS work, are never subject to it.

const enforcing = () => process.env.SAAS_ENFORCE_ENTITLEMENTS === 'true';

// Pure rule: a module is usable when it has credit days AND every requirement group of it has at least one usable module. Settled by repeating
// until nothing changes, so a prerequisite that ran out also pauses what depends on it.
function effectiveModules(allowed, deps) {
  const groups = new Map();
  for (const d of deps) {
    if (!groups.has(d.module_code)) groups.set(d.module_code, new Map());
    const g = groups.get(d.module_code);
    if (!g.has(d.requirement_group)) g.set(d.requirement_group, []);
    g.get(d.requirement_group).push(d.needs_code);
  }
  let current = new Set(allowed);
  for (;;) {
    const next = new Set([...current].filter((code) => [...(groups.get(code)?.values() || [])].every((alts) => alts.some((a) => current.has(a)))));
    if (next.size === current.size) return next;
    current = next;
  }
}

// { applies: false } for any company that is not a SaaS customer; otherwise the modules the person may use and why others are not available.
async function entitlementsFor(user, orgId, now = new Date()) {
  const customer = await prisma.saasCustomer.findUnique({ where: { org_id: orgId } });
  if (!customer) return { applies: false };
  const modules = await prisma.saasModule.findMany({ where: { active: true }, select: { code: true, coming_soon: true } });
  const all = modules.map((m) => m.code);
  const today = dayStr(now);
  if (customer.status === 'trial') {
    const end = customer.trial_ends_on ? customer.trial_ends_on.toISOString().slice(0, 10) : null;
    if (end && today > end) return { applies: true, status: 'trial_ended', modules: [], read_only: true };
    return { applies: true, status: 'trial', modules: all }; // a trial has every module for its days
  }
  if (customer.status !== 'active') return { applies: true, status: customer.status, modules: [], read_only: customer.status === 'read_only' };
  const email = (user.email || '').toLowerCase();
  const slot = await prisma.saasSlot.findFirst({ where: { customer_id: customer.id, status: 'active', OR: [{ user_id: user.id }, ...(email ? [{ email }] : [])] }, include: { credits: true } });
  if (!slot) return { applies: true, status: 'no_slot', modules: [] };
  const allowed = slot.credits.filter((c) => c.days_left > 0).map((c) => c.module_code);
  const deps = await prisma.saasModuleDependency.findMany();
  const effective = [...effectiveModules(allowed, deps)];
  return { applies: true, status: 'active', modules: effective, paused: allowed.filter((c) => !effective.includes(c)) };
}

// Route guard: no-op unless enforcing. `code` is the module code of the screen or API (draft mapping in the SaaS plan, section 10).
const requireModuleCode = (code) => async (req, res, next) => {
  try {
    if (!enforcing()) return next();
    const ent = await entitlementsFor(req.user, req.user.org_id);
    if (!ent.applies || ent.modules.includes(code)) return next();
    return fail(res, 403, ent.read_only ? 'This account is read-only' : `The ${code} module is not active for your user`);
  } catch (err) {
    return next(err);
  }
};

module.exports = { enforcing, effectiveModules, entitlementsFor, requireModuleCode };
