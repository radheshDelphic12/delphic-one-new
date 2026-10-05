// Finance views built on Live Analytics:
//   - the month-wise project view: pick a month, see every project that was running in it with its client,
//     billing type, contract type, assigned resources, logged hours, billing amount, invoice / payment status and financial
//     (lock) status - to reconcile  Active projects -> Timesheet -> Billing -> Invoice -> Payment -> Financial status;
//   - the Sales and Salary month-wise Excel exports.

const ExcelJS = require('exceljs');
const prisma = require('../../config/db');
const live = require('./live.service');
const calculations = require('./calculations.service');
const billingEngine = require('./engines/billing.engine');
const invoiceStatus = require('./invoiceStatus');
const { round2, monthBounds } = require('./period');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (month, year) => `${MONTH_NAMES[month - 1]} ${year}`;

// Projects whose assignment (resource allocation) overlaps the month, with the people on them.
async function assignedResources(orgId, month, year) {
  const { start, end } = monthBounds(month, year);
  const rows = await prisma.projectMemberAssignment.findMany({
    where: {
      org_id: orgId,
      AND: [{ OR: [{ start_date: null }, { start_date: { lte: end } }] }, { OR: [{ end_date: null }, { end_date: { gte: start } }] }],
    },
    select: { account_id: true, org_membership_id: true, org_membership: { select: { person: { select: { name: true } } } } },
  });
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.account_id)) byProject.set(r.account_id, new Map());
    byProject.get(r.account_id).set(r.org_membership_id, r.org_membership?.person?.name || 'Unknown');
  }
  return byProject;
}

async function monthLockCounts(orgId, month, year) {
  const rows = await prisma.timesheetMonthLock.findMany({ where: { org_id: orgId, period_month: month, period_year: year }, select: { org_membership_id: true } });
  return new Set(rows.map((r) => r.org_membership_id));
}

const { billingTypeOf } = invoiceStatus;

/**
 * Month-wise project view for Finance. `active` = the project was running in the month: an agreement
 * period overlapping it, people allocated to it, or hours / billing in it.
 */
async function monthProjects(orgId, { period_month, period_year }, now = new Date()) {
  const period = { period_month, period_year };
  const { start, end } = monthBounds(period_month, period_year);
  const [overview, accounts, assigned, lockedMembers, financials] = await Promise.all([
    live.billingOverview(orgId, live.billingQuerySchema.parse({ period_month, period_year }), now),
    billingEngine.listProjects(orgId, {}),
    assignedResources(orgId, period_month, period_year),
    monthLockCounts(orgId, period_month, period_year),
    calculations.findCalc(orgId, 'financials', 'org', period),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const financialStatus = financials?.status || 'open';
  const rows = [];
  for (const row of overview.projects) {
    const account = accountById.get(row.project.id);
    const people = assigned.get(row.project.id) || new Map();
    // The project's own start / end dates decide whether it belongs to the month. A project that ended before
    // the month (or starts after it) is never listed, whoever is still allocated to it. Only a project with no
    // dates at all falls back to "people allocated, hours or billing in the month".
    const hasDates = Boolean(account?.agreement_start_date || account?.agreement_end_date);
    const hours = row.totals.approved_hours + row.totals.pending_hours;
    const active = hasDates
      ? billingEngine.overlapsMonth(account, start, end)
      : people.size > 0 || hours > 0 || row.totals.final_amount !== 0;
    if (!active) continue;
    const lockedCount = [...people.keys()].filter((id) => lockedMembers.has(id)).length;
    const invoice = row.invoice || invoiceStatus.describe(null);
    const calcStatus = row.lock?.status || 'draft';
    rows.push({
      account_id: row.project.id,
      project: row.project.name,
      project_code: row.project.code,
      client: row.project.client_name,
      // Manage Services / Projects (ReqType). Null when the project has no category yet.
      service_category: row.project.service_category || null,
      billing_type: billingTypeOf(row),
      assigned_resources: [...people.values()].sort(),
      resources_count: people.size,
      logged_hours: row.totals.approved_hours + row.totals.pending_hours + row.totals.rejected_hours === 0 ? 0 : round2(row.totals.approved_hours + row.totals.pending_hours),
      approved_hours: row.totals.approved_hours,
      pending_hours: row.totals.pending_hours,
      billing_amount: row.amount,
      currency: row.currency,
      amount_inr: row.amount_inr,
      invoice,
      payment_status: !invoice.generated ? 'no_invoice' : invoice.paid ? 'paid' : 'unpaid',
      financial_status: {
        timesheet_locked: `${lockedCount}/${people.size}`,
        calculation: calcStatus,
        financial: financialStatus,
      },
      source: row.source,
      attention: [
        ...(!invoice.generated && row.amount > 0 ? ['invoice_not_generated'] : []),
        ...(invoice.generated && !invoice.sent ? ['invoice_not_sent'] : []),
        ...(invoice.generated && !invoice.paid ? ['payment_pending'] : []),
        ...(row.readiness && !row.readiness.can_lock ? ['billing_blocked'] : []),
      ],
    });
  }
  rows.sort((a, b) => a.project.localeCompare(b.project));
  return {
    period_month,
    period_year,
    label: monthLabel(period_month, period_year),
    financial_status: financialStatus,
    projects: rows,
    totals: {
      projects: rows.length,
      logged_hours: round2(rows.reduce((s, r) => s + r.logged_hours, 0)),
      amount_inr: round2(rows.reduce((s, r) => s + (r.amount_inr || 0), 0)),
      ...invoiceStatus.summarize(rows.map((r) => r.invoice)),
    },
  };
}

// --- Sales export ---------------------------------------------------------

// One row per resource per project for the month (or one project row where nobody logged anything).
async function salesRows(orgId, { period_month, period_year, client_account_id, account_id, billing_type, invoice_status }, now = new Date()) {
  const query = live.billingQuerySchema.parse({ period_month, period_year, client_account_id, account_id, billing_type, invoice_status });
  const overview = await live.billingOverview(orgId, query, now);
  const rows = [];
  for (const p of overview.projects) {
    const invoice = p.invoice || invoiceStatus.describe(null);
    const base = {
      month: monthLabel(p.period_month, p.period_year),
      project: p.project.name,
      client: p.project.client_name || '',
      invoice_number: invoice.number || '',
      invoice_date: invoice.date || '',
      invoice_status: invoice.generated ? invoice.status : 'not generated',
      sent_status: invoice.generated ? (invoice.sent ? 'sent' : 'unsent') : '',
      payment_status: invoice.generated ? (invoice.paid ? 'paid' : 'unpaid') : '',
      currency: p.currency,
      source: p.source,
    };
    if (!p.resources.length) {
      // Nothing billed, nobody on it and no invoice: the project was not running that month.
      if (!p.amount && !invoice.generated) continue;
      rows.push({ ...base, resource: '', billing_type: p.billing_type || '', billing_amount: p.amount, hours: 0 });
      continue;
    }
    for (const r of p.resources) {
      const own = (p.resource_rates || []).find((x) => x.org_membership_id === r.org_membership_id);
      rows.push({ ...base, resource: r.name, billing_type: own?.rate_type || p.billing_type || '', billing_amount: r.amount, hours: round2(r.regular_hours + r.overtime_hours) });
    }
    if (p.adjustment_amount) rows.push({ ...base, resource: 'Adjustments', billing_type: '', billing_amount: p.adjustment_amount, hours: 0 });
  }
  return rows;
}

const SALES_COLUMNS = [
  { header: 'Month', key: 'month', width: 16 },
  { header: 'Project', key: 'project', width: 28 },
  { header: 'Client', key: 'client', width: 26 },
  { header: 'Resource', key: 'resource', width: 24 },
  { header: 'Billing type', key: 'billing_type', width: 14 },
  { header: 'Hours', key: 'hours', width: 10 },
  { header: 'Billing amount', key: 'billing_amount', width: 16 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Invoice number', key: 'invoice_number', width: 18 },
  { header: 'Invoice date', key: 'invoice_date', width: 14 },
  { header: 'Invoice status', key: 'invoice_status', width: 16 },
  { header: 'Sent', key: 'sent_status', width: 10 },
  { header: 'Payment status', key: 'payment_status', width: 16 },
  { header: 'Figures', key: 'source', width: 10 },
];

// --- Salary export --------------------------------------------------------

async function salaryRows(orgId, { period_month, period_year, department_id, team_id }, now = new Date()) {
  const result = await live.salaryLive(orgId, { period_month, period_year, department_id, team_id }, now);
  return result.lines.map((l) => {
    const a = l.adjustments || {};
    return {
      employee: l.name,
      employee_code: l.employee_code || '',
      department: l.department || '',
      salary: l.base_net ?? l.net,
      tds: a.tds || 0,
      ot: round2((l.ot_amount || 0) + (a.ot_adjustment || 0)),
      reimbursements: a.reimbursement || 0,
      variable_pay: a.variable_pay || 0,
      other_additions: a.other_additions || 0,
      deductions: round2((l.deductions || 0) + (a.other_deductions || 0)),
      final_payable: l.net,
      figures: l.source || 'live',
    };
  });
}

// --- Vendor export: vendor billing -> invoice -> TDS / adjustments -> payment tracking -----------------

async function vendorRows(orgId, { period_month, period_year }) {
  const invoices = require('../billing/invoices.service');
  const list = await invoices.listVendorInvoices(orgId, { period_month, period_year });
  return list.map((i) => ({
    month: monthLabel(i.period_month, i.period_year),
    vendor: i.vendor_account?.name || '',
    project: i.project?.name || i.account?.project_name || i.account?.name || '',
    invoice_number: i.invoice_number || '',
    invoice_date: i.invoice_date || '',
    amount: i.amount,
    tds: i.tds_amount,
    adjustment: i.adjustment_amount,
    net_payable: i.net_payable,
    currency: i.currency,
    sent_status: i.sent ? 'sent' : 'unsent',
    payment_status: i.paid ? 'paid' : 'unpaid',
    notes: i.adjustment_note || i.notes || '',
  }));
}

const VENDOR_COLUMNS = [
  { header: 'Month', key: 'month', width: 16 },
  { header: 'Vendor', key: 'vendor', width: 26 },
  { header: 'Project', key: 'project', width: 28 },
  { header: 'Invoice number', key: 'invoice_number', width: 18 },
  { header: 'Invoice date', key: 'invoice_date', width: 14 },
  { header: 'Amount', key: 'amount', width: 14 },
  { header: 'TDS', key: 'tds', width: 12 },
  { header: 'Adjustment', key: 'adjustment', width: 14 },
  { header: 'Net payable', key: 'net_payable', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Sent', key: 'sent_status', width: 10 },
  { header: 'Payment', key: 'payment_status', width: 12 },
  { header: 'Notes', key: 'notes', width: 30 },
];

const SALARY_COLUMNS = [
  { header: 'Employee', key: 'employee', width: 26 },
  { header: 'Code', key: 'employee_code', width: 12 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Salary', key: 'salary', width: 14 },
  { header: 'TDS', key: 'tds', width: 12 },
  { header: 'OT', key: 'ot', width: 12 },
  { header: 'Reimbursements', key: 'reimbursements', width: 16 },
  { header: 'Variable pay', key: 'variable_pay', width: 14 },
  { header: 'Other additions', key: 'other_additions', width: 16 },
  { header: 'Deductions', key: 'deductions', width: 14 },
  { header: 'Final payable', key: 'final_payable', width: 16 },
  { header: 'Figures', key: 'figures', width: 10 },
];

// Excel workbook with one sheet: title, header, rows (+ a totals row for the numeric columns).
async function workbook({ title, sheetName, columns, rows, totals = [] }) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ key: c.key, width: c.width }));
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  const header = sheet.addRow(columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }; });
  for (const r of rows) sheet.addRow(columns.map((c) => r[c.key]));
  if (totals.length) {
    const sums = columns.map((c) => (totals.includes(c.key) ? round2(rows.reduce((s, r) => s + Number(r[c.key] || 0), 0)) : ''));
    sums[0] = 'Total';
    const t = sheet.addRow(sums);
    t.font = { bold: true };
  }
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  return wb.xlsx.writeBuffer();
}

async function salesWorkbook(orgId, q, now) {
  const rows = await salesRows(orgId, q, now);
  return workbook({ title: `Sales - ${monthLabel(q.period_month, q.period_year)}`, sheetName: 'Sales', columns: SALES_COLUMNS, rows, totals: ['hours', 'billing_amount'] });
}

async function salaryWorkbook(orgId, q, now) {
  const rows = await salaryRows(orgId, q, now);
  return workbook({ title: `Salary - ${monthLabel(q.period_month, q.period_year)}`, sheetName: 'Salary', columns: SALARY_COLUMNS, rows, totals: ['salary', 'tds', 'ot', 'reimbursements', 'variable_pay', 'other_additions', 'deductions', 'final_payable'] });
}

async function vendorWorkbook(orgId, q) {
  const rows = await vendorRows(orgId, q);
  return workbook({ title: `Vendor billing - ${monthLabel(q.period_month, q.period_year)}`, sheetName: 'Vendor', columns: VENDOR_COLUMNS, rows, totals: ['amount', 'tds', 'adjustment', 'net_payable'] });
}

module.exports = { monthProjects, salesRows, salaryRows, vendorRows, salesWorkbook, salaryWorkbook, vendorWorkbook, SALES_COLUMNS, SALARY_COLUMNS, monthLabel };
