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
  issue_date: true,
  return_date: true,
  device_details: true,
  created_at: true,
  updated_at: true,
};

function ymd(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function serialize(row) {
  return {
    ...row,
    org_membership: row.org_membership
      ? { id: row.org_membership.id, name: row.org_membership.person?.name || null, employee_code: row.org_membership.employee_code }
      : null,
    issue_date: ymd(row.issue_date),
    return_date: ymd(row.return_date),
  };
}

// Every linked record must belong to this org: the employee, a vendor account
// as the supplier and a client account as the client.
async function checkLinks(orgId, { org_membership_id, vendor_account_id, client_account_id }) {
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

async function list(orgId, { status } = {}) {
  const rows = await prisma.asset.findMany({
    where: { org_id: orgId, ...(status ? { status } : {}) },
    select: SELECT,
    orderBy: [{ issue_date: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
  });
  return rows.map(serialize);
}

async function create(orgId, body) {
  const error = await checkLinks(orgId, body);
  if (error) return { error };
  const row = await prisma.asset.create({ data: { org_id: orgId, ...body }, select: SELECT });
  return { asset: serialize(row) };
}

async function update(orgId, id, patch) {
  const existing = await prisma.asset.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!existing) return { error: 'not_found' };
  const error = await checkLinks(orgId, patch);
  if (error) return { error };
  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const row = await prisma.asset.update({ where: { id }, data, select: SELECT });
  return { asset: serialize(row) };
}

async function remove(orgId, id) {
  const existing = await prisma.asset.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!existing) return { error: 'not_found' };
  await prisma.asset.delete({ where: { id } });
  return {};
}

module.exports = { list, create, update, remove };
