const ExcelJS = require('exceljs');
const prisma = require('../../config/db');

// Processed reimbursements: every claim marked reimbursed in a date range, with when it was filed, approved and paid
// (reimbursed_at is stamped by expenses.service.reimburseClaim and cleared again when the reimbursement is undone).
// Dates are IST days, like the rest of the app.

const DAY_MS = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const istDay = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
const dayCount = (a, b) => Math.max(0, Math.round((new Date(`${istDay(b)}T00:00:00Z`) - new Date(`${istDay(a)}T00:00:00Z`)) / DAY_MS));

async function processedData(orgId, { from, to, org_membership_id }) {
  const claims = await prisma.expenseClaim.findMany({
    where: {
      org_id: orgId,
      status: 'reimbursed',
      reimbursed_at: { not: null, ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}) },
      ...(org_membership_id ? { org_membership_id } : {}),
    },
    orderBy: [{ reimbursed_at: 'desc' }, { created_at: 'desc' }],
    include: {
      category_ref: { select: { name: true } },
      decider: { select: { name: true } },
      org_membership: { select: { employee_code: true, person: { select: { name: true } } } },
    },
  });
  const rows = claims.map((c) => ({
    id: c.id,
    employee: c.org_membership?.person?.name || '',
    employee_code: c.org_membership?.employee_code || '',
    category: c.category_ref?.name || c.category,
    description: c.description || '',
    expense_date: ymd(c.expense_date),
    submitted_on: istDay(c.created_at),
    approved_on: istDay(c.decided_at),
    approved_by: c.decider?.name || '',
    processed_on: istDay(c.reimbursed_at),
    processed_at: c.reimbursed_at,
    days_to_process: dayCount(c.created_at, c.reimbursed_at),
    amount: Number(c.amount),
    currency: c.currency,
  }));
  const totals = new Map();
  for (const r of rows) totals.set(r.currency, round2((totals.get(r.currency) || 0) + r.amount));
  return {
    from: from || null,
    to: to || null,
    rows,
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
    average_days: rows.length ? round2(rows.reduce((s, r) => s + r.days_to_process, 0) / rows.length) : 0,
  };
}

const COLUMNS = [
  { header: 'Processed on', key: 'processed_on', width: 14 },
  { header: 'Employee', key: 'employee', width: 26 },
  { header: 'Code', key: 'employee_code', width: 12 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Expense date', key: 'expense_date', width: 14 },
  { header: 'Submitted on', key: 'submitted_on', width: 14 },
  { header: 'Approved on', key: 'approved_on', width: 14 },
  { header: 'Approved by', key: 'approved_by', width: 22 },
  { header: 'Days to process', key: 'days_to_process', width: 16 },
  { header: 'Amount', key: 'amount', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
];

async function processedWorkbook(orgId, query) {
  const data = await processedData(orgId, query);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Processed reimbursements');
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getCell(1, 1).value = `Processed reimbursements${data.from || data.to ? ` - ${data.from || 'start'} to ${data.to || 'today'}` : ''}`;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  const header = sheet.addRow(COLUMNS.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }; });
  for (const r of data.rows) sheet.addRow(COLUMNS.map((c) => r[c.key]));
  for (const t of data.totals) {
    const row = sheet.addRow(COLUMNS.map((c) => (c.key === 'employee' ? `Total (${t.currency})` : c.key === 'amount' ? t.amount : c.key === 'currency' ? t.currency : '')));
    row.font = { bold: true };
  }
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  return wb.xlsx.writeBuffer();
}

module.exports = { processedData, processedWorkbook };
