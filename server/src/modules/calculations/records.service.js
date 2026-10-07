// Per-record finance locks, read side (Live Analytics → Locked, Expenses
// records, and Financials).
//
//   Live Analytics — unlocked / projected figures, each record lockable:
//     billing per project, salary per employee, vendor billing per vendor,
//     each expense record (approved claim or group charge).
//   Locked        — every locked record with what it was locked from.
//   Financials    — ONLY locked records by default (state=locked); the
//     Unlocked / All filters add what is still live, clearly marked.
// Older month-wide locks (salary / vendor payments for the whole org) still
// count as locked for the people / vendors without their own lock.

const prisma = require('../../config/db');
const exchangeRates = require('../billing/exchangeRates.service');
const billingEngine = require('./engines/billing.engine');
const salaryEngine = require('./engines/salary.engine');
const vendorEngine = require('./engines/vendorPayment.engine');
const calculations = require('./calculations.service');
const { userNames } = require('../../lib/vertical');
const { round2, ymd, monthBounds, liveAsOf, todayIst } = require('./period');

const LEGACY_KINDS = ['salary', 'vendor_payment'];

// --- Expense records of a month (Live Analytics → Expenses) -------------------

async function monthExpenseRows(orgId, { period_month, period_year }) {
  const { start, end } = monthBounds(period_month, period_year);
  const endExclusive = new Date(end.getTime() + 86400000);
  const [claims, charges] = await Promise.all([
    prisma.expenseClaim.findMany({
      where: {
        org_id: orgId,
        status: { in: ['approved', 'reimbursed'] },
        OR: [{ expense_date: { gte: start, lte: end } }, { expense_date: null, created_at: { gte: start, lt: endExclusive } }],
      },
      include: { org_membership: { select: { employee_code: true, person: { select: { name: true } } } }, location: { select: { name: true } }, category_ref: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    }),
    prisma.groupBillingCharge.findMany({
      where: { org_id: orgId, OR: [{ payment_date: { gte: start, lte: end } }, { payment_date: null, period_month, period_year }] },
      include: { category: { select: { name: true } }, location: { select: { name: true } } },
      orderBy: { created_at: 'asc' },
    }),
  ]);
  return [
    ...claims.map((c) => ({
      scope_key: `claim:${c.id}`,
      type: 'claim',
      id: c.id,
      category: c.category_ref?.name || c.category,
      description: c.description || null,
      person: c.org_membership?.person?.name || null,
      employee_code: c.org_membership?.employee_code || null,
      location: c.location?.name || null,
      date: ymd(c.expense_date || c.created_at),
      status: c.status,
      amount: Number(c.amount),
      currency: c.currency,
    })),
    ...charges.map((g) => ({
      scope_key: `charge:${g.id}`,
      type: 'charge',
      id: g.id,
      category: g.category?.name || g.kind,
      description: g.notes || null,
      person: null,
      employee_code: null,
      location: g.location?.name || null,
      date: ymd(g.payment_date || new Date(Date.UTC(g.period_year, g.period_month - 1, 1))),
      status: 'recorded',
      amount: Number(g.amount),
      currency: g.currency,
    })),
  ];
}

function lockOf(rec) {
  return rec ? { status: rec.status, version: rec.version, locked_at: rec.calc.locked_at, locked_by: rec.calc.locked_by } : { status: 'draft', version: 0 };
}

// The month's expense records with their lock state; a locked record shows
// its locked figures.
async function expenseRecords(orgId, period) {
  const [rows, locked, fx] = await Promise.all([monthExpenseRows(orgId, period), calculations.lockedRecords(orgId, 'expense', period), exchangeRates.inrRates(orgId)]);
  const out = rows.map((r) => {
    const rec = locked.get(r.scope_key);
    const record = rec?.snapshot?.record ? { ...r, ...rec.snapshot.record, scope_key: r.scope_key } : r;
    const rate = rec ? rec.snapshot.record?.exchange_rate ?? null : fx.has(r.currency) ? fx.get(r.currency) : null;
    return { ...record, exchange_rate: rate, amount_inr: rec ? rec.amount : rate === null ? null : round2(r.amount * rate), lock: lockOf(rec) };
  });
  // A locked record whose source changed month / was removed still shows.
  for (const [key, rec] of locked) {
    if (out.some((r) => r.scope_key === key)) continue;
    const rr = rec.snapshot?.record;
    if (rr) out.push({ ...rr, scope_key: key, amount_inr: rec.amount, lock: lockOf(rec), source_changed: true });
  }
  const sum = (list) => round2(list.reduce((s, r) => s + (r.amount_inr || 0), 0));
  return {
    ...period,
    records: out,
    totals: {
      amount_inr: sum(out),
      locked_inr: sum(out.filter((r) => r.lock.status !== 'draft')),
      unlocked_inr: sum(out.filter((r) => r.lock.status === 'draft')),
      locked: out.filter((r) => r.lock.status !== 'draft').length,
      records: out.length,
    },
  };
}

// --- Locked section ------------------------------------------------------------

function salaryLineSummary(l) {
  if (!l) return null;
  const b = l.breakdown || {};
  return {
    employee: { id: l.org_membership_id, name: l.name, employee_code: l.employee_code || null, department: l.department || null, team: l.team || null, is_it: Boolean(l.is_it) },
    ctc: l.ctc,
    gross: l.gross,
    deductions: l.deductions,
    net: l.net,
    ot_amount: l.ot_amount || 0,
    breakdown: {
      working_days: b.working_days ?? null,
      shift_hours: b.shift_hours ?? null,
      expected_hours: b.expected_hours ?? null,
      paid_hours: b.paid_hours ?? null,
      deficit_hours: b.deficit_hours ?? null,
      ot_approved_hours: b.ot_approved_hours ?? null,
      hourly_rate: b.hourly_rate ?? null,
    },
  };
}

function vendorLineSummary(l) {
  return {
    contractor: l.contractor,
    project: l.project,
    currency: l.currency,
    monthly_vendor_rate: l.monthly_vendor_rate,
    allocation_percent: l.allocation_percent,
    working_days: l.working_days,
    contract_working_days: l.contract_working_days ?? null,
    approved_hours: l.approved_hours,
    overtime_hours: l.overtime_hours,
    base_amount: l.base_amount,
    overtime_amount: l.overtime_amount,
    amount: l.amount,
    amount_inr: l.amount_inr,
  };
}

// What a locked record is, from its snapshot (never recomputed).
function summarize(kind, snapshot, amount, fx) {
  if (kind === 'billing') {
    const details = billingEngine.invoiceDetails(snapshot);
    const rate = snapshot.exchange_rate ?? (fx.has(snapshot.currency) ? fx.get(snapshot.currency) : null);
    return {
      project: snapshot.project,
      details,
      amount: details.amount,
      currency: snapshot.currency,
      exchange_rate: rate,
      amount_inr: snapshot.amount_inr ?? (rate === null ? null : round2(details.amount * rate)),
      inr_at_lock: snapshot.amount_inr !== undefined && snapshot.amount_inr !== null,
    };
  }
  if (kind === 'salary_employee') {
    const s = salaryLineSummary(snapshot.lines?.[0]);
    return { ...s, amount: amount, currency: 'INR', amount_inr: amount };
  }
  if (kind === 'vendor_bill') {
    const v = snapshot.vendors?.[0];
    return { vendor: v?.vendor || null, contractors: v?.contractors || [], by_currency: v?.by_currency || {}, lines: (snapshot.lines || []).map(vendorLineSummary), amount, currency: 'INR', amount_inr: amount, missing_rates: snapshot.missing_rates || [] };
  }
  if (kind === 'expense') {
    const r = snapshot.record || {};
    return { record: r, amount: r.amount, currency: r.currency, exchange_rate: r.exchange_rate ?? null, amount_inr: amount };
  }
  if (kind === 'salary') return { employees: snapshot.totals?.employees ?? (snapshot.lines || []).length, lines: (snapshot.lines || []).map(salaryLineSummary), amount, currency: 'INR', amount_inr: amount };
  if (kind === 'vendor_payment') return { vendors: (snapshot.vendors || []).map((v) => ({ vendor: v.vendor, amount_inr: v.amount_inr, by_currency: v.by_currency })), lines: (snapshot.lines || []).map(vendorLineSummary), amount, currency: 'INR', amount_inr: amount };
  return { amount, currency: 'INR', amount_inr: amount };
}

const LOCKED_KIND_LABEL = { billing: 'Billing', salary_employee: 'Salary', vendor_bill: 'Vendor', expense: 'Expense', salary: 'Salary (whole month)', vendor_payment: 'Vendors (whole month)' };

// Every locked record of a year (optionally one month / kind), newest first,
// with what it was locked from and its invoice where one exists.
async function lockedList(orgId, { period_year, period_month, kind } = {}) {
  const kinds = kind ? [kind] : [...calculations.RECORD_KINDS, ...LEGACY_KINDS];
  const calcs = await prisma.financialCalculation.findMany({
    where: { org_id: orgId, kind: { in: kinds }, status: { in: calculations.FROZEN_STATUSES }, ...(period_year ? { period_year } : {}), ...(period_month ? { period_month } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { locked_at: 'desc' }],
  });
  if (!calcs.length) return [];
  const [versions, fx] = await Promise.all([
    prisma.financialCalculationVersion.findMany({ where: { OR: calcs.map((c) => ({ calculation_id: c.id, version: c.current_version })) } }),
    exchangeRates.inrRates(orgId),
  ]);
  const byCalc = new Map(versions.map((v) => [v.calculation_id, v]));
  const billingCalcs = calcs.filter((c) => c.kind === 'billing');
  const vendorCalcs = calcs.filter((c) => c.kind === 'vendor_bill');
  const [clientInvoices, vendorInvoices, names] = await Promise.all([
    billingCalcs.length
      ? prisma.clientInvoice.findMany({ where: { org_id: orgId, OR: billingCalcs.map((c) => ({ client_account_id: c.scope_key, period_month: c.period_month, period_year: c.period_year })) }, select: { id: true, client_account_id: true, period_month: true, period_year: true, invoice_number: true, status: true, amount: true, currency: true } })
      : [],
    vendorCalcs.length
      ? prisma.projectVendorInvoice.findMany({ where: { org_id: orgId, OR: vendorCalcs.map((c) => ({ vendor_account_id: c.scope_key, period_month: c.period_month, period_year: c.period_year })) }, select: { id: true, vendor_account_id: true, period_month: true, period_year: true, invoice_number: true, amount: true, currency: true, details: true } })
      : [],
    userNames(calcs.map((c) => c.locked_by)),
  ]);
  return calcs.filter((c) => byCalc.has(c.id)).map((c) => {
    const v = byCalc.get(c.id);
    const summary = summarize(c.kind, v.snapshot, Number(v.amount), fx);
    const sameMonth = (r) => r.period_month === c.period_month && r.period_year === c.period_year;
    const invoice = c.kind === 'billing' ? clientInvoices.find((i) => i.client_account_id === c.scope_key && sameMonth(i)) || null : null;
    return {
      id: c.id,
      kind: c.kind,
      kind_label: LOCKED_KIND_LABEL[c.kind] || c.kind,
      scope_key: c.scope_key,
      scope_label: c.scope_label,
      period_month: c.period_month,
      period_year: c.period_year,
      status: c.status,
      version: c.current_version,
      locked_at: c.locked_at,
      locked_by: c.locked_by ? names.get(c.locked_by) || { id: c.locked_by } : null,
      amount: summary.amount,
      currency: summary.currency,
      amount_inr: summary.amount_inr,
      summary,
      invoice: invoice ? { ...invoice, amount: Number(invoice.amount) } : null,
      vendor_invoices: c.kind === 'vendor_bill' ? vendorInvoices.filter((i) => i.vendor_account_id === c.scope_key && sameMonth(i)).map((i) => ({ ...i, amount: Number(i.amount) })) : [],
    };
  });
}

// --- Financials: locked records (default), unlocked, or both -----------------

function leaf(key, label, amount, locked) {
  return { key, label, amount: round2(amount), locked_amount: locked ? round2(amount) : 0, unlocked_amount: locked ? 0 : round2(amount), children: [] };
}

// Sums leaves with the same key (the same project / employee / category
// across months) and builds a parent node.
function group(key, label, leaves) {
  const map = new Map();
  for (const l of leaves) {
    const t = map.get(l.key) || { ...l, amount: 0, locked_amount: 0, unlocked_amount: 0, children: [] };
    t.amount = round2(t.amount + l.amount);
    t.locked_amount = round2(t.locked_amount + l.locked_amount);
    t.unlocked_amount = round2(t.unlocked_amount + l.unlocked_amount);
    map.set(l.key, t);
  }
  const children = [...map.values()].sort((a, b) => b.amount - a.amount);
  const sum = (k) => round2(children.reduce((s, c) => s + c[k], 0));
  return { key, label, amount: sum('amount'), locked_amount: sum('locked_amount'), unlocked_amount: sum('unlocked_amount'), children };
}

function parent(key, label, nodes) {
  const sum = (k) => round2(nodes.reduce((s, c) => s + c[k], 0));
  return { key, label, amount: sum('amount'), locked_amount: sum('locked_amount'), unlocked_amount: sum('unlocked_amount'), children: nodes };
}

const monthIdx = (y, m) => y * 12 + (m - 1);

async function financialRecords(orgId, { period_year, from_month = 1, to_month = 12, state = 'locked' }, now = new Date()) {
  const wantLocked = state !== 'unlocked';
  const wantLive = state !== 'locked';
  const fx = await exchangeRates.inrRates(orgId);
  const missing = new Set();
  const toInr = (amount, currency) => {
    const cur = currency || 'INR';
    if (!fx.has(cur)) { missing.add(cur); return 0; }
    return round2(Number(amount || 0) * fx.get(cur));
  };
  const today = todayIst(now);
  const nowIdx = monthIdx(today.getUTCFullYear(), today.getUTCMonth() + 1);

  const revenue = [];
  const fixedRevenue = [];
  const salaries = { it: [], nonIt: [] };
  const claims = [];
  const charges = [];
  const vendors = [];
  const counts = { locked: { billing: 0, salary: 0, expense: 0, vendor: 0 }, unlocked: { billing: 0, salary: 0, expense: 0, vendor: 0 } };
  const months = [];
  let projects = null;

  for (let m = from_month; m <= to_month; m += 1) {
    const period = { period_month: m, period_year };
    const [billing, salary, expense, vendor, orgSalary, orgVendor] = await Promise.all([
      calculations.lockedRecords(orgId, 'billing', period),
      calculations.lockedRecords(orgId, 'salary_employee', period),
      calculations.lockedRecords(orgId, 'expense', period),
      calculations.lockedRecords(orgId, 'vendor_bill', period),
      calculations.lockedVersion(orgId, 'salary', 'org', period),
      calculations.lockedVersion(orgId, 'vendor_payment', 'org', period),
    ]);
    const monthCounts = { locked: 0, unlocked: 0 };
    const addSalary = (line, locked) => {
      const node = leaf(`employee:${line.org_membership_id}`, line.name, line.net, locked);
      (line.is_it ? salaries.it : salaries.nonIt).push(node);
    };
    const addExpense = (r, amountInr, locked) => {
      const node = leaf(`${r.type}:${r.category || 'Uncategorised'}`, r.category || 'Uncategorised', amountInr, locked);
      (r.type === 'charge' ? charges : claims).push(node);
    };

    if (wantLocked) {
      for (const [, rec] of billing) {
        const amountInr = rec.snapshot.amount_inr ?? toInr(rec.amount, rec.currency);
        (rec.snapshot.fixed_bid ? fixedRevenue : revenue).push(leaf(`project:${rec.calc.scope_key}`, rec.calc.scope_label || rec.snapshot.project?.name || 'Project', amountInr, true));
        counts.locked.billing += 1;
        monthCounts.locked += 1;
      }
      for (const [, rec] of salary) {
        const line = rec.snapshot.lines?.[0];
        if (!line) continue;
        addSalary(line, true);
        counts.locked.salary += 1;
        monthCounts.locked += 1;
      }
      // A whole-month salary lock covers everyone without their own lock.
      if (orgSalary) {
        for (const line of orgSalary.snapshot.lines || []) {
          if (salary.has(line.org_membership_id)) continue;
          addSalary(line, true);
          counts.locked.salary += 1;
          monthCounts.locked += 1;
        }
      }
      for (const [, rec] of vendor) {
        const v = rec.snapshot.vendors?.[0];
        vendors.push(leaf(`vendor:${rec.calc.scope_key}`, v?.vendor?.name || rec.calc.scope_label || 'Vendor', rec.amount, true));
        counts.locked.vendor += 1;
        monthCounts.locked += 1;
      }
      if (orgVendor) {
        for (const v of orgVendor.snapshot.vendors || []) {
          if (!v.vendor || vendor.has(v.vendor.id)) continue;
          vendors.push(leaf(`vendor:${v.vendor.id}`, v.vendor.name, v.amount_inr, true));
          counts.locked.vendor += 1;
          monthCounts.locked += 1;
        }
      }
      for (const [, rec] of expense) {
        const r = rec.snapshot.record;
        if (!r) continue;
        addExpense(r, rec.amount, true);
        counts.locked.expense += 1;
        monthCounts.locked += 1;
      }
    }

    // Live (unlocked) records only for months that have started.
    if (wantLive && monthIdx(period_year, m) <= nowIdx) {
      projects = projects || (await billingEngine.listProjects(orgId, {}));
      for (const account of projects) {
        if (billing.has(account.id)) continue;
        const raw = await billingEngine.computeProjectMonth(orgId, account, period, now);
        if (!raw?.supported) continue;
        const amount = billingEngine.lockedAmount(raw);
        if (!amount) continue;
        (raw.fixed_bid ? fixedRevenue : revenue).push(leaf(`project:${account.id}`, `${raw.project.code ? `${raw.project.code} · ` : ''}${raw.project.name}`, toInr(amount, raw.currency), false));
        counts.unlocked.billing += 1;
        monthCounts.unlocked += 1;
      }
      if (!orgSalary) {
        const result = await salaryEngine.computeSalary(orgId, { ...period, asOf: liveAsOf(m, period_year, now) });
        for (const line of result.lines) {
          if (salary.has(line.org_membership_id)) continue;
          addSalary(line, false);
          counts.unlocked.salary += 1;
          monthCounts.unlocked += 1;
        }
      }
      if (!orgVendor) {
        const result = await vendorEngine.computeVendorPayments(orgId, period);
        for (const v of result.vendors) {
          if (!v.vendor || vendor.has(v.vendor.id) || !v.amount_inr) continue;
          vendors.push(leaf(`vendor:${v.vendor.id}`, v.vendor.name, v.amount_inr, false));
          counts.unlocked.vendor += 1;
          monthCounts.unlocked += 1;
        }
      }
      for (const r of await monthExpenseRows(orgId, period)) {
        if (expense.has(r.scope_key)) continue;
        addExpense(r, toInr(r.amount, r.currency), false);
        counts.unlocked.expense += 1;
        monthCounts.unlocked += 1;
      }
    }
    months.push({ ...period, locked_records: monthCounts.locked, unlocked_records: monthCounts.unlocked });
  }

  const revenueNode = parent('revenue', 'Revenue / Sales', [group('managed_services', 'Managed Services Revenue', revenue), group('fixed_price', 'Project Revenue (fixed price)', fixedRevenue)]);
  const salariesNode = parent('salaries', 'Salaries', [group('it_salaries', 'IT Salaries', salaries.it), group('non_it_salaries', 'Non-IT Salaries', salaries.nonIt)]);
  const expensesNode = parent('expenses', 'Expenses', [
    group('group_charges', 'Group Charges', charges),
    group('reimbursements', 'Employee Reimbursements', claims),
    group('vendor_payments', 'Vendor Payments', vendors),
  ]);
  const totals = {
    revenue: revenueNode.amount,
    salaries: salariesNode.amount,
    expenses: expensesNode.amount,
    profit: round2(revenueNode.amount - salariesNode.amount - expensesNode.amount),
  };
  return { state, period_year, from_month, to_month, months, categories: [revenueNode, salariesNode, expensesNode], totals, counts, missing_rates: [...missing] };
}

module.exports = { expenseRecords, lockedList, financialRecords, summarize, monthExpenseRows };
