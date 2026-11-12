const ExcelJS = require('exceljs');
const prisma = require('../../config/db');
const { claimFilterWhere } = require('./expenses.service');

// Bank payout of reimbursements, the same idea as the salary export: one row per employee with the bank account saved on their
// profile (Settings -> My details) and the total of their claims for the chosen month (by expense date) and status, so finance
// can hand one file to the bank. Read only - claims keep their status until they are marked reimbursed.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const round2 = (n) => Math.round(n * 100) / 100;
const monthLabel = (m, y) => `${MONTHS[m - 1]} ${y}`;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

async function payoutData(orgId, { status = 'approved', period_month, period_year }) {
  const claims = await prisma.expenseClaim.findMany({
    where: { org_id: orgId, status, ...(await claimFilterWhere(orgId, { period_month, period_year })) },
    orderBy: [{ expense_date: 'asc' }, { created_at: 'asc' }],
    include: {
      category_ref: { select: { name: true } },
      org_membership: { select: { id: true, employee_code: true, bank_account_number: true, bank_ifsc: true, person: { select: { name: true } }, department: { select: { name: true } } } },
    },
  });
  // one row per employee and currency (a bank payout is normally all INR; another currency stays on its own row)
  const byKey = new Map();
  const details = [];
  for (const c of claims) {
    const m = c.org_membership;
    const key = `${c.org_membership_id}|${c.currency}`;
    const row = byKey.get(key) || {
      org_membership_id: c.org_membership_id,
      employee: m?.person?.name || '',
      employee_code: m?.employee_code || '',
      department: m?.department?.name || '',
      bank_account_number: m?.bank_account_number || '',
      bank_ifsc: m?.bank_ifsc || '',
      bank_missing: !m?.bank_account_number || !m?.bank_ifsc,
      claims: 0,
      amount: 0,
      currency: c.currency,
    };
    row.claims += 1;
    row.amount = round2(row.amount + Number(c.amount));
    byKey.set(key, row);
    details.push({
      employee: row.employee,
      date: ymd(c.expense_date || c.created_at),
      category: c.category_ref?.name || c.category,
      description: c.description || '',
      amount: Number(c.amount),
      currency: c.currency,
      status: c.status,
    });
  }
  const rows = [...byKey.values()].sort((a, b) => a.employee.localeCompare(b.employee) || a.currency.localeCompare(b.currency));
  const totals = new Map();
  for (const r of rows) totals.set(r.currency, round2((totals.get(r.currency) || 0) + r.amount));
  return {
    period_month,
    period_year,
    status,
    rows,
    details,
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
    bank_missing_count: rows.filter((r) => r.bank_missing).length,
  };
}

const SUMMARY_COLUMNS = [
  { header: 'Employee', key: 'employee', width: 26 },
  { header: 'Code', key: 'employee_code', width: 12 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Account Number', key: 'bank_account_number', width: 24 },
  { header: 'IFSC Code', key: 'bank_ifsc', width: 16 },
  { header: 'Claims', key: 'claims', width: 10 },
  { header: 'Amount', key: 'amount', width: 16 },
  { header: 'Currency', key: 'currency', width: 10 },
];
const DETAIL_COLUMNS = [
  { header: 'Employee', key: 'employee', width: 26 },
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Amount', key: 'amount', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Status', key: 'status', width: 12 },
];

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }; });
}

/** The Excel file: sheet 1 is what goes to the bank (one row per employee, a total per currency), sheet 2 lists every claim behind it. */
async function payoutWorkbook(orgId, query) {
  const data = await payoutData(orgId, query);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Bank payout');
  sheet.columns = SUMMARY_COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  sheet.mergeCells(1, 1, 1, SUMMARY_COLUMNS.length);
  sheet.getCell(1, 1).value = `Reimbursement payout - ${monthLabel(data.period_month, data.period_year)} (${data.status})`;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  styleHeader(sheet.addRow(SUMMARY_COLUMNS.map((c) => c.header)));
  for (const r of data.rows) sheet.addRow(SUMMARY_COLUMNS.map((c) => r[c.key]));
  for (const t of data.totals) {
    const row = sheet.addRow(SUMMARY_COLUMNS.map((c) => (c.key === 'employee' ? `Total (${t.currency})` : c.key === 'amount' ? t.amount : c.key === 'currency' ? t.currency : '')));
    row.font = { bold: true };
  }
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  const detail = wb.addWorksheet('Claims');
  detail.columns = DETAIL_COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  styleHeader(detail.addRow(DETAIL_COLUMNS.map((c) => c.header)));
  for (const d of data.details) detail.addRow(DETAIL_COLUMNS.map((c) => d[c.key]));
  detail.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}

module.exports = { payoutData, payoutWorkbook };
