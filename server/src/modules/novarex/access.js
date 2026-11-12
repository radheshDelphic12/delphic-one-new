const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// The Novarex Pharmaceuticals role model. Org-membership `admin` is a Novarex admin; everyone else takes the access_role of
// their linked NxPerson (manager | finance | staff | contractor). The global UserRole enum is never touched.
const OPS = ['products', 'productsEdit', 'stock', 'stockEdit', 'purchasing', 'purchasingEdit', 'sales', 'salesEdit', 'billing', 'billingEdit', 'logistics', 'logisticsEdit', 'franchise', 'franchiseEdit', 'opsReports'];
const ALL = [
  'dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'financials', 'closeMonth',
  'reports', 'export', 'payroll', 'people', 'users', 'categories', 'settings', 'audit', 'delete', 'override', 'outlets', 'outletsEdit', ...OPS,
];
// Roles that only ever see their own outlet(s) (NxPerson.outlet_ids); everything else sees the whole company.
const OUTLET_SCOPED = ['outlet_manager', 'franchise_partner'];
const CAPS = {
  admin: ALL,
  // Manager: sees the books and records entries and investments; payroll, locking and overrides stay with finance / admin.
  manager: ['dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'reports', 'export', 'people', 'categories', 'outlets', 'outletsEdit', ...OPS],
  // Finance: all money, payroll, projections and month locking.
  finance: ['dashboard', 'investments', 'investmentsEdit', 'entries', 'entriesEdit', 'projections', 'projectionsEdit', 'financials', 'closeMonth', 'reports', 'export', 'payroll', 'outlets', 'products', 'stock', 'purchasing', 'sales', 'billing', 'billingEdit', 'logistics', 'franchise', 'franchiseEdit', 'opsReports'],
  staff: ['dashboard', 'investments', 'entries', 'projections', 'reports', 'outlets', 'products', 'stock', 'sales', 'opsReports'],
  contractor: [],
  procurement: ['outlets', 'products', 'productsEdit', 'stock', 'purchasing', 'purchasingEdit', 'opsReports', 'export'],
  warehouse: ['outlets', 'products', 'stock', 'stockEdit', 'purchasing', 'sales', 'logistics', 'opsReports'],
  sales: ['outlets', 'products', 'stock', 'sales', 'salesEdit', 'billing', 'opsReports', 'export'],
  logistics: ['outlets', 'stock', 'sales', 'logistics', 'logisticsEdit', 'opsReports'],
  hr: ['people', 'payroll', 'entries', 'outlets'],
  outlet_manager: ['outlets', 'products', 'stock', 'sales', 'salesEdit', 'billing', 'logistics', 'opsReports'],
  franchise_partner: ['outlets', 'products', 'sales', 'billing', 'franchise', 'opsReports'],
};

const capsFor = (role) => CAPS[role] || [];

async function resolveNxRole(user) {
  if (user.role === 'admin') return { role: 'admin', person_id: null, outlet_ids: null };
  const person = await prisma.nxPerson.findFirst({
    where: { org_id: user.org_id, user_id: user.id, deleted_at: null, active: true },
    select: { id: true, access_role: true, outlet_ids: true },
  });
  if (!person || !CAPS[person.access_role]) return { role: null, person_id: person?.id || null, outlet_ids: null };
  return { role: person.access_role, person_id: person.id, outlet_ids: OUTLET_SCOPED.includes(person.access_role) ? person.outlet_ids || [] : null };
}

async function nxAccess(req, res, next) {
  try {
    const { role, person_id, outlet_ids } = await resolveNxRole(req.user);
    if (!role) return fail(res, 403, 'No Novarex access for this account');
    req.nx = { role, person_id, outlet_ids, caps: capsFor(role) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function nxAuthorize(...caps) {
  return (req, res, next) => (caps.some((c) => req.nx?.caps.includes(c)) ? next() : fail(res, 403, 'Insufficient Novarex role'));
}

module.exports = { OUTLET_SCOPED, CAPS, capsFor, resolveNxRole, nxAccess, nxAuthorize };
