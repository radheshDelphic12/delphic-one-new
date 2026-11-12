const prisma = require('../../config/db');

const SELECT = {
  id: true,
  serial_number: true,
  asset_type: true,
  status: true,
  belongs_to: true,
  org_membership_id: true,
  org_membership: { select: { id: true, employee_code: true, person: { select: { name: true } } } },
  vendor_account_id: true,
  vendor_account: { select: { id: true, name: true } },
  client_account_id: true,
  client_account: { select: { id: true, name: true } },
  used_by_ids: true,
  location_id: true,
  location: { select: { id: true, name: true } },
  issue_date: true,
  return_date: true,
  device_details: true,
  created_at: true,
  updated_at: true,
};

function ymd(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

// `people` maps a membership id to { id, name, employee_code } (the users of the listed assets, exited ones included).
function serialize(row, people = new Map()) {
  return {
    ...row,
    used_by: (row.used_by_ids || []).map((id) => people.get(id) || { id, name: 'Unknown', employee_code: null }),
    org_membership: row.org_membership
      ? { id: row.org_membership.id, name: row.org_membership.person?.name || null, employee_code: row.org_membership.employee_code }
      : null,
    issue_date: ymd(row.issue_date),
    return_date: ymd(row.return_date),
  };
}

// Every linked record must belong to this org: the employee, a vendor account
// as the supplier and a client account as the client.
async function checkLinks(orgId, { org_membership_id, vendor_account_id, client_account_id, location_id, used_by_ids }) {
  if (location_id) {
    const location = await prisma.location.findFirst({ where: { id: location_id, org_id: orgId }, select: { id: true } });
    if (!location) return 'location_not_found';
  }
  if (used_by_ids?.length) {
    const found = await prisma.orgMembership.count({ where: { id: { in: used_by_ids }, org_id: orgId } });
    if (found !== used_by_ids.length) return 'used_by_not_found';
  }
  if (org_membership_id) {
    const member = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } });
    if (!member) return 'employee_not_found';
  }
  if (vendor_account_id) {
    const vendor = await prisma.account.findFirst({ where: { id: vendor_account_id, org_id: orgId, type: 'vendor' }, select: { id: true } });
    if (!vendor) return 'vendor_not_found';
  }
  if (client_account_id) {
    const client = await prisma.account.findFirst({
      where: { id: client_account_id, org_id: orgId, OR: [{ type: 'client' }, { type: null }] },
      select: { id: true },
    });
    if (!client) return 'client_not_found';
  }
  return null;
}

// The people named in `used_by_ids` of these assets, by membership id.
async function peopleOf(orgId, rows) {
  const ids = [...new Set(rows.flatMap((r) => r.used_by_ids || []))];
  if (!ids.length) return new Map();
  const members = await prisma.orgMembership.findMany({ where: { id: { in: ids }, org_id: orgId }, select: { id: true, employee_code: true, person: { select: { name: true } } } });
  return new Map(members.map((m) => [m.id, { id: m.id, name: m.person?.name || null, employee_code: m.employee_code }]));
}

async function list(orgId, { status, location_id, used_by } = {}) {
  const rows = await prisma.asset.findMany({
    where: { org_id: orgId, ...(status ? { status } : {}), ...(location_id ? { location_id } : {}), ...(used_by ? { used_by_ids: { has: used_by } } : {}) },
    select: SELECT,
    orderBy: [{ issue_date: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
  });
  const people = await peopleOf(orgId, rows);
  return rows.map((r) => serialize(r, people));
}

// An asset that belongs to a vendor must say which vendor.
function vendorOwnerError({ belongs_to, vendor_account_id }) {
  return belongs_to === 'vendor' && !vendor_account_id ? 'vendor_required' : null;
}

async function create(orgId, body) {
  const error = vendorOwnerError(body) || (await checkLinks(orgId, body));
  if (error) return { error };
  const row = await prisma.asset.create({ data: { org_id: orgId, ...body }, select: SELECT });
  return { asset: serialize(row, await peopleOf(orgId, [row])) };
}

async function update(orgId, id, patch) {
  const existing = await prisma.asset.findFirst({ where: { id, org_id: orgId }, select: { id: true, belongs_to: true, vendor_account_id: true } });
  if (!existing) return { error: 'not_found' };
  const merged = {
    belongs_to: patch.belongs_to !== undefined ? patch.belongs_to : existing.belongs_to,
    vendor_account_id: patch.vendor_account_id !== undefined ? patch.vendor_account_id : existing.vendor_account_id,
  };
  const error = vendorOwnerError(merged) || (await checkLinks(orgId, patch));
  if (error) return { error };
  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const row = await prisma.asset.update({ where: { id }, data, select: SELECT });
  return { asset: serialize(row, await peopleOf(orgId, [row])) };
}

async function remove(orgId, id) {
  const existing = await prisma.asset.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!existing) return { error: 'not_found' };
  await prisma.asset.delete({ where: { id } });
  return {};
}

module.exports = { list, create, update, remove };
