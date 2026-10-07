const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// Gulati's own role model. Org-membership `admin` is a Gulati admin; everyone else takes the
// access_role of their linked GxPerson (manager | staff | finance | contractor). The global
// UserRole enum is never touched.
const ALL = [
  'dashboard', 'leads', 'parties', 'deals', 'dealsEdit', 'ledger', 'payments', 'overview', 'valuation', 'financials', 'closeMonth',
  'people', 'tasks', 'tasksAll', 'myWork', 'settings', 'users', 'audit', 'delete', 'override',
];
const CAPS = {
  admin: ALL,
  manager: ['dashboard', 'leads', 'parties', 'deals', 'dealsEdit', 'ledger', 'payments', 'overview', 'people', 'tasks', 'tasksAll', 'myWork'],
  // Finance: deal money, payments, P&L and month locking; no leads, people or settings.
  finance: ['dashboard', 'parties', 'deals', 'ledger', 'payments', 'overview', 'financials', 'closeMonth', 'tasks', 'myWork'],
  staff: ['myWork', 'tasks'],
  contractor: ['myWork', 'tasks'],
};

const capsFor = (role) => CAPS[role] || [];

async function resolveGxRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null };
  const person = await prisma.gxPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true },
  });
  if (!person || !CAPS[person.access_role]) return { role: null, person_id: person?.id || null };
  return { role: person.access_role, person_id: person.id };
}

async function gxAccess(req, res, next) {
  try {
    const { role, person_id } = await resolveGxRole(req.user);
    if (!role) return fail(res, 403, 'No Gulati access for this account');
    req.gx = { role, person_id, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function gxAuthorize(...caps) {
  return (req, res, next) => (caps.some((c) => req.gx?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Gulati role'));
}

module.exports = { CAPS, capsFor, resolveGxRole, gxAccess, gxAuthorize };
