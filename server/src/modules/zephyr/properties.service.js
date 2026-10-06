const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const calc = require('./property.calc');

const PROPERTY_TYPES = ['plot', 'house', 'building', 'shops', 'office', 'commercial_complex', 'other'];
const PROPERTY_STATUSES = ['active', 'under_construction', 'under_renovation', 'held', 'sold', 'inactive'];
const UNIT_STATUSES = ['available', 'rented', 'sold', 'held', 'under_construction', 'under_renovation', 'vacant'];
const FINANCING_TYPES = ['bank_loan', 'private_loan', 'other'];
const EMI_FREQUENCIES = ['monthly', 'quarterly', 'yearly'];
const EVENT_KINDS = ['purchase', 'construction', 'renovation', 'valuation', 'rent', 'sale', 'loan', 'status', 'note'];
// Money fields and valuation are finance data: admin / finance only.
const FINANCE_FIELDS = [...calc.COST_FIELDS];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const money = z.preprocess((v) => (v === '' || v === null ? 0 : v), z.coerce.number().min(0).max(1e13));
const moneyOrNull = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());

const propertyFields = {
  name: z.string().trim().min(1).max(200),
  property_type: z.enum(PROPERTY_TYPES),
  address: text(500),
  city: text(120),
  state: text(120),
  location: text(200),
  area_value: moneyOrNull,
  area_unit: z.string().trim().min(1).max(20),
  current_use: text(120),
  status: z.enum(PROPERTY_STATUSES),
  notes: text(4000),
  purchase_date: dateOnly.optional(),
  purchase_cost: money,
  brokerage: money,
  documentation_cost: money,
  registration_cost: money,
  construction_cost: money,
  renovation_cost: money,
  other_cost: money,
};
const createPropertySchema = z.object({
  ...propertyFields,
  property_type: propertyFields.property_type.default('other'),
  status: propertyFields.status.default('active'),
  area_unit: propertyFields.area_unit.default('sqft'),
  ...Object.fromEntries(FINANCE_FIELDS.map((f) => [f, propertyFields[f].optional()])),
});
const updatePropertySchema = z.object(propertyFields).partial();
const listQuerySchema = z.object({
  property_type: z.enum(PROPERTY_TYPES).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  city: z.string().trim().max(100).optional(),
  current_use: z.string().trim().max(100).optional(),
  tenant: z.string().trim().max(100).optional(),
  min_valuation: z.coerce.number().min(0).optional(),
  max_valuation: z.coerce.number().min(0).optional(),
  q: z.string().trim().max(100).optional(),
});
const unitFields = {
  name: z.string().trim().min(1).max(120),
  building: text(120),
  floor: text(60),
  unit_type: text(60),
  area_value: moneyOrNull,
  status: z.enum(UNIT_STATUSES),
  ownership: z.enum(['zephyr', 'third_party']),
  allocated_cost: moneyOrNull,
  notes: text(2000),
};
const unitCreateSchema = z.object({ ...unitFields, status: unitFields.status.default('available'), ownership: unitFields.ownership.default('zephyr') });
const unitUpdateSchema = z.object(unitFields).partial();
const loanFields = {
  financing_type: z.enum(FINANCING_TYPES),
  lender: text(200),
  loan_amount: money,
  outstanding_amount: money,
  emi_amount: money,
  emi_frequency: z.enum(EMI_FREQUENCIES),
  interest_rate: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  start_date: dateOnly.optional(),
  end_date: dateOnly.optional(),
  status: z.enum(['active', 'closed']),
  notes: text(1000),
};
const loanCreateSchema = z.object({ ...loanFields, loan_amount: loanFields.loan_amount.default(0), outstanding_amount: loanFields.outstanding_amount.default(0), emi_amount: loanFields.emi_amount.default(0), financing_type: loanFields.financing_type.default('bank_loan'), emi_frequency: loanFields.emi_frequency.default('monthly'), status: loanFields.status.default('active') });
const loanUpdateSchema = z.object(loanFields).partial();
const valuationSchema = z.object({ value: z.coerce.number().min(0).max(1e13), as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), unit_id: z.string().uuid().nullable().optional(), notes: text(500) });
const eventSchema = z.object({ kind: z.enum(EVENT_KINDS).default('note'), event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().trim().min(1).max(200), amount: moneyOrNull, notes: text(1000), unit_id: z.string().uuid().nullable().optional() });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const snapshot = (p) => ({ code: p.code, name: p.name, property_type: p.property_type, status: p.status, purchase_cost: num(p.purchase_cost), construction_cost: num(p.construction_cost), valuation: num(p.valuation) });

async function nextCode(tx, orgId) {
  await tx.zxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.zxSetting.update({ where: { org_id: orgId }, data: { property_seq: { increment: 1 } } });
  return `${s.property_prefix}-${String(s.property_seq).padStart(3, '0')}`;
}

async function addEvent(client, orgId, actorId, e) {
  return client.zxPropertyEvent.create({
    data: { org_id: orgId, created_by: actorId, property_id: e.property_id, unit_id: e.unit_id || null, kind: e.kind, event_date: toDate(e.event_date || todayStr()), title: e.title, amount: e.amount ?? null, notes: e.notes || null, source_type: e.source_type || null, source_id: e.source_id || null },
  });
}

function propertyOut(p, ctx, extra = {}) {
  const base = {
    id: p.id, code: p.code, name: p.name, property_type: p.property_type, address: p.address, city: p.city, state: p.state, location: p.location,
    area_value: num(p.area_value), area_unit: p.area_unit, current_use: p.current_use, status: p.status, notes: p.notes, purchase_date: p.purchase_date, created_at: p.created_at, updated_at: p.updated_at,
    ...extra,
  };
  if (!ctx.canFinance) return base;
  const invested = calc.totalInvestment(p);
  const val = num(p.valuation);
  const app = calc.appreciation(invested, val);
  return {
    ...base,
    ...Object.fromEntries(FINANCE_FIELDS.map((f) => [f, num(p[f])])),
    total_invested: invested,
    valuation: val,
    valuation_date: p.valuation_date,
    valuation_notes: p.valuation_notes,
    appreciation: app.amount,
    appreciation_pct: app.pct,
  };
}

async function unitCounts(orgId, ids) {
  if (ids.length === 0) return new Map();
  const rows = await prisma.zxPropertyUnit.groupBy({ by: ['property_id', 'status'], where: { org_id: orgId, property_id: { in: ids }, deleted_at: null }, _count: { _all: true } });
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.property_id) || { total: 0 };
    cur[r.status] = r._count._all;
    cur.total += r._count._all;
    map.set(r.property_id, cur);
  }
  return map;
}

async function list(orgId, ctx, query) {
  const and = [];
  if (query.q) and.push({ OR: ['name', 'code', 'address', 'location', 'city'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) });
  if (query.tenant) and.push({ units: { some: { deleted_at: null, leases: { some: { deleted_at: null, status: 'active', tenant: { name: { contains: query.tenant, mode: 'insensitive' } } } } } } });
  if (ctx.canFinance && query.min_valuation !== undefined) and.push({ valuation: { gte: query.min_valuation } });
  if (ctx.canFinance && query.max_valuation !== undefined) and.push({ valuation: { lte: query.max_valuation } });
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.property_type ? { property_type: query.property_type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {}),
    ...(query.current_use ? { current_use: { contains: query.current_use, mode: 'insensitive' } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
  const rows = await prisma.zxProperty.findMany({ where, orderBy: [{ created_at: 'desc' }], take: 300 });
  const counts = await unitCounts(orgId, rows.map((r) => r.id));
  const loans = ctx.canFinance && rows.length ? await prisma.zxPropertyLoan.findMany({ where: { org_id: orgId, property_id: { in: rows.map((r) => r.id) }, deleted_at: null } }) : [];
  return rows.map((r) => {
    const mine = loans.filter((l) => l.property_id === r.id);
    return propertyOut(r, ctx, {
      units: counts.get(r.id) || { total: 0 },
      ...(ctx.canFinance ? { outstanding_loan: mine.reduce((a, l) => a + (l.status === 'closed' ? 0 : num(l.outstanding_amount)), 0), monthly_emi: calc.round2(mine.reduce((a, l) => a + calc.monthlyFinancing(l), 0)) } : {}),
    });
  });
}

async function summary(orgId, ctx) {
  const props = await prisma.zxProperty.findMany({ where: { org_id: orgId, deleted_at: null } });
  const units = await prisma.zxPropertyUnit.groupBy({ by: ['status'], where: { org_id: orgId, deleted_at: null }, _count: { _all: true } });
  const byStatus = Object.fromEntries(UNIT_STATUSES.map((s) => [s, 0]));
  for (const u of units) byStatus[u.status] = u._count._all;
  const out = { properties: props.length, units: Object.values(byStatus).reduce((a, b) => a + b, 0), units_by_status: byStatus, occupied: byStatus.rented, vacant: byStatus.vacant + byStatus.available };
  if (!ctx.canFinance) return out;
  const live = props.filter((p) => p.status !== 'sold');
  const loans = await prisma.zxPropertyLoan.findMany({ where: { org_id: orgId, deleted_at: null, status: 'active' } });
  const invested = calc.round2(live.reduce((a, p) => a + calc.totalInvestment(p), 0));
  const valued = live.filter((p) => p.valuation !== null);
  const valuation = calc.round2(valued.reduce((a, p) => a + num(p.valuation), 0));
  const investedValued = calc.round2(valued.reduce((a, p) => a + calc.totalInvestment(p), 0));
  const app = calc.appreciation(investedValued, valuation);
  return {
    ...out,
    total_invested: invested,
    valuation,
    valued_properties: valued.length,
    appreciation: valued.length ? app.amount : null,
    appreciation_pct: valued.length ? app.pct : null,
    outstanding_loans: calc.round2(loans.reduce((a, l) => a + num(l.outstanding_amount), 0)),
    monthly_emi: calc.round2(loans.reduce((a, l) => a + calc.monthlyFinancing(l), 0)),
  };
}

// Income, operating expenses and financing for one property over a period; rent and expenses come
// from the money ledger so they match every other report.
async function cashFlowFor(orgId, propertyId, from, to) {
  const [entries, loans] = await Promise.all([
    prisma.zxLedgerEntry.findMany({ where: { org_id: orgId, property_id: propertyId, deleted_at: null, status: 'actual', entry_date: { gte: toDate(from), lte: toDate(to) } }, select: { type: true, amount: true, source_type: true } }),
    prisma.zxPropertyLoan.findMany({ where: { org_id: orgId, property_id: propertyId, deleted_at: null } }),
  ]);
  const months = Math.max(1, (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1);
  const income = entries.filter((e) => e.type === 'revenue' && e.source_type === 'rent_payment').reduce((a, e) => a + num(e.amount), 0);
  const expenses = entries.filter((e) => e.type === 'expense').reduce((a, e) => a + num(e.amount), 0);
  const financing = calc.round2(loans.reduce((a, l) => a + calc.monthlyFinancing(l), 0) * months);
  return { from, to, months, ...calc.cashFlow({ income, expenses, financing }) };
}

async function get(orgId, ctx, id) {
  const p = await prisma.zxProperty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!p) return { error: 'not_found' };
  const month = todayStr().slice(0, 7);
  const [units, loans, valuations, events, cash] = await Promise.all([
    prisma.zxPropertyUnit.findMany({
      where: { property_id: id, org_id: orgId, deleted_at: null },
      orderBy: [{ building: 'asc' }, { floor: 'asc' }, { name: 'asc' }],
      include: { leases: { where: { deleted_at: null, status: 'active' }, include: { tenant: { select: { id: true, name: true, company_name: true } } }, take: 1 } },
    }),
    ctx.canFinance ? prisma.zxPropertyLoan.findMany({ where: { property_id: id, org_id: orgId, deleted_at: null }, orderBy: { created_at: 'asc' } }) : [],
    ctx.canFinance ? prisma.zxPropertyValuation.findMany({ where: { property_id: id, org_id: orgId }, orderBy: [{ as_of: 'desc' }, { created_at: 'desc' }], take: 50 }) : [],
    prisma.zxPropertyEvent.findMany({ where: { property_id: id, org_id: orgId }, orderBy: [{ event_date: 'desc' }, { created_at: 'desc' }], take: 200 }),
    ctx.canFinance ? cashFlowFor(orgId, id, `${month}-01`, todayStr()) : null,
  ]);
  const unitOut = units.map((u) => {
    const lease = u.leases[0] || null;
    return {
      id: u.id, name: u.name, building: u.building, floor: u.floor, unit_type: u.unit_type, area_value: num(u.area_value), status: u.status, ownership: u.ownership, notes: u.notes,
      ...(ctx.canFinance ? { allocated_cost: num(u.allocated_cost), valuation: num(u.valuation), valuation_date: u.valuation_date } : {}),
      tenant: lease ? { id: lease.tenant.id, name: lease.tenant.name, company_name: lease.tenant.company_name, lease_id: lease.id, monthly_rent: num(lease.monthly_rent) } : null,
    };
  });
  const loanOut = loans.map((l) => ({ ...l, loan_amount: num(l.loan_amount), outstanding_amount: num(l.outstanding_amount), emi_amount: num(l.emi_amount), interest_rate: num(l.interest_rate), monthly_cost: calc.monthlyFinancing(l) }));
  const extra = {
    units: unitOut,
    events: events.map((e) => ({ ...e, amount: num(e.amount) })),
    ...(ctx.canFinance
      ? {
          loans: loanOut,
          valuations: valuations.map((v) => ({ ...v, value: num(v.value) })),
          outstanding_loan: calc.round2(loanOut.reduce((a, l) => a + (l.status === 'closed' ? 0 : l.outstanding_amount), 0)),
          monthly_financing: calc.round2(loanOut.reduce((a, l) => a + l.monthly_cost, 0)),
          cash_flow: cash,
        }
      : {}),
  };
  return { property: propertyOut(p, ctx, extra) };
}

function forbiddenFields(input, ctx) {
  return !ctx.canFinance && FINANCE_FIELDS.some((f) => input[f] !== undefined);
}

async function create(orgId, actorId, ctx, input) {
  if (forbiddenFields(input, ctx)) return { error: 'finance_only' };
  const { purchase_date, ...rest } = input;
  const property = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    const created = await tx.zxProperty.create({ data: { org_id: orgId, created_by: actorId, code, ...rest, purchase_date: toDate(purchase_date) } });
    if (purchase_date || calc.COST_FIELDS.some((f) => Number(rest[f]) > 0)) {
      await addEvent(tx, orgId, actorId, { property_id: created.id, kind: 'purchase', event_date: purchase_date || todayStr(), title: 'Property recorded', amount: calc.totalInvestment(created) || null });
    }
    return created;
  });
  await writeAudit(null, { orgId, actorId, entity: 'property', entityId: property.id, action: 'create', after: snapshot(property) });
  return get(orgId, ctx, property.id);
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.zxProperty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (forbiddenFields(input, ctx)) return { error: 'finance_only' };
  const { purchase_date, ...rest } = input;
  await prisma.zxProperty.update({ where: { id }, data: { ...rest, ...(purchase_date !== undefined ? { purchase_date: toDate(purchase_date) } : {}) } });
  const after = await prisma.zxProperty.findUnique({ where: { id } });
  if (input.status && input.status !== before.status) {
    await addEvent(prisma, orgId, actorId, { property_id: id, kind: 'status', title: `Status: ${before.status} -> ${after.status}` });
  }
  const costChanged = FINANCE_FIELDS.some((f) => input[f] !== undefined && Number(input[f]) !== num(before[f]));
  await writeAudit(null, { orgId, actorId, entity: 'property', entityId: id, action: costChanged ? 'update_costs' : 'update', before: snapshot(before), after: snapshot(after) });
  return get(orgId, ctx, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxProperty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const active = await prisma.zxLease.count({ where: { property_id: id, org_id: orgId, deleted_at: null, status: 'active' } });
  if (active > 0) return { error: 'has_active_leases' };
  await prisma.zxProperty.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'property', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

// ---- units ----
async function liveProperty(orgId, id) {
  return prisma.zxProperty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
}

async function addUnit(orgId, actorId, ctx, propertyId, input) {
  if (!(await liveProperty(orgId, propertyId))) return { error: 'not_found' };
  if (!ctx.canFinance && input.allocated_cost !== undefined) return { error: 'finance_only' };
  if (input.status === 'sold') return { error: 'sold_via_sale' };
  const dup = await prisma.zxPropertyUnit.findFirst({ where: { org_id: orgId, property_id: propertyId, deleted_at: null, name: { equals: input.name, mode: 'insensitive' }, building: input.building ?? null, floor: input.floor ?? null }, select: { id: true } });
  if (dup) return { error: 'duplicate_unit' };
  const unit = await prisma.zxPropertyUnit.create({ data: { org_id: orgId, property_id: propertyId, ...input } });
  await addEvent(prisma, orgId, actorId, { property_id: propertyId, unit_id: unit.id, kind: 'status', title: `Unit added: ${unit.name}` });
  await writeAudit(null, { orgId, actorId, entity: 'property_unit', entityId: unit.id, action: 'create', after: { name: unit.name, status: unit.status } });
  return get(orgId, ctx, propertyId);
}

async function updateUnit(orgId, actorId, ctx, propertyId, unitId, input) {
  const before = await prisma.zxPropertyUnit.findFirst({ where: { id: unitId, property_id: propertyId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!ctx.canFinance && input.allocated_cost !== undefined) return { error: 'finance_only' };
  if (before.status === 'sold' && input.status && input.status !== 'sold') return { error: 'unit_sold' };
  if (input.status === 'sold') return { error: 'sold_via_sale' };
  if (input.status && input.status !== 'rented' && before.status === 'rented') {
    const active = await prisma.zxLease.count({ where: { unit_id: unitId, org_id: orgId, deleted_at: null, status: 'active' } });
    if (active > 0) return { error: 'unit_has_lease' };
  }
  if (input.status === 'rented' && before.status !== 'rented') return { error: 'rented_via_lease' };
  await prisma.zxPropertyUnit.update({ where: { id: unitId }, data: input });
  const after = await prisma.zxPropertyUnit.findUnique({ where: { id: unitId } });
  if (input.status && input.status !== before.status) await addEvent(prisma, orgId, actorId, { property_id: propertyId, unit_id: unitId, kind: 'status', title: `${after.name}: ${before.status} -> ${after.status}` });
  await writeAudit(null, { orgId, actorId, entity: 'property_unit', entityId: unitId, action: 'update', before: { name: before.name, status: before.status }, after: { name: after.name, status: after.status } });
  return get(orgId, ctx, propertyId);
}

async function removeUnit(orgId, actorId, ctx, propertyId, unitId) {
  const before = await prisma.zxPropertyUnit.findFirst({ where: { id: unitId, property_id: propertyId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (before.status === 'sold') return { error: 'unit_sold' };
  const active = await prisma.zxLease.count({ where: { unit_id: unitId, org_id: orgId, deleted_at: null, status: 'active' } });
  if (active > 0) return { error: 'unit_has_lease' };
  await prisma.zxPropertyUnit.update({ where: { id: unitId }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'property_unit', entityId: unitId, action: 'delete', before: { name: before.name } });
  return get(orgId, ctx, propertyId);
}

// Units Zephyr owns that nobody is renting right now, for the lease form.
async function rentableUnits(orgId) {
  const units = await prisma.zxPropertyUnit.findMany({
    where: { org_id: orgId, deleted_at: null, ownership: 'zephyr', status: { notIn: ['sold', 'rented'] }, property: { deleted_at: null, status: { not: 'sold' } }, leases: { none: { deleted_at: null, status: 'active' } } },
    include: { property: { select: { id: true, code: true, name: true } } },
    orderBy: [{ property: { name: 'asc' } }, { name: 'asc' }],
  });
  return units.map((u) => ({ id: u.id, name: u.name, floor: u.floor, building: u.building, status: u.status, property: `${u.property.code} ${u.property.name}`, property_id: u.property.id }));
}

// ---- loans (finance) ----
async function addLoan(orgId, actorId, ctx, propertyId, input) {
  if (!(await liveProperty(orgId, propertyId))) return { error: 'not_found' };
  if (input.start_date && input.end_date && input.end_date < input.start_date) return { error: 'bad_dates' };
  const { start_date, end_date, ...rest } = input;
  const loan = await prisma.zxPropertyLoan.create({ data: { org_id: orgId, property_id: propertyId, ...rest, start_date: toDate(start_date), end_date: toDate(end_date) } });
  await addEvent(prisma, orgId, actorId, { property_id: propertyId, kind: 'loan', title: `Loan added${loan.lender ? `: ${loan.lender}` : ''}`, amount: num(loan.loan_amount) });
  await writeAudit(null, { orgId, actorId, entity: 'property_loan', entityId: loan.id, action: 'create', after: { lender: loan.lender, loan_amount: num(loan.loan_amount), emi_amount: num(loan.emi_amount) } });
  return get(orgId, ctx, propertyId);
}

async function updateLoan(orgId, actorId, ctx, propertyId, loanId, input) {
  const before = await prisma.zxPropertyLoan.findFirst({ where: { id: loanId, property_id: propertyId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const start = input.start_date !== undefined ? input.start_date : dayOf(before.start_date);
  const end = input.end_date !== undefined ? input.end_date : dayOf(before.end_date);
  if (start && end && end < start) return { error: 'bad_dates' };
  const { start_date, end_date, ...rest } = input;
  await prisma.zxPropertyLoan.update({ where: { id: loanId }, data: { ...rest, ...(start_date !== undefined ? { start_date: toDate(start_date) } : {}), ...(end_date !== undefined ? { end_date: toDate(end_date) } : {}) } });
  const after = await prisma.zxPropertyLoan.findUnique({ where: { id: loanId } });
  await writeAudit(null, { orgId, actorId, entity: 'property_loan', entityId: loanId, action: 'update', before: { outstanding: num(before.outstanding_amount), emi: num(before.emi_amount), status: before.status }, after: { outstanding: num(after.outstanding_amount), emi: num(after.emi_amount), status: after.status } });
  return get(orgId, ctx, propertyId);
}

async function removeLoan(orgId, actorId, ctx, propertyId, loanId) {
  const before = await prisma.zxPropertyLoan.findFirst({ where: { id: loanId, property_id: propertyId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxPropertyLoan.update({ where: { id: loanId }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'property_loan', entityId: loanId, action: 'delete', before: { lender: before.lender, loan_amount: num(before.loan_amount) } });
  return get(orgId, ctx, propertyId);
}

// ---- valuation (manual only; never touches the P&L) ----
async function syncLatestValuation(orgId, propertyId) {
  const latest = await prisma.zxPropertyValuation.findFirst({ where: { org_id: orgId, property_id: propertyId, unit_id: null }, orderBy: [{ as_of: 'desc' }, { created_at: 'desc' }] });
  await prisma.zxProperty.update({ where: { id: propertyId }, data: latest ? { valuation: latest.value, valuation_date: latest.as_of, valuation_notes: latest.notes } : { valuation: null, valuation_date: null, valuation_notes: null } });
}

async function addValuation(orgId, actorId, ctx, propertyId, input) {
  if (!(await liveProperty(orgId, propertyId))) return { error: 'not_found' };
  if (input.as_of > todayStr()) return { error: 'future_valuation' };
  if (input.unit_id) {
    const unit = await prisma.zxPropertyUnit.findFirst({ where: { id: input.unit_id, property_id: propertyId, org_id: orgId, deleted_at: null } });
    if (!unit) return { error: 'not_found' };
  }
  const row = await prisma.zxPropertyValuation.create({ data: { org_id: orgId, property_id: propertyId, unit_id: input.unit_id || null, value: input.value, as_of: toDate(input.as_of), notes: input.notes || null, created_by: actorId } });
  if (input.unit_id) await prisma.zxPropertyUnit.update({ where: { id: input.unit_id }, data: { valuation: input.value, valuation_date: toDate(input.as_of) } });
  else await syncLatestValuation(orgId, propertyId);
  await addEvent(prisma, orgId, actorId, { property_id: propertyId, unit_id: input.unit_id || null, kind: 'valuation', event_date: input.as_of, title: 'Valuation updated (manual)', amount: input.value, notes: input.notes, source_type: 'valuation', source_id: row.id });
  await writeAudit(null, { orgId, actorId, entity: 'property_valuation', entityId: row.id, action: 'create', after: { property_id: propertyId, unit_id: input.unit_id || null, value: input.value, as_of: input.as_of } });
  return get(orgId, ctx, propertyId);
}

async function removeValuation(orgId, actorId, ctx, propertyId, valuationId) {
  const row = await prisma.zxPropertyValuation.findFirst({ where: { id: valuationId, property_id: propertyId, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.zxPropertyValuation.delete({ where: { id: valuationId } });
  if (row.unit_id) {
    const latest = await prisma.zxPropertyValuation.findFirst({ where: { org_id: orgId, unit_id: row.unit_id }, orderBy: [{ as_of: 'desc' }, { created_at: 'desc' }] });
    await prisma.zxPropertyUnit.update({ where: { id: row.unit_id }, data: latest ? { valuation: latest.value, valuation_date: latest.as_of } : { valuation: null, valuation_date: null } });
  } else await syncLatestValuation(orgId, propertyId);
  await writeAudit(null, { orgId, actorId, entity: 'property_valuation', entityId: valuationId, action: 'delete', before: { value: num(row.value), as_of: dayOf(row.as_of) } });
  return get(orgId, ctx, propertyId);
}

// ---- timeline notes ----
async function addNote(orgId, actorId, ctx, propertyId, input) {
  if (!(await liveProperty(orgId, propertyId))) return { error: 'not_found' };
  if (input.amount !== null && input.amount !== undefined && !ctx.canFinance) return { error: 'finance_only' };
  await addEvent(prisma, orgId, actorId, { property_id: propertyId, unit_id: input.unit_id, kind: input.kind, event_date: input.event_date, title: input.title, amount: input.amount, notes: input.notes });
  return get(orgId, ctx, propertyId);
}

module.exports = {
  PROPERTY_TYPES, PROPERTY_STATUSES, UNIT_STATUSES, FINANCE_FIELDS, EVENT_KINDS,
  createPropertySchema, updatePropertySchema, listQuerySchema, unitCreateSchema, unitUpdateSchema, loanCreateSchema, loanUpdateSchema, valuationSchema, eventSchema,
  addEvent, cashFlowFor, propertyOut, liveProperty,
  list, summary, rentableUnits, get, create, update, remove, addUnit, updateUnit, removeUnit, addLoan, updateLoan, removeLoan, addValuation, removeValuation, addNote,
};
