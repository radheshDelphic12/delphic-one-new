// Monthly salary adjustments on top of the salary structure: TDS, OT adjustment, variable pay,
// reimbursements and any other addition / deduction. The salary calculation adds them to the
// payable amount (see calculations/engines/salary.engine.js) and shows each one separately.
// Admin only; every change is audited, and a locked month is flagged for recalculation, never rewritten.

const prisma = require('../../config/db');
const { detectFinanceChange } = require('../../lib/financeChanges');

// +1 adds to the payable salary, -1 reduces it.
const KINDS = {
  tds: -1,
  deduction: -1,
  ot_adjustment: 1,
  variable_pay: 1,
  reimbursement: 1,
  addition: 1,
};
const KIND_LABELS = {
  tds: 'TDS adjustment',
  deduction: 'Other deduction',
  ot_adjustment: 'OT adjustment',
  variable_pay: 'Variable pay',
  reimbursement: 'Reimbursement',
  addition: 'Other addition',
};

const round2 = (n) => Math.round(n * 100) / 100;

// Totals per kind and the net effect of a list of { kind, amount } rows.
function summarize(items = []) {
  const by = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
  for (const i of items) if (i.kind in by) by[i.kind] = round2(by[i.kind] + Number(i.amount));
  const additions = round2(Object.keys(KINDS).filter((k) => KINDS[k] > 0).reduce((s, k) => s + by[k], 0));
  const deductions = round2(Object.keys(KINDS).filter((k) => KINDS[k] < 0).reduce((s, k) => s + by[k], 0));
  return {
    tds: by.tds,
    ot_adjustment: by.ot_adjustment,
    variable_pay: by.variable_pay,
    reimbursement: by.reimbursement,
    other_additions: by.addition,
    other_deductions: by.deduction,
    additions,
    deductions,
    net_effect: round2(additions - deductions),
    items: items.map((i) => ({ id: i.id, kind: i.kind, label: KIND_LABELS[i.kind] || i.kind, amount: Number(i.amount), sign: KINDS[i.kind] || 0, note: i.note || null })),
  };
}

const serialize = (r) => ({
  id: r.id,
  org_membership_id: r.org_membership_id,
  employee: r.org_membership?.person?.name || null,
  period_month: r.period_month,
  period_year: r.period_year,
  kind: r.kind,
  label: KIND_LABELS[r.kind] || r.kind,
  sign: KINDS[r.kind] || 0,
  amount: Number(r.amount),
  note: r.note || null,
  created_at: r.created_at,
});

const INCLUDE = { org_membership: { select: { person: { select: { name: true } } } } };

async function list(orgId, { period_month, period_year, org_membership_id } = {}) {
  const rows = await prisma.salaryAdjustment.findMany({
    where: { org_id: orgId, ...(period_month ? { period_month } : {}), ...(period_year ? { period_year } : {}), ...(org_membership_id ? { org_membership_id } : {}) },
    include: INCLUDE,
    orderBy: [{ created_at: 'asc' }],
  });
  return rows.map(serialize);
}

async function raise(orgId, actorId, row, description, oldValue, newValue) {
  await detectFinanceChange(orgId, {
    source_type: 'salary_adjustment',
    source_id: row.id,
    date: new Date(Date.UTC(row.period_year, row.period_month - 1, 1)),
    org_membership_id: row.org_membership_id,
    changed_by: actorId,
    description,
    old_value: oldValue,
    new_value: newValue,
  });
}

async function create(orgId, adminUser, { org_membership_id, period_month, period_year, kind, amount, note }) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } });
  if (!membership) return { error: 'membership_not_found' };
  const row = await prisma.salaryAdjustment.create({
    data: { org_id: orgId, org_membership_id, period_month, period_year, kind, amount, note: note || null, created_by: adminUser.id },
    include: INCLUDE,
  });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: adminUser.id, action: 'salary_adjustment_create', entity_type: 'salary_adjustment', entity_id: row.id, reason: note || KIND_LABELS[kind], snapshot: serialize(row) } });
  await raise(orgId, adminUser.id, row, `${KIND_LABELS[kind]} of ${amount} added`, null, { kind, amount });
  return { adjustment: serialize(row) };
}

async function update(orgId, adminUser, id, patch) {
  const existing = await prisma.salaryAdjustment.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  if (!existing) return { error: 'not_found' };
  const row = await prisma.salaryAdjustment.update({ where: { id }, data: patch, include: INCLUDE });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: adminUser.id, action: 'salary_adjustment_edit', entity_type: 'salary_adjustment', entity_id: id, reason: patch.note || 'edited', snapshot: { before: serialize(existing), after: serialize(row) } } });
  await raise(orgId, adminUser.id, row, `${KIND_LABELS[row.kind]} changed (${Number(existing.amount)} -> ${Number(row.amount)})`, { kind: existing.kind, amount: Number(existing.amount) }, { kind: row.kind, amount: Number(row.amount) });
  return { adjustment: serialize(row) };
}

async function remove(orgId, adminUser, id, { reason }) {
  const existing = await prisma.salaryAdjustment.findFirst({ where: { id, org_id: orgId }, include: INCLUDE });
  if (!existing) return { error: 'not_found' };
  await prisma.salaryAdjustment.delete({ where: { id } });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: adminUser.id, action: 'salary_adjustment_delete', entity_type: 'salary_adjustment', entity_id: id, reason, snapshot: serialize(existing) } });
  await raise(orgId, adminUser.id, existing, `${KIND_LABELS[existing.kind]} of ${Number(existing.amount)} removed`, { kind: existing.kind, amount: Number(existing.amount) }, null);
  return { deleted: true };
}

module.exports = { KINDS, KIND_LABELS, summarize, list, create, update, remove };
