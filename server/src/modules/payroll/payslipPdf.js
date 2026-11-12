const PDFDocument = require('pdfkit');

// Server-side PDFs of a salary slip and of an FnF statement (the browser print of the slip stays as it is). Used for the FnF documents package, so
// every payslip since joining can go out as a file, not only the ones somebody opened and printed.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BLUE = '#105aa9';
const GREY = '#64748b';
const LINE = '#e2e8f0';

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const periodLabel = (m, y) => `${MONTHS[m - 1]} ${y}`;
const dash = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));
const titleCase = (v) => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function render(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function heading(doc, text) {
  doc.moveDown(0.8).fillColor(BLUE).font('Helvetica-Bold').fontSize(9).text(text.toUpperCase(), { characterSpacing: 0.6 });
  doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).strokeColor(LINE).stroke();
  doc.moveDown(0.5).fillColor('#0f172a');
}

/** label on the left, value on the right of one row */
function row(doc, label, value, { bold = false, color = '#0f172a', indent = 0 } = {}) {
  const y = doc.y;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(bold ? '#0f172a' : GREY).text(label, 40 + indent, y, { width: 330 });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color).text(value, 380, y, { width: 175, align: 'right' });
  doc.moveDown(0.25);
}

function pairs(doc, items) {
  for (let i = 0; i < items.length; i += 2) {
    const y = doc.y;
    [items[i], items[i + 1]].forEach((it, col) => {
      if (!it) return;
      const x = 40 + col * 265;
      doc.font('Helvetica').fontSize(9).fillColor(GREY).text(it[0], x, y, { width: 90 });
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(dash(it[1]), x + 92, y, { width: 165 });
    });
    doc.y = y + 15;
  }
  doc.x = 40;
}

function titleBlock(doc, title, sub) {
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(18).text(title, 40, 40);
  doc.fillColor(GREY).font('Helvetica').fontSize(10).text(sub);
  doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).lineWidth(2).strokeColor(BLUE).stroke().lineWidth(1);
  doc.moveDown(0.8);
}

/** A salary slip as a PDF. `payslip` is what payroll.getPayslip returns (with `detail`). */
async function payslipPdf(payslip, orgName) {
  const d = payslip.detail || {};
  const e = d.employee || {};
  const t = d.totals || {};
  const period = periodLabel(payslip.payroll_run?.period_month, payslip.payroll_run?.period_year);
  return render((doc) => {
    titleBlock(doc, 'Salary Slip', `${orgName || 'Delphic'} - ${period}`);
    heading(doc, 'Employee & bank details');
    pairs(doc, [
      ['Employee code', e.employee_code], ['Aadhaar', e.aadhaar_number],
      ['Employee name', e.name], ['PAN', e.pan_number],
      ['Department', e.department], ['Account number', e.bank_account_number],
      ['Team', e.team], ['IFSC', e.bank_ifsc],
      ['Designation', e.designation],
    ]);
    if ((d.leaves || []).length) {
      heading(doc, 'Leave details');
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(GREY).text('', 40, y);
      d.leaves.forEach((l, i) => {
        const x = 200 + i * 90;
        doc.font('Helvetica-Bold').fillColor('#0f172a').text(l.label, x, y, { width: 85, align: 'right' });
        doc.font('Helvetica').text(String(l.taken), x, y + 14, { width: 85, align: 'right' });
        doc.text(l.balance === null ? 'No cap' : String(l.balance), x, y + 28, { width: 85, align: 'right' });
      });
      doc.font('Helvetica').fillColor(GREY).text(`Leaves taken (${period})`, 40, y + 14).text('Leaves balance as of now', 40, y + 28);
      doc.y = y + 46;
      doc.x = 40;
    }
    if (d.salary) {
      heading(doc, 'Salary & earnings breakup');
      row(doc, 'Monthly CTC', money(d.salary.monthly_ctc), { bold: true });
      for (const c of d.salary.components) row(doc, titleCase(c.name), money(c.amount), { indent: 10 });
    }
    heading(doc, `Calculation & net pay - ${period}`);
    if (d.earnings) {
      row(doc, 'Monthly pay (CTC for the month)', money(d.earnings.base_pay));
      const ot = d.earnings.overtime;
      if (ot && (ot.amount > 0 || ot.approved_hours > 0)) {
        const how = ot.hourly_rate != null && ot.multiplier != null ? ` - ${ot.approved_hours}h x ${Number(ot.hourly_rate).toLocaleString('en-IN', { maximumFractionDigits: 2 })} x ${ot.multiplier}` : ` - ${ot.approved_hours}h`;
        row(doc, `Overtime (approved)${how}`, money(ot.amount));
      }
    }
    row(doc, 'Gross salary', money(t.gross), { bold: true });
    row(doc, 'Less: loss of pay', `- ${money(t.loss_of_pay)}`, { color: '#dc2626' });
    if ((d.additions || []).length) {
      doc.moveDown(0.2).font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('ADD-ONS (ADDED TO THE PAY)', 40);
      doc.moveDown(0.2);
      for (const a of d.additions) row(doc, `${a.label}${a.note ? ` (${a.note})` : ''}`, `+ ${money(a.amount)}`, { color: '#15803d' });
    }
    if ((d.other_deductions || []).length) {
      doc.moveDown(0.2).font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('OTHER DEDUCTIONS', 40);
      doc.moveDown(0.2);
      for (const a of d.other_deductions) row(doc, `${a.label}${a.note ? ` (${a.note})` : ''}`, `- ${money(a.amount)}`, { color: '#dc2626' });
    }
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(BLUE).lineWidth(1.5).stroke().lineWidth(1);
    doc.moveDown(0.3);
    row(doc, 'Final net paid amount', money(t.net_paid), { bold: true, color: BLUE });
    if (d.needs_refresh) doc.moveDown(0.5).font('Helvetica').fontSize(8.5).fillColor('#b45309').text(`Note: an add-on or deduction was changed after this salary was processed (it comes to ${money(t.expected_net)}); the payroll run has to be updated.`, 40);
    doc.moveDown(1.5).font('Helvetica').fontSize(8).fillColor('#94a3b8').text(`Generated ${new Date(payslip.generated_at || Date.now()).toLocaleDateString('en-IN')} - This is a computer-generated salary slip.`, 40, undefined, { align: 'center', width: 515 });
  });
}

/** The FnF statement as a PDF. `s` is fnfStatement.build(...). */
async function fnfStatementPdf(s, orgName) {
  return render((doc) => {
    titleBlock(doc, 'Full & Final Settlement Statement', `${orgName || 'Delphic'} - prepared ${new Date().toLocaleDateString('en-IN')}`);
    const e = s.employee;
    heading(doc, 'Employee');
    pairs(doc, [
      ['Name', e.name], ['Employee code', e.employee_code],
      ['Department', e.department], ['Designation', e.designation],
      ['Date of joining', e.joined_at], ['Last working day', e.last_working_day],
      ['Service', e.service_text], ['FnF status', titleCase(s.status)],
    ]);
    heading(doc, 'Earnings');
    if (!s.earnings.length) doc.font('Helvetica').fontSize(10).fillColor(GREY).text('No earning line.', 40);
    for (const l of s.earnings) row(doc, `${l.label}${l.note ? ` (${l.note})` : ''}`, money(l.amount), { color: '#15803d' });
    heading(doc, 'Deductions / recoveries');
    if (!s.deductions.length) doc.font('Helvetica').fontSize(10).fillColor(GREY).text('No deduction line.', 40);
    for (const l of s.deductions) row(doc, `${l.label}${l.note ? ` (${l.note})` : ''}`, `- ${money(l.amount)}`, { color: '#dc2626' });
    doc.moveDown(0.4);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(BLUE).lineWidth(1.5).stroke().lineWidth(1);
    doc.moveDown(0.3);
    row(doc, 'Total earnings', money(s.totals.earnings), { bold: true });
    row(doc, 'Total deductions', `- ${money(s.totals.deductions)}`, { bold: true });
    row(doc, 'Net payable on full & final settlement', money(s.totals.net_payable), { bold: true, color: BLUE });
    if (s.totals.recorded_amount != null && Math.abs(s.totals.recorded_amount - s.totals.net_payable) > 0.01) row(doc, 'Amount recorded in the FnF register', money(s.totals.recorded_amount));
    if ((s.leave_balances || []).length) {
      heading(doc, 'Leave balance at exit (for reference)');
      for (const b of s.leave_balances) row(doc, b.name, b.remaining === null ? 'No cap' : String(b.remaining));
    }
    if ((s.salary_history || []).length) {
      heading(doc, 'Salary history (monthly CTC)');
      for (const h of s.salary_history) row(doc, `From ${h.effective_from}`, money(h.ctc));
    }
    if ((s.payslips || []).length) {
      heading(doc, 'Salary slips on record');
      for (const p of s.payslips) row(doc, p.period, `net ${money(p.net)}${p.paid != null ? ` - paid ${money(p.paid)}` : ' - payment not recorded'}`);
    }
    if (s.notes) { heading(doc, 'Notes'); doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(s.notes, 40, undefined, { width: 515 }); }
    doc.moveDown(2).font('Helvetica').fontSize(9).fillColor(GREY).text('Prepared by HR / Finance', 40).text('Employee acknowledgement: ____________________', 330, doc.y - 11);
  });
}

module.exports = { payslipPdf, fnfStatementPdf };
