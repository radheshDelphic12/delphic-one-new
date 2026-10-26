const { z } = require('zod');
const prisma = require('../../config/db');
const calc = require('./groupDebt.calc');
const groupFinance = require('./groupFinance.service');

// Group debt management for the Super Admin: loans and credit limits of the group and its companies, their repayment schedules, and
// how total debt stands against the group's size (the loan ratio limit). Everything shown is worked out from the schedule rows.

const LOAN_TYPES = ['bank_loan', 'business_loan', 'property_loan', 'vehicle_loan', 'credit_limit', 'other'];
const BASES = ['valuation', 'assets', 'revenue'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dateOrNull = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const optNum = (min, max) => z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().min(min).max(max).nullable().optional());

const loanFields = {
  name: z.string().trim().min(1).max(200),
  lender: z.string().trim().min(1).max(200),
  loan_type: z.enum(LOAN_TYPES),
  org_id: uuidOrNull,
  collateral: text(300),
  principal: z.coerce.number().positive().max(1e13),
  interest_rate: z.coerce.number().min(0).max(100),
  rate_type: z.enum(['fixed', 'floating']),
  start_date: dateStr,
  tenure_months: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(600).nullable().optional()),
  emi_amount: optNum(0, 1e12),
  emi_frequency: z.enum(calc.FREQUENCIES),
  sanctioned_limit: optNum(0, 1e13),
  status: z.enum(['active', 'closed']),
  notes: text(4000),
  first_due_date: dateOrNull,
};
const createSchema = z.object({
  ...loanFields,
  loan_type: loanFields.loan_type.default('bank_loan'),
  interest_rate: loanFields.interest_rate.default(0),
  rate_type: loanFields.rate_type.default('fixed'),
  emi_frequency: loanFields.emi_frequency.default('monthly'),
  status: loanFields.status.default('active'),
  // an existing loan: how many instalments have already been paid
  emis_paid: z.coerce.number().int().min(0).max(600).default(0),
});
const updateSchema = z.object(loanFields).partial();
const installmentSchema = z.object({ paid: z.boolean(), paid_on: dateOrNull, paid_amount: optNum(0, 1e13), note: text(300) });
const settingsSchema = z.object({ max_debt_ratio_pct: z.coerce.number().min(0).max(1000), ratio_basis: z.enum(BASES) });

const n = (v) => (v == null ? null : Number(v));
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
const stepOf = (frequency) => 12 / calc.PER_YEAR[frequency];
const periodsOf = (months, frequency) => Math.max(1, Math.ceil(months / stepOf(frequency)));
const SCHEDULE_FIELDS = ['principal', 'interest_rate', 'tenure_months', 'emi_amount', 'emi_frequency', 'start_date', 'first_due_date'];

async function companyIds(groupIds, orgId) {
  const orgs = await prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true } });
  return { orgs, ok: !orgId || orgs.some((o) => o.id === orgId) };
}

function scheduleOf(loan, firstDue) {
  if (!loan.tenure_months || loan.loan_type === 'credit_limit') return [];
  return calc.buildSchedule({
    principal: n(loan.principal), annualRatePct: n(loan.interest_rate), periods: periodsOf(loan.tenure_months, loan.emi_frequency), frequency: loan.emi_frequency,
    startDate: day(loan.start_date), firstDue: firstDue || undefined, emi: n(loan.emi_amount) || undefined,
  });
}
const rowData = (loanId, r, paid) => ({
  loan_id: loanId, seq: r.seq, due_date: toDate(r.due_date), amount: r.amount, principal_part: r.principal_part, interest_part: r.interest_part, balance_after: r.balance_after,
  ...(paid ? { status: 'paid', paid_on: paid.paid_on ? toDate(paid.paid_on) : toDate(r.due_date), paid_amount: paid.paid_amount ?? r.amount } : {}),
});

async function create(groupIds, actorId, input) {
  const { orgs, ok } = await companyIds(groupIds, input.org_id);
  if (!ok) return { error: 'company_not_in_group' };
  const { emis_paid: emisPaid, first_due_date: firstDue, ...rest } = input;
  const rows = scheduleOf({ ...rest, start_date: input.start_date }, firstDue);
  if (emisPaid > rows.length) return { error: 'invalid', message: `Only ${rows.length} instalments exist for this tenure` };
  const loan = await prisma.$transaction(async (tx) => {
    const created = await tx.groupLoan.create({ data: { org_group_id: groupIds[0], created_by: actorId, ...rest, start_date: toDate(rest.start_date) } });
    if (rows.length) await tx.groupLoanInstallment.createMany({ data: rows.map((r) => rowData(created.id, r, r.seq <= emisPaid ? {} : null)) });
    return created;
  });
  return get(groupIds, loan.id, orgs);
}

// A change to the money terms rebuilds the schedule: the same number of instalments stay paid. A change of the rate alone (a floating
// loan) only rebuilds what is still to pay, from the outstanding balance, over the instalments that are left.
async function update(groupIds, actorId, id, input) {
  const before = await prisma.groupLoan.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { installments: { orderBy: { seq: 'asc' } } } });
  if (!before) return { error: 'not_found' };
  const { ok } = await companyIds(groupIds, input.org_id);
  if (!ok) return { error: 'company_not_in_group' };
  const { first_due_date: firstDue, ...rest } = input;
  const changed = (k) => input[k] !== undefined && String(input[k] ?? '') !== String(k === 'start_date' ? day(before.start_date) : before[k] ?? '');
  const termsChanged = SCHEDULE_FIELDS.filter((k) => k !== 'interest_rate').some(changed) || (input.first_due_date !== undefined);
  const rateChanged = changed('interest_rate');
  await prisma.$transaction(async (tx) => {
    await tx.groupLoan.update({ where: { id }, data: { ...rest, ...(rest.start_date ? { start_date: toDate(rest.start_date) } : {}) } });
    const now = await tx.groupLoan.findUnique({ where: { id } });
    const paidRows = before.installments.filter((r) => r.status === 'paid');
    if (termsChanged) {
      await tx.groupLoanInstallment.deleteMany({ where: { loan_id: id } });
      const rows = scheduleOf(now, firstDue);
      const paidBySeq = new Map(paidRows.map((r) => [r.seq, r]));
      if (rows.length) await tx.groupLoanInstallment.createMany({ data: rows.map((r) => rowData(id, r, paidBySeq.has(r.seq) ? { paid_on: day(paidBySeq.get(r.seq).paid_on) } : null)) });
    } else if (rateChanged && before.installments.length) {
      const pending = before.installments.filter((r) => r.status !== 'paid');
      if (pending.length) {
        const lastPaid = paidRows.length ? paidRows[paidRows.length - 1] : null;
        const balance = lastPaid ? n(lastPaid.balance_after) : n(now.principal);
        const rows = calc.buildSchedule({ principal: balance, annualRatePct: n(now.interest_rate), periods: pending.length, frequency: now.emi_frequency, startDate: day(now.start_date), firstDue: day(pending[0].due_date) });
        await tx.groupLoanInstallment.deleteMany({ where: { loan_id: id, status: { not: 'paid' } } });
        await tx.groupLoanInstallment.createMany({ data: rows.map((r) => rowData(id, { ...r, seq: r.seq + paidRows.length }, null)) });
      }
    }
  });
  return get(groupIds, id);
}

async function remove(groupIds, id) {
  const row = await prisma.groupLoan.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, select: { id: true } });
  if (!row) return { error: 'not_found' };
  await prisma.groupLoan.update({ where: { id }, data: { deleted_at: new Date() } });
  return { ok: true };
}

// Paying an instalment pays every earlier one too; undoing one undoes every later one, so "outstanding" always follows the schedule.
async function setInstallment(groupIds, id, seq, input) {
  const loan = await prisma.groupLoan.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { installments: true } });
  if (!loan) return { error: 'not_found' };
  const row = loan.installments.find((r) => r.seq === seq);
  if (!row) return { error: 'installment_not_found' };
  if (input.paid) {
    const earlier = loan.installments.filter((r) => r.seq <= seq && r.status !== 'paid');
    await prisma.$transaction(earlier.map((r) => prisma.groupLoanInstallment.update({
      where: { id: r.id },
      data: { status: 'paid', paid_on: toDate(r.seq === seq && input.paid_on ? input.paid_on : day(r.due_date)), paid_amount: r.seq === seq && input.paid_amount != null ? input.paid_amount : r.amount, ...(r.seq === seq && input.note !== undefined ? { note: input.note } : {}) },
    })));
  } else {
    await prisma.groupLoanInstallment.updateMany({ where: { loan_id: id, seq: { gte: seq } }, data: { status: 'pending', paid_on: null, paid_amount: null } });
  }
  return get(groupIds, id);
}

function shape(loan, orgName, today) {
  const rows = (loan.installments || []).map((r) => ({ ...r, due_date: day(r.due_date), paid_on: day(r.paid_on), amount: n(r.amount), principal_part: n(r.principal_part), interest_part: n(r.interest_part), balance_after: n(r.balance_after), paid_amount: n(r.paid_amount) }));
  const { installments, ...rest } = loan;
  void installments;
  const summary = calc.summarise({ principal: n(loan.principal) }, rows, today);
  const closed = loan.status === 'closed' || (rows.length > 0 && summary.emis_pending === 0);
  return {
    ...rest, source: 'group', principal: n(loan.principal), interest_rate: n(loan.interest_rate), emi_amount: n(loan.emi_amount), sanctioned_limit: n(loan.sanctioned_limit),
    start_date: day(loan.start_date), company: loan.org_id ? { id: loan.org_id, name: orgName || null } : null,
    summary: { ...summary, outstanding: closed ? 0 : summary.outstanding, closed },
    installments: rows,
  };
}

const perMonth = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

async function get(groupIds, id, orgsKnown) {
  const loan = await prisma.groupLoan.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { installments: { orderBy: { seq: 'asc' } } } });
  if (!loan) return { error: 'not_found' };
  const orgs = orgsKnown || (await companyIds(groupIds)).orgs;
  return { loan: shape(loan, orgs.find((o) => o.id === loan.org_id)?.name, todayIst()) };
}

async function settingsOf(groupIds) {
  const row = await prisma.groupDebtSetting.findUnique({ where: { org_group_id: groupIds[0] } });
  return { max_debt_ratio_pct: row ? n(row.max_debt_ratio_pct) : 30, ratio_basis: row?.ratio_basis || 'valuation' };
}

async function saveSettings(groupIds, actorId, input) {
  await prisma.groupDebtSetting.upsert({ where: { org_group_id: groupIds[0] }, update: { ...input, updated_by: actorId }, create: { org_group_id: groupIds[0], ...input, updated_by: actorId } });
  return settingsOf(groupIds);
}

function bucket(list, keyOf) {
  const m = new Map();
  for (const l of list) {
    const k = keyOf(l);
    const e = m.get(k) || { key: k, loans: 0, outstanding: 0, monthly_emi: 0 };
    e.loans += 1;
    e.outstanding = calc.round2(e.outstanding + l.summary.outstanding);
    e.monthly_emi = calc.round2(e.monthly_emi + (l.monthly_emi || 0));
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.outstanding - a.outstanding);
}

/** Everything the Debt Management tab shows. */
async function overview(groupIds, query = {}) {
  const today = todayIst();
  const [loans, { orgs }, settings] = await Promise.all([
    prisma.groupLoan.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null, ...(query.org_id ? { org_id: query.org_id } : {}) }, include: { installments: { orderBy: { seq: 'asc' } } }, orderBy: [{ status: 'asc' }, { start_date: 'desc' }] }),
    companyIds(groupIds),
    settingsOf(groupIds),
  ]);
  const orgName = (id) => orgs.find((o) => o.id === id)?.name;
  const list = loans.map((l) => {
    const s = shape(l, orgName(l.org_id), today);
    const monthly = s.summary.closed || l.status === 'closed' ? 0 : s.emi_amount != null ? s.emi_amount * perMonth[l.emi_frequency] : s.installments[0] ? s.installments[0].amount * perMonth[l.emi_frequency] : 0;
    return { ...s, monthly_emi: calc.round2(monthly) };
  });

  // property loans kept inside Zephyr are part of the group's debt too (read only here; edit them in Zephyr)
  const zx = await prisma.zxPropertyLoan.findMany({ where: { org_id: { in: orgs.map((o) => o.id) }, deleted_at: null, status: 'active', ...(query.org_id ? { org_id: query.org_id } : {}) }, include: { property: { select: { name: true } } } });
  for (const p of zx) {
    const monthly = n(p.emi_amount) * perMonth[p.emi_frequency || 'monthly'];
    list.push({
      id: `zx-${p.id}`, source: 'zephyr_property', name: `${p.property?.name || 'Property'} loan`, lender: p.lender || '-', loan_type: 'property_loan', rate_type: 'fixed',
      principal: n(p.loan_amount), interest_rate: n(p.interest_rate) ?? 0, emi_amount: n(p.emi_amount), emi_frequency: p.emi_frequency || 'monthly', start_date: day(p.start_date), status: 'active',
      company: { id: p.org_id, name: orgName(p.org_id) || null }, collateral: p.property?.name || null, notes: 'Managed in the Zephyr property module (read only here).', installments: [],
      summary: { emis_total: 0, emis_paid: 0, emis_pending: 0, emis_overdue: 0, outstanding: n(p.outstanding_amount) || 0, principal_paid: calc.round2(Math.max(0, n(p.loan_amount) - (n(p.outstanding_amount) || 0))), interest_paid: 0, interest_remaining: 0, total_remaining: 0, next_due: null, end_date: day(p.end_date), progress_pct: null, closed: false },
      monthly_emi: calc.round2(monthly),
    });
  }

  const active = list.filter((l) => !l.summary.closed && l.status !== 'closed');
  const outstanding = calc.round2(active.reduce((a, l) => a + l.summary.outstanding, 0));
  const totals = {
    loans: active.length,
    closed: list.length - active.length,
    sanctioned: calc.round2(active.reduce((a, l) => a + (l.sanctioned_limit || l.principal), 0)),
    outstanding,
    principal_paid: calc.round2(active.reduce((a, l) => a + l.summary.principal_paid, 0)),
    interest_paid: calc.round2(active.reduce((a, l) => a + l.summary.interest_paid, 0)),
    interest_remaining: calc.round2(active.reduce((a, l) => a + l.summary.interest_remaining, 0)),
    monthly_emi: calc.round2(active.reduce((a, l) => a + (l.monthly_emi || 0), 0)),
    weighted_rate: outstanding > 0 ? Math.round((active.reduce((a, l) => a + l.summary.outstanding * (l.interest_rate || 0), 0) / outstanding) * 100) / 100 : null,
    overdue_emis: active.reduce((a, l) => a + l.summary.emis_overdue, 0),
    next_due: active.map((l) => (l.summary.next_due ? { ...l.summary.next_due, loan: l.name } : null)).filter(Boolean).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0] || null,
  };

  // what falls due in the next 12 months, from the pending rows
  const months = [];
  const [ty, tm] = today.split('-').map(Number);
  for (let i = 0; i < 12; i += 1) months.push(`${ty + Math.floor((tm - 1 + i) / 12)}-${String(((tm - 1 + i) % 12) + 1).padStart(2, '0')}`);
  const repayments = months.map((m) => {
    const rows = active.flatMap((l) => l.installments).filter((r) => r.status !== 'paid' && r.due_date.slice(0, 7) === m);
    return { month: m, principal: calc.round2(rows.reduce((a, r) => a + r.principal_part, 0)), interest: calc.round2(rows.reduce((a, r) => a + r.interest_part, 0)), total: calc.round2(rows.reduce((a, r) => a + r.amount, 0)) };
  });

  // the loan ratio: total outstanding debt against the group's valuation, assets or yearly revenue (the last 12 months of the Group Finance figures)
  let base = null;
  let profit = null;
  try {
    const fin = (await groupFinance.overview(groupIds, {})).totals;
    base = settings.ratio_basis === 'assets' ? fin.assets : settings.ratio_basis === 'revenue' ? fin.revenue : fin.valuation;
    profit = fin.profit;
  } catch { base = null; }
  const r = calc.ratio(outstanding, base, settings.max_debt_ratio_pct);
  const yearlyInterest = calc.round2(active.reduce((a, l) => a + l.summary.outstanding * ((l.interest_rate || 0) / 100), 0));
  return {
    loans: list,
    totals,
    by_type: bucket(active, (l) => l.loan_type),
    by_company: bucket(active, (l) => l.company?.name || 'Group'),
    by_lender: bucket(active, (l) => l.lender),
    repayments,
    settings,
    ratio: { ...r, basis: settings.ratio_basis, base_amount: base, debt: outstanding, limit_pct: settings.max_debt_ratio_pct, yearly_interest: yearlyInterest, interest_cover: profit != null && yearlyInterest > 0 ? Math.round((profit / yearlyInterest) * 100) / 100 : null },
    companies: orgs,
  };
}

module.exports = { LOAN_TYPES, createSchema, updateSchema, installmentSchema, settingsSchema, create, update, remove, setInstallment, get, overview, saveSettings };
