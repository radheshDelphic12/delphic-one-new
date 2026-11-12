const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// The Zklyrera Spirits role model. Org-membership `admin` is a Zklyrera admin; everyone else takes the access_role of
// their linked ZkPerson (manager | finance | staff | contractor). The global UserRole enum is never touched.
const ALL = [
  'dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'financials', 'closeMonth',
  'reports', 'export', 'payroll', 'people', 'users', 'categories', 'settings', 'audit', 'delete', 'override',
];
const CAPS = {
  admin: ALL,
  // Manager: sees the books and records entries and investments; payroll, locking and overrides stay with finance / admin.
  manager: ['dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'reports', 'export', 'people', 'categories'],
  // Finance: all money, payroll, projections and month locking.
  finance: ['dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'financials', 'closeMonth', 'reports', 'export', 'payroll'],
  staff: ['dashboard', 'investments', 'entries', 'projections', 'reports'],
  contractor: [],
};

const capsFor = (role) => CAPS[role] || [];

async function resolveZkRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null };
  const person = await prisma.zkPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true },
  });
  if (!person || !CAPS[person.access_role]) return { role: null, person_id: person?.id || null };
  return { role: person.access_role, person_id: person.id };
}

async function zkAccess(req, res, next) {
  try {
    const { role, person_id } = await resolveZkRole(req.user);
    if (!role) return fail(res, 403, 'No Zklyrera access for this account');
    req.zk = { role, person_id, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function zkAuthorize(...caps) {
  return (req, res, next) => (caps.some((c) => req.zk?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Zklyrera role'));
}

module.exports = { CAPS, capsFor, resolveZkRole, zkAccess, zkAuthorize };
