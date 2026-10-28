const PDFDocument = require('pdfkit');

// CSV and PDF files of a wallet's entries and of the receipts report. Plain text and pdfkit (already a dependency).

// A cell that starts like a formula is prefixed so a spreadsheet never runs it.
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => `${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

// What a bank prints in the Particulars column: who the money came from / went to, else what it was for.
const particulars = (r) => r.party || r.category || (r.reference_type === 'transfer' ? 'Transfer' : '');

function entriesCsv(data) {
  const head = [['Wallet', data.wallet.name], ['Owner', data.wallet.owner_name], ['Bank account', [data.wallet.bank_account_name, data.wallet.legal_entity_name && `(${data.wallet.legal_entity_name})`].filter(Boolean).join(' ')], ['Currency', data.wallet.currency], ['Period', `${data.from || 'start'} to ${data.to || 'today'}`], ['Opening balance', data.opening_balance], []];
  // laid out like a bank statement: Debit = money out, Credit = money in, a running balance, opening and closing rows
  const table = [['Date', 'Particulars', 'Wallet', 'Mode', 'Reference', 'Notes', 'Debit (out)', 'Credit (in)', 'Balance'],
    [data.from || '', 'Opening balance', '', '', '', '', '', '', data.opening_balance],
    ...data.rows.map((r) => [r.date, particulars(r), r.wallet || '', r.mode, r.reference_type, r.notes, r.direction === 'out' ? r.amount : '', r.direction === 'in' ? r.amount : '', r.balance_after]),
    [data.to || '', 'Closing balance', '', '', '', '', data.total_out, data.total_in, data.closing_balance]];
  const modes = [[], ['Mode', 'In', 'Out', 'Entries'], ...Object.entries(data.by_mode).map(([m, v]) => [m, v.in, v.out, v.count])];
  return csv([...head, ...table, [], ['Total credits (in)', data.total_in], ['Total debits (out)', data.total_out], ['Closing balance', data.closing_balance], ...modes]);
}

function receiptsCsv(data) {
  return csv([['Date', 'Company', 'Wallet', 'Bank account', 'Currency', 'Amount', 'Mode', 'Party', 'Category', 'Notes'],
    ...data.rows.map((r) => [r.date, r.owner_name, r.wallet, r.bank_account, r.currency, r.amount, r.mode, r.party, r.category, r.notes])]);
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function entriesPdf(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });
  doc.fontSize(15).text(`${data.wallet.name} - ${data.wallet.owner_name}`);
  doc.fontSize(9).fillColor('#555').text(`${[data.wallet.bank_account_name, data.wallet.legal_entity_name && `(${data.wallet.legal_entity_name})`].filter(Boolean).join(' ')} - ${data.wallet.currency} - ${data.from || 'start'} to ${data.to || 'today'}`).fillColor('#000').moveDown(0.5);
  doc.fontSize(10).text(`Opening ${data.opening_balance}   In ${data.total_in}   Out ${data.total_out}   Closing ${data.closing_balance}`).moveDown(0.5);
  const cols = [['Date', 62], ['Particulars', 210], ['Mode', 46], ['Notes', 150], ['Debit (out)', 84], ['Credit (in)', 84], ['Balance', 96]];
  const row = (values, bold) => {
    if (doc.y > doc.page.height - 60) doc.addPage();
    let x = doc.page.margins.left;
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    values.forEach((v, i) => { doc.text(String(v ?? ''), x, y, { width: cols[i][1] - 4, height: 11, ellipsis: true, lineBreak: false }); x += cols[i][1]; });
    doc.y = y + 13;
  };
  row(cols.map((c) => c[0]), true);
  row([data.from || '', 'Opening balance', '', '', '', '', data.opening_balance], true);
  for (const r of data.rows) row([r.date, [particulars(r), r.wallet].filter(Boolean).join(' - '), r.mode, r.notes, r.direction === 'out' ? r.amount : '', r.direction === 'in' ? r.amount : '', r.balance_after]);
  row([data.to || '', 'Closing balance', '', '', data.total_out, data.total_in, data.closing_balance], true);
  doc.moveDown().font('Helvetica-Bold').fontSize(9).text('By mode');
  for (const [m, v] of Object.entries(data.by_mode)) doc.font('Helvetica').text(`${m}: in ${v.in}, out ${v.out} (${v.count} entries)`);
  return toBuffer(doc);
}

function paymentsCsv(data) {
  return csv([['Date', 'Company', 'Type', 'In / out', 'Amount', 'Currency', 'Rate to INR', 'INR value', 'Bank charges', 'Other deductions', 'Deduction note', 'Net', 'Wallet', 'Notes'],
    ...data.rows.map((r) => [r.paid_on, r.company, r.label, r.direction, r.amount, r.currency, r.exchange_rate, r.inr_amount, r.bank_charges, r.other_deductions, r.deduction_notes, r.net_amount, r.wallet, r.notes]),
    [], ['Total in (INR)', data.inr.in], ['Total out (INR)', data.inr.out]]);
}

module.exports = { entriesCsv, entriesPdf, receiptsCsv, paymentsCsv };
