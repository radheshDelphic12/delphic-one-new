const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// Acconcy's own role model. Org-membership `admin` is a Acconcy admin; everyone else takes the
// access_role of their linked AxPerson (manager | staff | finance | contractor). The global
// UserRole enum is never touched.
const ALL = [
  'dashboard', 'leads', 'parties', 'deals', 'dealsEdit', 'ledger', 'investments', 'overview', 'valuation', 'financials', 'closeMonth',
  'salaries', 'people', 'tasks', 'tasksAll', 'myWork', 'settings', 'users', 'audit', 'delete', 'override',
];
const CAPS = {
  admin: ALL,
  manager: ['dashboard', 'leads', 'parties', 'deals', 'dealsEdit', 'ledger', 'overview', 'people', 'tasks', 'tasksAll', 'myWork'],
  // Finance: money, investments, P&L, salaries, valuation and month locking; no leads, people or settings.
  finance: ['dashboard', 'parties', 'deals', 'ledger', 'investments', 'overview', 'valuation', 'financials', 'closeMonth', 'salaries', 'tasks', 'myWork'],
  staff: ['myWork', 'tasks'],
  contractor: ['myWork', 'tasks'],
};

const capsFor = (role) => CAPS[role] || [];

async function resolveAxRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null };
  const person = await prisma.axPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true },
  });
  if (!person || !CAPS[person.access_role]) return { role: null, person_id: person?.id || null };
  return { role: person.access_role, person_id: person.id };
}

async function axAccess(req, res, next) {
  try {
    const { role, person_id } = await resolveAxRole(req.user);
    if (!role) return fail(res, 403, 'No Acconcy access for this account');
    req.ax = { role, person_id, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function axAuthorize(...caps) {
  return (req, res, next) => (caps.some((c) => req.ax?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Acconcy role'));
}

module.exports = { CAPS, capsFor, resolveAxRole, axAccess, axAuthorize };
