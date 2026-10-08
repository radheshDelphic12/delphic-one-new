// Per-resource billing configuration for a project: a resource's own rate (so one resource is billed
// monthly and another hourly in the same month) and the project's client billing status rules
// (PL / NPL / comp off / first half / second half / half day ...). Admin only, audited; a locked month
// is flagged for recalculation, never rewritten. The calculation itself lives in
// calculations/engines/resourceBilling.js.

const prisma = require('../../config/db');
const { detectFinanceChange } = require('../../lib/financeChanges');
const { DEFAULT_RULES, rulesFor } = require('../calculations/engines/resourceBilling');

const serialize = (r) => ({
  id: r.id,
  account_id: r.account_id,
  org_membership_id: r.org_membership_id,
  resource: r.resource || null,
  rate_type: r.rate_type,
  rate: Number(r.rate),
  currency: r.currency,
  effective_from: r.effective_from.toISOString().slice(0, 10),
  created_at: r.created_at,
});

async function withNames(rows) {
  const ids = [...new Set(rows.map((r) => r.org_membership_id))];
  const members = ids.length ? await prisma.orgMembership.findMany({ where: { id: { in: ids } }, select: { id: true, person: { select: { name: true } } } }) : [];
  const names = new Map(members.map((m) => [m.id, m.person?.name || null]));
  return rows.map((r) => serialize({ ...r, resource: names.get(r.org_membership_id) }));
}

async function list(orgId, { account_id, org_membership_id } = {}) {
  const rows = await prisma.resourceBillingRate.findMany({
    where: { org_id: orgId, ...(account_id ? { account_id } : {}), ...(org_membership_id ? { org_membership_id } : {}) },
    orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
  });
  return withNames(rows);
}

async function flag(orgId, actorId, row, description) {
  await detectFinanceChange(orgId, {
    source_type: 'billing_adjustment',
    source_id: row.id,
    date: row.effective_from,
    account_id: row.account_id,
    org_membership_id: row.org_membership_id,
    changed_by: actorId,
    description,
  });
}

async function create(orgId, user, { account_id, org_membership_id, rate_type, rate, currency, effective_from }) {
  const [account, membership] = await Promise.all([
    prisma.account.findFirst({ where: { id: account_id, org_id: orgId }, select: { id: true } }),
    prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } }),
  ]);
  if (!account) return { error: 'account_not_found' };
  if (!membership) return { error: 'membership_not_found' };
  const row = await prisma.resourceBillingRate.create({
    data: { org_id: orgId, account_id, org_membership_id, rate_type, rate, currency: currency || 'INR', effective_from, created_by: user.id },
  });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'resource_billing_rate_create', entity_type: 'resource_billing_rate', entity_id: row.id, reason: `${rate_type} ${rate}`, snapshot: serialize(row) } });
  await flag(orgId, user.id, row, `Resource billing rate set (${rate_type} ${rate})`);
  return { rate: (await withNames([row]))[0] };
}

async function remove(orgId, user, id, { reason }) {
  const row = await prisma.resourceBillingRate.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.resourceBillingRate.delete({ where: { id } });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'resource_billing_rate_delete', entity_type: 'resource_billing_rate', entity_id: id, reason, snapshot: serialize(row) } });
  await flag(orgId, user.id, row, 'Resource billing rate removed');
  return { deleted: true };
}

// Bill every resource allocated to the project on its own rate: the project's current rate is copied to each
// allocated person that has no rate of their own yet, so the monthly client billing statuses (present, PL, NPL,
// comp off, first / second half ...) apply to them. Admin only, audited.
async function applyProjectRate(orgId, user, accountId, { effective_from }) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId }, select: { id: true } });
  if (!account) return { error: 'account_not_found' };
  const projectRate = await prisma.billingRate.findFirst({ where: { org_id: orgId, account_id: accountId, requirement_id: null, effective_from: { lte: effective_from } }, orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }] });
  if (!projectRate) return { error: 'no_project_rate' };
  const [assigned, existing] = await Promise.all([
    prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, account_id: accountId }, select: { org_membership_id: true }, distinct: ['org_membership_id'] }),
    prisma.resourceBillingRate.findMany({ where: { org_id: orgId, account_id: accountId }, select: { org_membership_id: true } }),
  ]);
  const have = new Set(existing.map((r) => r.org_membership_id));
  const targets = assigned.map((a) => a.org_membership_id).filter((id) => !have.has(id));
  for (const id of targets) {
    await prisma.resourceBillingRate.create({
      data: { org_id: orgId, account_id: accountId, org_membership_id: id, rate_type: projectRate.rate_type, rate: projectRate.rate, currency: projectRate.currency, effective_from, created_by: user.id },
    });
  }
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'resource_billing_rates_apply', entity_type: 'account', entity_id: accountId, reason: 'project rate applied to every allocated resource', snapshot: { rate_type: projectRate.rate_type, rate: Number(projectRate.rate), created_for: targets, skipped: [...have] } } });
  if (targets.length) await detectFinanceChange(orgId, { source_type: 'billing_adjustment', source_id: accountId, date: effective_from, account_id: accountId, changed_by: user.id, description: `Project rate applied to ${targets.length} resource${targets.length === 1 ? '' : 's'}` });
  return { created: targets.length, skipped: have.size };
}

// Client billing status rules of a project: the fraction of a working day billed per status.
async function getRules(orgId, accountId) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId }, select: { id: true, billing_leave_rules: true } });
  if (!account) return { error: 'not_found' };
  return { rules: rulesFor(account), defaults: DEFAULT_RULES, custom: account.billing_leave_rules || null };
}

async function setRules(orgId, user, accountId, rules, { reason } = {}) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId }, select: { id: true, billing_leave_rules: true } });
  if (!account) return { error: 'not_found' };
  const updated = await prisma.account.update({ where: { id: accountId }, data: { billing_leave_rules: rules }, select: { id: true, billing_leave_rules: true } });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'billing_leave_rules_set', entity_type: 'account', entity_id: accountId, reason: reason || 'client billing status rules', snapshot: { before: account.billing_leave_rules, after: rules } } });
  await detectFinanceChange(orgId, { source_type: 'billing_adjustment', source_id: accountId, date: new Date(), account_id: accountId, changed_by: user.id, description: 'Client billing status rules changed' });
  return { rules: rulesFor(updated), defaults: DEFAULT_RULES, custom: updated.billing_leave_rules };
}

module.exports = { list, create, remove, applyProjectRate, getRules, setRules };
