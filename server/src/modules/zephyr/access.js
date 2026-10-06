const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// Zephyr's own role model. Org-membership `admin` is a Zephyr admin; everyone
// else takes the access_role of their linked ZxPerson (manager | staff | finance). The
// global UserRole enum is never touched.
const CAPS = {
  admin: [
    'leads', 'parties', 'projects', 'projectsEdit', 'people', 'peoplePay', 'salaries', 'ledger', 'ledgerSalaries',
    'overview', 'overviewValuation', 'financials', 'settings', 'audit', 'delete', 'myWork',
    'properties', 'propertiesEdit', 'propertyFinance', 'rent', 'rentEdit', 'trading', 'tasks', 'tasksAll',
  ],
  manager: ['leads', 'parties', 'projects', 'projectsEdit', 'people', 'ledger', 'overview', 'myWork', 'properties', 'propertiesEdit', 'rent', 'rentEdit', 'tasks', 'tasksAll'],
  staff: ['myWork', 'tasks'],
  // Finance: money, rent and property finance, but no people pay, leads, settings or month closing.
  finance: ['parties', 'ledger', 'ledgerSalaries', 'overview', 'properties', 'propertyFinance', 'rent', 'rentEdit', 'myWork', 'tasks'],
};

function capsFor(role) {
  return CAPS[role] || [];
}

async function resolveZxRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null };
  const person = await prisma.zxPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true },
  });
  if (!person || !['manager', 'staff', 'finance'].includes(person.access_role)) return { role: null, person_id: person?.id || null };
  return { role: person.access_role, person_id: person.id };
}

// Resolves req.zx = { role, person_id, caps }. A caller with no Zephyr role is refused.
async function zxAccess(req, res, next) {
  try {
    const { role, person_id } = await resolveZxRole(req.user);
    if (!role) return fail(res, 403, 'No Zephyr access for this account');
    req.zx = { role, person_id, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function zxAuthorize(cap) {
  return (req, res, next) => {
    if (!req.zx?.caps.includes(cap)) return fail(res, 403, 'Insufficient Zephyr role');
    return next();
  };
}

module.exports = { CAPS, capsFor, resolveZxRole, zxAccess, zxAuthorize };
