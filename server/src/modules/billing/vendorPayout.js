const ExcelJS = require('exceljs');
const prisma = require('../../config/db');
const invoices = require('./invoices.service');

// Bank payout of vendor invoices, the same idea as the reimbursement payout: one row per vendor (and currency) with the bank
// details saved on the vendor record and the net payable of their UNPAID invoices for the chosen month, so finance can hand one
// file to the bank. Read only; invoice, TDS and net-payable figures come from the vendor invoices untouched. A vendor with no
// bank account number or IFSC is flagged and left out of the Excel (never silently dropped from the screen).
// "Pending" = not paid. With `sent_only` it is narrowed to invoices already marked sent to the vendor.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const round2 = (n) => Math.round(n * 100) / 100;
const monthLabel = (m, y) => `${MONTHS[m - 1]} ${y}`;

async function payoutData(orgId, { period_month, period_year, sent_only = false }) {
  const all = await invoices.listVendorInvoices(orgId, { period_month, period_year });
  const pending = all.filter((i) => !i.paid && (!sent_only || i.sent));
  const vendorIds = [...new Set(pending.map((i) => i.vendor_account_id))];
  const vendors = vendorIds.length
    ? await prisma.account.findMany({ where: { id: { in: vendorIds }, org_id: orgId }, select: { id: true, name: true, vendor_bank_holder: true, vendor_bank_name: true, vendor_bank_account_number: true, vendor_bank_ifsc: true } })
    : [];
  const byVendor = new Map(vendors.map((v) => [v.id, v]));
  const byKey = new Map();
  for (const i of pending) {
    const v = byVendor.get(i.vendor_account_id) || {};
    const key = `${i.vendor_account_id}|${i.currency}`;
    const row = byKey.get(key) || {
      vendor_account_id: i.vendor_account_id,
      vendor: v.name || i.vendor_account?.name || '',
      account_holder: v.vendor_bank_holder || '',
      bank_name: v.vendor_bank_name || '',
      bank_account_number: v.vendor_bank_account_number || '',
      bank_ifsc: v.vendor_bank_ifsc || '',
      bank_missing: !v.vendor_bank_account_number || !v.vendor_bank_ifsc,
      invoices: 0,
      amount: 0,
      currency: i.currency,
    };
    row.invoices += 1;
    row.amount = round2(row.amount + i.net_payable);
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.currency.localeCompare(b.currency));
  const totals = new Map();
  for (const r of rows) totals.set(r.currency, round2((totals.get(r.currency) || 0) + r.amount));
  const payable = new Map();
  for (const r of rows) if (!r.bank_missing) payable.set(r.currency, round2((payable.get(r.currency) || 0) + r.amount));
  return {
    period_month,
    period_year,
    sent_only,
    rows,
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
    excel_totals: [...payable].map(([currency, amount]) => ({ currency, amount })),
    bank_missing_count: rows.filter((r) => r.bank_missing).length,
  };
}

const COLUMNS = [
  { header: 'Vendor', key: 'vendor', width: 28 },
  { header: 'Account Holder', key: 'account_holder', width: 26 },
  { header: 'Bank', key: 'bank_name', width: 22 },
  { header: 'Account Number', key: 'bank_account_number', width: 24 },
  { header: 'IFSC Code', key: 'bank_ifsc', width: 16 },
  { header: 'Invoices', key: 'invoices', width: 10 },
  { header: 'Amount', key: 'amount', width: 16 },
  { header: 'Currency', key: 'currency', width: 10 },
];

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }; });
}

/** Sheet 1 goes to the bank (only vendors with bank details, a total per currency); sheet 2 lists vendors left out for missing details. */
async function payoutWorkbook(orgId, query) {
  const data = await payoutData(orgId, query);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Vendor payout');
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getCell(1, 1).value = `Vendor payout - ${monthLabel(data.period_month, data.period_year)}`;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  styleHeader(sheet.addRow(COLUMNS.map((c) => c.header)));
  for (const r of data.rows.filter((x) => !x.bank_missing)) sheet.addRow(COLUMNS.map((c) => r[c.key]));
  for (const t of data.excel_totals) {
    const row = sheet.addRow(COLUMNS.map((c) => (c.key === 'vendor' ? `Total (${t.currency})` : c.key === 'amount' ? t.amount : c.key === 'currency' ? t.currency : '')));
    row.font = { bold: true };
  }
  sheet.views = [{ state: 'frozen', ySplit: 2 }];

  const missing = data.rows.filter((r) => r.bank_missing);
  if (missing.length) {
    const ws = wb.addWorksheet('Missing bank details');
    ws.columns = [{ key: 'vendor', width: 28 }, { key: 'invoices', width: 10 }, { key: 'amount', width: 16 }, { key: 'currency', width: 10 }];
    ws.addRow(['These vendors are NOT in the payout sheet: add their bank account number and IFSC on the vendor record.']).font = { bold: true };
    styleHeader(ws.addRow(['Vendor', 'Invoices', 'Amount', 'Currency']));
    for (const r of missing) ws.addRow([r.vendor, r.invoices, r.amount, r.currency]);
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { payoutData, payoutWorkbook };
