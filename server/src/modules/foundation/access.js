const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// The Foundation's own role model. Org-membership `admin` is a Foundation admin; everyone else takes the access_role of
// their linked FxPerson (manager | finance | staff | contractor). The global UserRole enum is never touched.
const ALL = [
  'dashboard', 'campaigns', 'campaignsEdit', 'budget', 'plan', 'entries', 'entriesEdit', 'entriesApprove', 'overview', 'financials', 'closeMonth',
  'reports', 'people', 'users', 'categories', 'settings', 'audit', 'delete', 'override',
];
const CAPS = {
  admin: ALL,
  // Manager: runs campaigns and records spending (approval and payment stay with finance), sees the dashboards and reports.
  manager: ['dashboard', 'campaigns', 'campaignsEdit', 'budget', 'plan', 'entries', 'overview', 'reports', 'people', 'categories'],
  // Finance: money in and out, approvals, financials and month locking.
  finance: ['dashboard', 'campaigns', 'entries', 'entriesEdit', 'entriesApprove', 'overview', 'financials', 'closeMonth', 'reports'],
  staff: ['campaigns', 'entries'],
  contractor: ['campaigns'],
};

const capsFor = (role) => CAPS[role] || [];

async function resolveFxRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null };
  const person = await prisma.fxPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true },
  });
  if (!person || !CAPS[person.access_role]) return { role: null, person_id: person?.id || null };
  return { role: person.access_role, person_id: person.id };
}

async function fxAccess(req, res, next) {
  try {
    const { role, person_id } = await resolveFxRole(req.user);
    if (!role) return fail(res, 403, 'No Foundation access for this account');
    req.fx = { role, person_id, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function fxAuthorize(...caps) {
  return (req, res, next) => (caps.some((c) => req.fx?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Foundation role'));
}

module.exports = { CAPS, capsFor, resolveFxRole, fxAccess, fxAuthorize };
