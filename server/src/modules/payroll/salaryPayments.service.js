const prisma = require('../../config/db');
const live = require('../calculations/live.service');

const MONTH_CONCURRENCY = 3;
const MAX_MONTHS = 24;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v == null ? 0 : Number(v));
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
const monthAt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const nowMonth = (now = new Date()) => now.toISOString().slice(0, 7);

const paymentOut = (p) => (p ? {
  id: p.id,
  paid_on: ymd(p.paid_on),
  amount_paid: num(p.amount_paid),
  payment_mode: p.payment_mode,
  transaction_id: p.transaction_id,
  bank_name: p.bank_name,
  notes: p.notes,
  updated_at: p.updated_at,
} : null);

// The salary dashboard: one row per employee per month (from -> to, default the last 6 months) with the final
// payable salary and whether it has been paid. Filter by status, employee, department and team.
async function dashboard(orgId, q, now = new Date()) {
  const to = q.to || nowMonth(now);
  const from = q.from || monthAt(monthIdx(to) - 5);
  if (from > to || monthIdx(to) - monthIdx(from) + 1 > MAX_MONTHS) return { error: 'bad_range' };
  const keys = [];
  for (let i = monthIdx(from); i <= monthIdx(to); i += 1) keys.push(monthAt(i));

  const filters = { org_membership_id: q.org_membership_id, department_id: q.department_id, team_id: q.team_id };
  const monthLines = async (key) => {
    const [year, month] = key.split('-').map(Number);
    const result = await live.salaryLive(orgId, { period_month: month, period_year: year, ...filters }, now);
    return { key, source: result.source, lines: result.lines };
  };
  const months = [];
  for (let i = 0; i < keys.length; i += MONTH_CONCURRENCY) months.push(...(await Promise.all(keys.slice(i, i + MONTH_CONCURRENCY).map(monthLines))));

  const payments = await prisma.salaryPayment.findMany({
    where: {
      org_id: orgId,
      OR: keys.map((k) => ({ period_year: Number(k.slice(0, 4)), period_month: Number(k.slice(5)) })),
      ...(q.org_membership_id ? { org_membership_id: q.org_membership_id } : {}),
    },
  });
  const paidBy = new Map(payments.map((p) => [`${p.org_membership_id}:${p.period_year}-${String(p.period_month).padStart(2, '0')}`, p]));

  const all = [];
  for (const m of months) {
    for (const l of m.lines) {
      const pay = paidBy.get(`${l.org_membership_id}:${m.key}`);
      all.push({
        id: `${l.org_membership_id}:${m.key}`,
        org_membership_id: l.org_membership_id,
        month: m.key,
        period_month: Number(m.key.slice(5)),
        period_year: Number(m.key.slice(0, 4)),
        employee: l.name,
        employee_code: l.employee_code || null,
        department: l.department || null,
        payable: round2(l.net),
        figures: m.source === 'locked' || l.source === 'locked' ? 'locked' : 'live',
        status: pay ? 'paid' : 'not_paid',
        payment: paymentOut(pay),
      });
    }
  }
  const rows = (q.status === 'all' ? all : all.filter((r) => r.status === q.status)).sort((a, b) => (a.month === b.month ? a.employee.localeCompare(b.employee) : b.month.localeCompare(a.month)));

  const totalsOf = (list) => {
    const paid = list.filter((r) => r.status === 'paid');
    const unpaid = list.filter((r) => r.status === 'not_paid');
    return {
      salaries: list.length,
      payable: round2(list.reduce((s, r) => s + r.payable, 0)),
      paid_count: paid.length,
      paid_amount: round2(paid.reduce((s, r) => s + (r.payment?.amount_paid ?? r.payable), 0)),
      not_paid_count: unpaid.length,
      not_paid_amount: round2(unpaid.reduce((s, r) => s + r.payable, 0)),
    };
  };
  const by_month = [...keys].reverse().map((key) => ({ month: key, ...totalsOf(rows.filter((r) => r.month === key)) }));
  return { from, to, status: q.status, totals: totalsOf(rows), by_month, rows };
}

// Mark a salary paid (with the transaction details) or not paid. Idempotent per employee and month.
async function save(orgId, admin, input, now = new Date()) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: input.org_membership_id, org_id: orgId }, select: { id: true } });
  if (!membership) return { error: 'membership_not_found' };
  const where = { org_membership_id_period_year_period_month: { org_membership_id: input.org_membership_id, period_year: input.period_year, period_month: input.period_month } };
  const before = await prisma.salaryPayment.findUnique({ where });
  const audit = (action, snapshot, reason) => prisma.auditLog.create({ data: { org_id: orgId, actor_id: admin.id, action, entity_type: 'salary_payment', entity_id: before?.id || input.org_membership_id, reason, snapshot } });

  if (input.status === 'not_paid') {
    if (!before) return { payment: null };
    await prisma.salaryPayment.delete({ where: { id: before.id } });
    await audit('salary_payment_clear', { period: `${input.period_year}-${input.period_month}`, before: paymentOut(before) }, input.notes || 'Marked not paid');
    return { payment: null };
  }
  if (!input.paid_on) return { error: 'paid_on_required' };
  if (input.paid_on > now.toISOString().slice(0, 10)) return { error: 'future_paid_on' };
  // Without an amount the payment is the month's final payable salary.
  let amount = input.amount_paid;
  if (amount === undefined) {
    const line = (await live.salaryLive(orgId, { period_month: input.period_month, period_year: input.period_year, org_membership_id: input.org_membership_id }, now)).lines[0];
    amount = round2(line?.net || 0);
  }
  const data = {
    paid_on: new Date(`${input.paid_on}T00:00:00.000Z`),
    amount_paid: amount,
    payment_mode: input.payment_mode || null,
    transaction_id: input.transaction_id,
    bank_name: input.bank_name,
    notes: input.notes,
    updated_by: admin.id,
  };
  const row = before
    ? await prisma.salaryPayment.update({ where: { id: before.id }, data })
    : await prisma.salaryPayment.create({ data: { org_id: orgId, org_membership_id: input.org_membership_id, period_month: input.period_month, period_year: input.period_year, ...data } });
  await audit(before ? 'salary_payment_update' : 'salary_payment_create', { period: `${input.period_year}-${input.period_month}`, before: paymentOut(before), after: paymentOut(row) }, input.notes || 'Marked paid');
  return { payment: paymentOut(row) };
}

module.exports = { dashboard, save };
