const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// The Valterra Resources role model. Org-membership `admin` is a Valterra admin; everyone else takes the access_role of
// their linked VtPerson (manager | finance | staff | contractor). The global UserRole enum is never touched.
const ALL = [
  'dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'financials', 'closeMonth',
  'reports', 'export', 'payroll', 'people', 'users', 'categories', 'settings', 'audit', 'delete', 'override', 'sites', 'sitesEdit',
];
const CAPS = {
  admin: ALL,
  // Manager: sees the books and records entries and investments; payroll, locking and overrides stay with finance / admin.
  manager: ['dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'reports', 'export', 'people', 'categories', 'sites', 'sitesEdit'],
  // Finance: all money, payroll, projections and month locking.
  finance: ['dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'financials', 'closeMonth', 'reports', 'export', 'payroll', 'sites'],
  staff: ['dashboard', 'investments', 'entries', 'projections', 'reports', 'sites'],
  contractor: [],
};

const capsFor = (role) => CAPS[role] || [];

async function resolveVtRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null };
  const person = await prisma.vtPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true },
  });
  if (!person || !CAPS[person.access_role]) return { role: null, person_id: person?.id || null };
  return { role: person.access_role, person_id: person.id };
}

async function vtAccess(req, res, next) {
  try {
    const { role, person_id } = await resolveVtRole(req.user);
    if (!role) return fail(res, 403, 'No Valterra access for this account');
    req.vt = { role, person_id, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function vtAuthorize(...caps) {
  return (req, res, next) => (caps.some((c) => req.vt?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Valterra role'));
}

module.exports = { CAPS, capsFor, resolveVtRole, vtAccess, vtAuthorize };
