const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const calc = require('./property.calc');
const posting = require('./ledgerPosting');
const { addEvent } = require('./properties.service');

const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];
// the ledger's own payment-mode vocabulary
const LEDGER_MODE = { cash: 'cash', upi: 'upi', bank_transfer: 'bank', cheque: 'cheque', other: 'other' };

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dateOrNull = z.preprocess((v) => (v === '' || v === undefined ? null : v), dateStr.nullable());
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const money = z.preprocess((v) => (v === '' || v === null ? 0 : v), z.coerce.number().min(0).max(1e13));

const tenantFields = {
  name: z.string().trim().min(1).max(200),
  company_name: text(200),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  status: z.enum(['active', 'inactive']),
  notes: text(2000),
};
const tenantCreateSchema = z.object({ ...tenantFields, status: tenantFields.status.default('active') });
const tenantUpdateSchema = z.object(tenantFields).partial();
const leaseFields = {
  tenant_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  start_date: dateStr,
  end_date: dateOrNull.optional(),
  monthly_rent: z.coerce.number().positive().max(1e13),
  security_deposit: money,
  due_day: z.coerce.number().int().min(1).max(28),
  payment_method: z.preprocess((v) => (v === '' ? null : v), z.enum(PAYMENT_METHODS).nullable().optional()),
  notes: text(2000),
};
const leaseCreateSchema = z.object({ ...leaseFields, security_deposit: leaseFields.security_deposit.default(0), due_day: leaseFields.due_day.default(1) });
const leaseUpdateSchema = z.object({ end_date: leaseFields.end_date, monthly_rent: leaseFields.monthly_rent, security_deposit: leaseFields.security_deposit, due_day: leaseFields.due_day, payment_method: leaseFields.payment_method, notes: leaseFields.notes }).partial();
const leaseEndSchema = z.object({ ended_on: dateStr.optional(), reason: text(500) });
const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1e13),
  paid_on: dateStr,
  method: z.enum(PAYMENT_METHODS),
  reference: text(120),
  collected_by_person_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  notes: text(500),
});
const dueUpdateSchema = z.object({ amount: z.coerce.number().positive().max(1e13).optional(), waived: z.boolean().optional(), waived_reason: text(500) });
const duesQuerySchema = z.object({
  month: month.optional(),
  property_id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'partial', 'paid', 'overdue', 'waived']).optional(),
  q: z.string().trim().max(100).optional(),
});
const summaryQuerySchema = z.object({ month: month.optional() });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => todayStr().slice(0, 7);
const num = (v) => (v === null || v === undefined ? null : Number(v));

function addMonth(m, delta = 1) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
}
const dueDateOf = (period, dueDay) => `${period}-${String(dueDay).padStart(2, '0')}`;

// Status is derived, never stored: waived > paid > overdue (past due with a balance) > partial > pending.
function dueStatus(due, today = todayStr()) {
  if (due.waived) return 'waived';
  const amount = num(due.amount);
  const paid = num(due.paid_amount);
  if (paid >= amount) return 'paid';
  if (dayOf(due.due_date) < today) return 'overdue';
  return paid > 0 ? 'partial' : 'pending';
}

function dueOut(d, extra = {}) {
  const amount = num(d.amount);
  const paid = num(d.paid_amount);
  return {
    id: d.id, lease_id: d.lease_id, property_id: d.property_id, unit_id: d.unit_id, tenant_id: d.tenant_id, period: d.period,
    amount, paid_amount: paid, balance: d.waived ? 0 : calc.round2(Math.max(amount - paid, 0)), due_date: dayOf(d.due_date),
    waived: d.waived, waived_reason: d.waived_reason, status: dueStatus(d), partially_paid: !d.waived && paid > 0 && paid < amount,
    ...extra,
  };
}

// ---- tenants ----
async function listTenants(orgId, query) {
  const rows = await prisma.zxTenant.findMany({
    where: { org_id: orgId, deleted_at: null, ...(query.q ? { OR: ['name', 'company_name', 'phone', 'email'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}) },
    orderBy: { name: 'asc' },
    include: { leases: { where: { deleted_at: null, status: 'active' }, select: { id: true, monthly_rent: true, unit: { select: { name: true, property: { select: { name: true } } } } } } },
  });
  return rows.map(({ leases, ...t }) => ({ ...t, active_leases: leases.length, monthly_rent: calc.round2(leases.reduce((a, l) => a + num(l.monthly_rent), 0)), places: leases.map((l) => `${l.unit.property.name} · ${l.unit.name}`) }));
}

async function getTenant(orgId, id) {
  const t = await prisma.zxTenant.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!t) return { error: 'not_found' };
  const leases = await prisma.zxLease.findMany({ where: { tenant_id: id, org_id: orgId, deleted_at: null }, orderBy: { start_date: 'desc' }, include: { unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } } } });
  return { tenant: { ...t, leases: leases.map((l) => leaseOut(l)) } };
}

async function createTenant(orgId, actorId, input) {
  const dup = await prisma.zxTenant.findFirst({ where: { org_id: orgId, deleted_at: null, name: { equals: input.name, mode: 'insensitive' }, company_name: input.company_name ?? null }, select: { id: true } });
  if (dup) return { error: 'duplicate_tenant' };
  const tenant = await prisma.zxTenant.create({ data: { org_id: orgId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'tenant', entityId: tenant.id, action: 'create', after: { name: tenant.name } });
  return { tenant };
}

async function updateTenant(orgId, actorId, id, input) {
  const before = await prisma.zxTenant.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const tenant = await prisma.zxTenant.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'tenant', entityId: id, action: 'update', before: { name: before.name, status: before.status }, after: { name: tenant.name, status: tenant.status } });
  return { tenant };
}

async function removeTenant(orgId, actorId, id) {
  const before = await prisma.zxTenant.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if ((await prisma.zxLease.count({ where: { tenant_id: id, org_id: orgId, deleted_at: null, status: 'active' } })) > 0) return { error: 'tenant_has_lease' };
  await prisma.zxTenant.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'tenant', entityId: id, action: 'delete', before: { name: before.name } });
  return { ok: true };
}

// ---- leases ----
function leaseOut(l) {
  return {
    id: l.id, tenant_id: l.tenant_id, unit_id: l.unit_id, property_id: l.property_id, start_date: dayOf(l.start_date), end_date: dayOf(l.end_date), monthly_rent: num(l.monthly_rent),
    security_deposit: num(l.security_deposit), due_day: l.due_day, payment_method: l.payment_method, status: l.status, ended_on: dayOf(l.ended_on), notes: l.notes,
    ...(l.unit ? { unit: { id: l.unit.id, name: l.unit.name, property: l.unit.property || null } } : {}),
    ...(l.tenant ? { tenant: { id: l.tenant.id, name: l.tenant.name, company_name: l.tenant.company_name } } : {}),
  };
}

async function listLeases(orgId, query) {
  const rows = await prisma.zxLease.findMany({
    where: { org_id: orgId, deleted_at: null, ...(query.status ? { status: query.status } : {}), ...(query.property_id ? { property_id: query.property_id } : {}), ...(query.unit_id ? { unit_id: query.unit_id } : {}), ...(query.tenant_id ? { tenant_id: query.tenant_id } : {}) },
    orderBy: [{ status: 'asc' }, { start_date: 'desc' }],
    include: { tenant: { select: { id: true, name: true, company_name: true } }, unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } } },
  });
  return rows.map(leaseOut);
}

// Creates any rent due the lease is missing from its start month through `through` (default: this month). Idempotent.
async function generateForLease(orgId, lease, through = currentMonth()) {
  const last = lease.status === 'ended' ? (dayOf(lease.ended_on) || dayOf(lease.end_date) || through).slice(0, 7) : lease.end_date ? (dayOf(lease.end_date).slice(0, 7) < through ? dayOf(lease.end_date).slice(0, 7) : through) : through;
  const rows = [];
  for (let m = dayOf(lease.start_date).slice(0, 7); m <= last; m = addMonth(m)) {
    rows.push({ org_id: orgId, lease_id: lease.id, property_id: lease.property_id, unit_id: lease.unit_id, tenant_id: lease.tenant_id, period: m, amount: lease.monthly_rent, due_date: toDate(dueDateOf(m, lease.due_day)) });
  }
  if (rows.length) await prisma.zxRentDue.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

async function generate(orgId, through = currentMonth()) {
  const leases = await prisma.zxLease.findMany({ where: { org_id: orgId, deleted_at: null, status: 'active' } });
  let touched = 0;
  for (const l of leases) touched += await generateForLease(orgId, l, through);
  return { leases: leases.length, through };
}

async function overlapping(orgId, unitId, start, end, ignoreId) {
  const rows = await prisma.zxLease.findMany({ where: { org_id: orgId, unit_id: unitId, deleted_at: null, status: 'active', ...(ignoreId ? { NOT: { id: ignoreId } } : {}) } });
  return rows.some((l) => {
    const ls = dayOf(l.start_date);
    const le = dayOf(l.end_date) || '9999-12-31';
    return start <= le && (end || '9999-12-31') >= ls;
  });
}

async function createLease(orgId, actorId, input) {
  if (input.end_date && input.end_date < input.start_date) return { error: 'bad_dates' };
  const [tenant, unit] = await Promise.all([
    prisma.zxTenant.findFirst({ where: { id: input.tenant_id, org_id: orgId, deleted_at: null } }),
    prisma.zxPropertyUnit.findFirst({ where: { id: input.unit_id, org_id: orgId, deleted_at: null }, include: { property: true } }),
  ]);
  if (!tenant || !unit || unit.property.deleted_at) return { error: 'not_found' };
  if (tenant.status !== 'active') return { error: 'tenant_inactive' };
  if (unit.status === 'sold' || unit.ownership !== 'zephyr') return { error: 'unit_not_rentable' };
  if (await overlapping(orgId, unit.id, input.start_date, input.end_date)) return { error: 'lease_overlap' };
  const { start_date, end_date, ...rest } = input;
  const lease = await prisma.$transaction(async (tx) => {
    const created = await tx.zxLease.create({ data: { org_id: orgId, created_by: actorId, property_id: unit.property_id, ...rest, start_date: toDate(start_date), end_date: toDate(end_date) } });
    await tx.zxPropertyUnit.update({ where: { id: unit.id }, data: { status: 'rented' } });
    return created;
  });
  await generateForLease(orgId, lease);
  await addEvent(prisma, orgId, actorId, { property_id: unit.property_id, unit_id: unit.id, kind: 'rent', event_date: input.start_date, title: `${unit.name} rented to ${tenant.name}`, amount: input.monthly_rent, source_type: 'lease', source_id: lease.id });
  await writeAudit(null, { orgId, actorId, entity: 'lease', entityId: lease.id, action: 'create', after: { tenant_id: tenant.id, unit_id: unit.id, monthly_rent: input.monthly_rent, due_day: input.due_day } });
  return getLease(orgId, lease.id);
}

async function getLease(orgId, id) {
  const l = await prisma.zxLease.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { tenant: { select: { id: true, name: true, company_name: true } }, unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } } } });
  if (!l) return { error: 'not_found' };
  const dues = await prisma.zxRentDue.findMany({ where: { lease_id: id, org_id: orgId }, orderBy: { period: 'desc' } });
  return { lease: { ...leaseOut(l), dues: dues.map((d) => dueOut(d)) } };
}

async function updateLease(orgId, actorId, id, input) {
  const before = await prisma.zxLease.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (before.status === 'ended') return { error: 'lease_ended' };
  const end = input.end_date !== undefined ? input.end_date : dayOf(before.end_date);
  if (end && end < dayOf(before.start_date)) return { error: 'bad_dates' };
  if (input.end_date !== undefined && (await overlapping(orgId, before.unit_id, dayOf(before.start_date), end, id))) return { error: 'lease_overlap' };
  const { end_date, ...rest } = input;
  const lease = await prisma.zxLease.update({ where: { id }, data: { ...rest, ...(end_date !== undefined ? { end_date: toDate(end_date) } : {}) } });
  // A new rent or due day applies to this month onward for dues that nothing has been paid against yet.
  if (input.monthly_rent !== undefined || input.due_day !== undefined) {
    const open = await prisma.zxRentDue.findMany({ where: { lease_id: id, org_id: orgId, period: { gte: currentMonth() }, paid_amount: 0, waived: false } });
    for (const d of open) {
      if (!(await posting.periodsOpen(orgId, [`${d.period}-01`]))) continue;
      await prisma.zxRentDue.update({ where: { id: d.id }, data: { ...(input.monthly_rent !== undefined ? { amount: lease.monthly_rent } : {}), ...(input.due_day !== undefined ? { due_date: toDate(dueDateOf(d.period, lease.due_day)) } : {}) } });
    }
  }
  await writeAudit(null, { orgId, actorId, entity: 'lease', entityId: id, action: input.monthly_rent !== undefined ? 'rent_change' : 'update', before: { monthly_rent: num(before.monthly_rent), due_day: before.due_day, end_date: dayOf(before.end_date) }, after: { monthly_rent: num(lease.monthly_rent), due_day: lease.due_day, end_date: dayOf(lease.end_date) } });
  return getLease(orgId, id);
}

async function endLease(orgId, actorId, id, input) {
  const before = await prisma.zxLease.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { unit: true } });
  if (!before) return { error: 'not_found' };
  if (before.status === 'ended') return { error: 'lease_ended' };
  const endedOn = input.ended_on || todayStr();
  if (endedOn < dayOf(before.start_date)) return { error: 'bad_dates' };
  await prisma.$transaction(async (tx) => {
    await tx.zxLease.update({ where: { id }, data: { status: 'ended', ended_on: toDate(endedOn) } });
    // unpaid dues after the end month never fall due
    await tx.zxRentDue.deleteMany({ where: { lease_id: id, org_id: orgId, period: { gt: endedOn.slice(0, 7) }, paid_amount: 0 } });
    const others = await tx.zxLease.count({ where: { unit_id: before.unit_id, org_id: orgId, deleted_at: null, status: 'active', NOT: { id } } });
    if (others === 0 && before.unit.status === 'rented') await tx.zxPropertyUnit.update({ where: { id: before.unit_id }, data: { status: 'vacant' } });
  });
  await addEvent(prisma, orgId, actorId, { property_id: before.property_id, unit_id: before.unit_id, kind: 'rent', event_date: endedOn, title: `${before.unit.name} lease ended`, source_type: 'lease', source_id: id, notes: input.reason });
  await writeAudit(null, { orgId, actorId, entity: 'lease', entityId: id, action: 'end', before: { status: 'active' }, after: { status: 'ended', ended_on: endedOn }, reason: input.reason });
  return getLease(orgId, id);
}

// ---- dues and payments ----
async function listDues(orgId, query) {
  const m = query.month || currentMonth();
  if (m <= addMonth(currentMonth())) await generate(orgId, m <= currentMonth() ? m : currentMonth());
  const rows = await prisma.zxRentDue.findMany({
    where: { org_id: orgId, period: m, ...(query.property_id ? { property_id: query.property_id } : {}), ...(query.tenant_id ? { tenant_id: query.tenant_id } : {}) },
    orderBy: [{ due_date: 'asc' }],
    include: { lease: { include: { tenant: { select: { id: true, name: true, company_name: true } }, unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } } } } },
  });
  let out = rows.map((d) => dueOut(d, { tenant: d.lease.tenant, unit: { id: d.lease.unit.id, name: d.lease.unit.name }, property: d.lease.unit.property }));
  if (query.status) out = out.filter((d) => d.status === query.status);
  if (query.q) {
    const q = query.q.toLowerCase();
    out = out.filter((d) => [d.tenant.name, d.tenant.company_name, d.unit.name, d.property.name].some((x) => x && x.toLowerCase().includes(q)));
  }
  return out;
}

async function listOverdue(orgId) {
  await generate(orgId);
  const rows = await prisma.zxRentDue.findMany({
    where: { org_id: orgId, waived: false, due_date: { lt: toDate(todayStr()) } },
    orderBy: [{ due_date: 'asc' }],
    include: { lease: { include: { tenant: { select: { id: true, name: true, company_name: true } }, unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } } } } },
  });
  return rows
    .map((d) => dueOut(d, { tenant: d.lease.tenant, unit: { id: d.lease.unit.id, name: d.lease.unit.name }, property: d.lease.unit.property, days_overdue: Math.round((Date.now() - new Date(d.due_date).getTime()) / 86400000) }))
    .filter((d) => d.status === 'overdue');
}

async function rentSummary(orgId, monthKey = currentMonth()) {
  if (monthKey <= currentMonth()) await generate(orgId, monthKey);
  const dues = await prisma.zxRentDue.findMany({ where: { org_id: orgId, period: monthKey }, include: { lease: { select: { unit: { select: { property: { select: { id: true, name: true } } } } } } } });
  const today = todayStr();
  const acc = { month: monthKey, total_due: 0, collected: 0, pending: 0, overdue: 0, waived: 0, count: dues.length, overdue_count: 0 };
  const byProperty = new Map();
  for (const d of dues) {
    const amount = num(d.amount);
    const paid = Math.min(num(d.paid_amount), amount);
    const status = dueStatus(d, today);
    const p = d.lease.unit.property;
    const row = byProperty.get(p.id) || { property_id: p.id, name: p.name, total_due: 0, collected: 0, overdue: 0 };
    if (status === 'waived') { acc.waived += amount; continue; }
    acc.total_due += amount;
    acc.collected += paid;
    row.total_due += amount;
    row.collected += paid;
    if (status === 'overdue') { acc.overdue += amount - paid; acc.overdue_count += 1; row.overdue += amount - paid; }
    byProperty.set(p.id, row);
  }
  acc.pending = acc.total_due - acc.collected;
  return { ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, typeof v === 'number' ? calc.round2(v) : v])), by_property: [...byProperty.values()].map((r) => ({ ...r, total_due: calc.round2(r.total_due), collected: calc.round2(r.collected), overdue: calc.round2(r.overdue) })) };
}

async function listPayments(orgId, query) {
  const where = { org_id: orgId, deleted_at: null, ...(query.property_id ? { property_id: query.property_id } : {}), ...(query.tenant_id ? { tenant_id: query.tenant_id } : {}), ...(query.from || query.to ? { paid_on: { ...(query.from ? { gte: toDate(query.from) } : {}), ...(query.to ? { lte: toDate(query.to) } : {}) } } : {}) };
  const rows = await prisma.zxRentPayment.findMany({ where, orderBy: [{ paid_on: 'desc' }, { created_at: 'desc' }], take: 300, include: { rent_due: { select: { period: true } } } });
  const [tenants, units, people] = await Promise.all([
    prisma.zxTenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenant_id))] }, org_id: orgId }, select: { id: true, name: true } }),
    prisma.zxPropertyUnit.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.unit_id))] }, org_id: orgId }, select: { id: true, name: true, property: { select: { id: true, name: true } } } }),
    prisma.zxPerson.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.collected_by_person_id).filter(Boolean))] }, org_id: orgId }, select: { id: true, name: true } }),
  ]);
  const tm = new Map(tenants.map((t) => [t.id, t]));
  const um = new Map(units.map((u) => [u.id, u]));
  const pm = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id, rent_due_id: r.rent_due_id, period: r.rent_due.period, amount: num(r.amount), paid_on: dayOf(r.paid_on), method: r.method, reference: r.reference, notes: r.notes, collected_by_person_id: r.collected_by_person_id,
    tenant: tm.get(r.tenant_id) || null, unit: um.get(r.unit_id) ? { id: r.unit_id, name: um.get(r.unit_id).name } : null, property: um.get(r.unit_id)?.property || null, collected_by: pm.get(r.collected_by_person_id) || null,
  }));
}

async function recordPayment(orgId, actorId, dueId, input) {
  const due = await prisma.zxRentDue.findFirst({ where: { id: dueId, org_id: orgId }, include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } } });
  if (!due) return { error: 'not_found' };
  if (due.waived) return { error: 'due_waived' };
  if (input.paid_on > todayStr()) return { error: 'future_payment' };
  const balance = num(due.amount) - num(due.paid_amount);
  if (input.amount > balance + 0.001) return { error: 'exceeds_balance', balance };
  if (!(await posting.periodsOpen(orgId, [input.paid_on, `${due.period}-01`]))) return { error: 'period_closed' };
  if (input.collected_by_person_id && !(await prisma.zxPerson.findFirst({ where: { id: input.collected_by_person_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'collector_invalid' };
  const { unit } = due.lease;
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.zxRentPayment.create({
      data: { org_id: orgId, created_by: actorId, rent_due_id: dueId, lease_id: due.lease_id, tenant_id: due.tenant_id, property_id: due.property_id, unit_id: due.unit_id, amount: input.amount, paid_on: toDate(input.paid_on), method: input.method, reference: input.reference || null, collected_by_person_id: input.collected_by_person_id || null, notes: input.notes || null },
    });
    await tx.zxRentDue.update({ where: { id: dueId }, data: { paid_amount: { increment: input.amount } } });
    return p;
  });
  const entry = await posting.post(orgId, actorId, {
    entry_date: input.paid_on, type: 'revenue', category: 'Rental income', amount: input.amount, payment_mode: LEDGER_MODE[input.method], reference: input.reference,
    description: `Rent ${due.period} - ${due.lease.tenant.name} - ${unit.property.name} / ${unit.name}`, service_type: 'property_management', property_id: due.property_id, unit_id: due.unit_id, source_type: 'rent_payment', source_id: payment.id,
  });
  await prisma.zxRentPayment.update({ where: { id: payment.id }, data: { ledger_entry_id: entry.id } });
  await addEvent(prisma, orgId, actorId, { property_id: due.property_id, unit_id: due.unit_id, kind: 'rent', event_date: input.paid_on, title: `Rent ${due.period} received from ${due.lease.tenant.name}`, amount: input.amount, source_type: 'rent_payment', source_id: payment.id });
  await writeAudit(null, { orgId, actorId, entity: 'rent_payment', entityId: payment.id, action: 'create', after: { period: due.period, amount: input.amount, method: input.method } });
  const fresh = await prisma.zxRentDue.findUnique({ where: { id: dueId } });
  return { due: dueOut(fresh), payment_id: payment.id };
}

async function removePayment(orgId, actorId, paymentId) {
  const p = await prisma.zxRentPayment.findFirst({ where: { id: paymentId, org_id: orgId, deleted_at: null } });
  if (!p) return { error: 'not_found' };
  if (!(await posting.periodsOpen(orgId, [dayOf(p.paid_on)]))) return { error: 'period_closed' };
  await prisma.$transaction([
    prisma.zxRentPayment.update({ where: { id: paymentId }, data: { deleted_at: new Date() } }),
    prisma.zxRentDue.update({ where: { id: p.rent_due_id }, data: { paid_amount: { decrement: p.amount } } }),
  ]);
  await posting.voidSource(orgId, actorId, 'rent_payment', paymentId);
  await writeAudit(null, { orgId, actorId, entity: 'rent_payment', entityId: paymentId, action: 'delete', before: { amount: num(p.amount), paid_on: dayOf(p.paid_on) } });
  return { due: dueOut(await prisma.zxRentDue.findUnique({ where: { id: p.rent_due_id } })) };
}

async function updatePayment(orgId, actorId, paymentId, input) {
  const p = await prisma.zxRentPayment.findFirst({ where: { id: paymentId, org_id: orgId, deleted_at: null } });
  if (!p) return { error: 'not_found' };
  const due = await prisma.zxRentDue.findFirst({ where: { id: p.rent_due_id, org_id: orgId } });
  const old = { amount: num(p.amount), paid_on: dayOf(p.paid_on), method: p.method, reference: p.reference, collected_by_person_id: p.collected_by_person_id, notes: p.notes };
  const next = {
    amount: input.amount ?? old.amount,
    paid_on: input.paid_on ?? old.paid_on,
    method: input.method ?? old.method,
    reference: input.reference === undefined ? old.reference : input.reference,
    collected_by_person_id: input.collected_by_person_id === undefined ? old.collected_by_person_id : input.collected_by_person_id,
    notes: input.notes === undefined ? old.notes : input.notes,
  };
  if (next.paid_on > todayStr()) return { error: 'future_payment' };
  const room = num(due.amount) - num(due.paid_amount) + old.amount;
  if (next.amount > room + 0.001) return { error: 'exceeds_balance', balance: room };
  if (!(await posting.periodsOpen(orgId, [old.paid_on, next.paid_on]))) return { error: 'period_closed' };
  const removed = await removePayment(orgId, actorId, paymentId);
  if (removed.error) return removed;
  const made = await recordPayment(orgId, actorId, p.rent_due_id, next);
  if (made.error) {
    await recordPayment(orgId, actorId, p.rent_due_id, old);
    return made;
  }
  return made;
}

async function updateDue(orgId, actorId, dueId, input) {
  const due = await prisma.zxRentDue.findFirst({ where: { id: dueId, org_id: orgId } });
  if (!due) return { error: 'not_found' };
  if (!(await posting.periodsOpen(orgId, [`${due.period}-01`]))) return { error: 'period_closed' };
  if (input.waived === true && !input.waived_reason) return { error: 'waive_reason_required' };
  if (input.amount !== undefined && input.amount < num(due.paid_amount)) return { error: 'below_paid' };
  const data = {
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.waived !== undefined ? { waived: input.waived, waived_reason: input.waived ? input.waived_reason : null } : {}),
  };
  const after = await prisma.zxRentDue.update({ where: { id: dueId }, data });
  await writeAudit(null, { orgId, actorId, entity: 'rent_due', entityId: dueId, action: input.waived !== undefined ? (input.waived ? 'waive' : 'unwaive') : 'update', before: { amount: num(due.amount), waived: due.waived }, after: { amount: num(after.amount), waived: after.waived }, reason: input.waived_reason });
  return { due: dueOut(after) };
}

module.exports = {
  PAYMENT_METHODS,
  tenantCreateSchema, tenantUpdateSchema, leaseCreateSchema, leaseUpdateSchema, leaseEndSchema, paymentSchema, dueUpdateSchema, duesQuerySchema, summaryQuerySchema,
  dueStatus, dueOut, generate, generateForLease, updatePayment,
  listTenants, getTenant, createTenant, updateTenant, removeTenant, listLeases, getLease, createLease, updateLease, endLease,
  listDues, listOverdue, rentSummary, listPayments, recordPayment, removePayment, updateDue,
};
