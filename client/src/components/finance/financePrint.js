// Printable finance documents — client invoices, vendor invoices and locked
// records. Opens a standalone page and the print dialog; "Save as PDF" there
// is the download (same approach as payslips).
import { MONTHS } from './PeriodPicker.jsx';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function amountText(n, currency = 'INR') {
  if (n === null || n === undefined) return '—';
  return `${currency} ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dateText(ymd) {
  if (!ymd) return '—';
  return new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function monthText(month, year) {
  return `${MONTHS[month - 1] || month} ${year}`;
}

const STYLE = `body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;padding:32px;max-width:860px;margin:auto}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 8px}.sub{color:#64748b;font-size:12px;margin:4px 0 18px}
table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;font-size:13px;text-align:left;border-bottom:1px solid #e8ebf2;vertical-align:top}
th{color:#64748b;font-weight:600}.r{text-align:right}.total td{font-weight:700;font-size:15px;border-top:2px solid #0f172a}
.meta td:first-child{color:#64748b;width:38%}.calc{background:#f8fafc;border:1px solid #e8ebf2;border-radius:8px;padding:10px 12px;font-size:13px}
.calc div{margin:2px 0}.note{color:#475569;font-size:12px;margin-top:16px}`;

function openPrint(title, body) {
  const win = window.open('', '_blank', 'width=880,height=980');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  return true;
}

function metaTable(rows) {
  return `<table class="meta"><tbody>${rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

/** How a client (project) amount was worked out, as plain lines. */
export function billingCalculationLines(d) {
  if (!d) return [];
  const c = d.currency;
  const lines = [];
  if (d.billing_type === 'monthly') {
    lines.push(`Monthly rate: ${amountText(d.rate, c)}`);
    lines.push(`Working days in the month: ${d.working_days}${d.calendar ? ` (${d.calendar})` : ''}`);
    lines.push(`Billed working days: ${d.contract_working_days}${d.period_from ? ` (${dateText(d.period_from)} – ${dateText(d.period_to)})` : ''}`);
    lines.push(`Base: ${amountText(d.rate, c)} × ${d.contract_working_days} ÷ ${d.working_days} = ${amountText(d.base_amount, c)}`);
  } else if (d.billing_type === 'hourly') {
    lines.push(`Hourly rate: ${amountText(d.rate, c)}/hour`);
    lines.push(`Billable (approved) hours: ${d.billable_hours}h${d.period_from ? ` (${dateText(d.period_from)} – ${dateText(d.period_to)})` : ''}`);
    lines.push(`Base: ${amountText(d.rate, c)} × ${d.billable_hours}h = ${amountText(d.base_amount, c)}`);
  }
  if (d.overtime_billed) lines.push(`Overtime: ${d.overtime_hours}h at ${d.overtime_multiplier}× = ${amountText(d.overtime_amount, c)}`);
  lines.push(`Invoice amount: ${amountText(d.amount, c)}`);
  return lines;
}

/** Client invoice for one project and month. */
export function printClientInvoice(inv, orgName) {
  const d = inv.details || {};
  const p = inv.project || {};
  const period = d.period_from ? `${dateText(d.period_from)} – ${dateText(d.period_to)}` : monthText(inv.period_month, inv.period_year);
  const lines = inv.line_items?.lines || [];
  const body = `
    <h1>${escapeHtml(orgName || 'Invoice')}</h1>
    <p class="sub">Tax invoice · ${escapeHtml(inv.status || 'draft')}</p>
    ${metaTable([
      ['Invoice number', escapeHtml(inv.invoice_number || '—')],
      ['Invoice date', escapeHtml(dateText(inv.invoice_date))],
      ['Billing period', escapeHtml(period)],
      ['Client', escapeHtml(p.client_name || '—')],
      ['Project', `${escapeHtml(p.name || '—')}${p.code ? ` (${escapeHtml(p.code)})` : ''}`],
      ['Billing type', escapeHtml(d.billing_type ? (d.billing_type === 'monthly' ? 'Monthly' : 'Hourly') : '—')],
      ['Currency', escapeHtml(inv.currency)],
      ['Rate', escapeHtml(d.rate !== undefined && d.rate !== null ? `${amountText(d.rate, inv.currency)}${d.billing_type === 'hourly' ? ' / hour' : ' / month'}` : '—')],
    ])}
    <h2>Calculation</h2>
    <div class="calc">${billingCalculationLines(d).map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>
    ${lines.length && d.billing_type === 'hourly' ? `<h2>Resources</h2><table><thead><tr><th>Resource</th><th class="r">Hours</th><th class="r">Overtime hrs</th><th class="r">Amount (${escapeHtml(inv.currency)})</th></tr></thead><tbody>
      ${lines.map((l) => `<tr><td>${escapeHtml(l.resource)}</td><td class="r">${escapeHtml(l.hours)}</td><td class="r">${escapeHtml(l.overtime_hours || '')}</td><td class="r">${escapeHtml(amountText(l.revenue, inv.currency))}</td></tr>`).join('')}
      </tbody></table>` : ''}
    <table><tbody><tr class="total"><td>Total due</td><td class="r">${escapeHtml(amountText(inv.amount, inv.currency))}</td></tr></tbody></table>
    ${inv.notes ? `<p class="note">${escapeHtml(inv.notes)}</p>` : ''}`;
  return openPrint(`Invoice ${inv.invoice_number || ''} — ${p.name || ''}`, body);
}

/** How one contractor's vendor cost was worked out. */
export function vendorLineText(c, currency) {
  const parts = [`${amountText(c.monthly_vendor_rate, currency)}/month × ${c.allocation_percent}% allocation`];
  if (c.contract_working_days !== null && c.contract_working_days !== undefined) parts.push(`× ${c.contract_working_days} ÷ ${c.working_days} working days`);
  parts.push(`= ${amountText(c.base_amount, currency)}`);
  if (c.overtime_amount) parts.push(`+ overtime ${c.overtime_hours}h ${amountText(c.overtime_amount, currency)}`);
  return parts.join(' ');
}

/** A vendor's invoice for a month: its rows (one per project and currency). */
export function printVendorInvoice(rows, orgName) {
  if (!rows?.length) return false;
  const first = rows[0];
  const totals = rows.reduce((m, r) => ({ ...m, [r.currency]: (m[r.currency] || 0) + Number(r.amount) }), {});
  const body = `
    <h1>${escapeHtml(orgName || 'Vendor invoice')}</h1>
    <p class="sub">Vendor invoice (payable)</p>
    ${metaTable([
      ['Vendor', escapeHtml(first.vendor_account?.name || '—')],
      ['Invoice number', escapeHtml(first.invoice_number || '—')],
      ['Invoice date', escapeHtml(dateText(first.invoice_date))],
      ['Billing period', escapeHtml(monthText(first.period_month, first.period_year))],
      ['Billing type', 'Monthly vendor rate (contract working days)'],
    ])}
    ${rows.map((r) => `
      <h2>${escapeHtml(r.project?.name || 'Project')}${r.project?.code ? ` (${escapeHtml(r.project.code)})` : ''}${r.project?.client_name ? ` — client ${escapeHtml(r.project.client_name)}` : ''}</h2>
      <table><thead><tr><th>Contractor</th><th>Calculation</th><th class="r">Hours</th><th class="r">Amount (${escapeHtml(r.currency)})</th></tr></thead><tbody>
      ${(r.details?.contractors || []).map((c) => `<tr><td>${escapeHtml(c.contractor)}</td><td>${escapeHtml(vendorLineText(c, r.currency))}</td><td class="r">${escapeHtml(c.approved_hours)}</td><td class="r">${escapeHtml(amountText(c.amount, r.currency))}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">Project total</td><td class="r">${escapeHtml(amountText(r.amount, r.currency))}${r.details?.amount_inr !== null && r.details?.amount_inr !== undefined && r.currency !== 'INR' ? `<br><span style="font-weight:400;font-size:12px">≈ ${escapeHtml(amountText(r.details.amount_inr, 'INR'))} @ ₹${escapeHtml(r.details.exchange_rate)}</span>` : ''}</td></tr>
      </tbody></table>`).join('')}
    <table><tbody>${Object.entries(totals).map(([cur, amt]) => `<tr class="total"><td>Total due (${escapeHtml(cur)})</td><td class="r">${escapeHtml(amountText(amt, cur))}</td></tr>`).join('')}</tbody></table>
    ${first.notes ? `<p class="note">${escapeHtml(first.notes)}</p>` : ''}`;
  return openPrint(`Vendor invoice ${first.invoice_number || ''} — ${first.vendor_account?.name || ''}`, body);
}

const KIND_TITLE = { billing: 'Locked billing', salary_employee: 'Locked salary', vendor_bill: 'Locked vendor billing', expense: 'Locked expense', salary: 'Locked salary (whole month)', vendor_payment: 'Locked vendor payments (whole month)' };

/** A locked record as a statement (what it was locked from). */
export function printLockedRecord(rec, orgName) {
  const s = rec.summary || {};
  const head = [
    ['Record', escapeHtml(rec.scope_label || '—')],
    ['Period', escapeHtml(monthText(rec.period_month, rec.period_year))],
    ['Status', escapeHtml(`${rec.status === 'change_detected' ? 'Locked — change detected' : 'Locked'} v${rec.version}`)],
    ['Locked by', escapeHtml(`${rec.locked_by?.name || '—'}${rec.locked_at ? ` · ${new Date(rec.locked_at).toLocaleString()}` : ''}`)],
    ['Amount', escapeHtml(amountText(rec.amount, rec.currency))],
    ['Amount (INR)', rec.currency !== 'INR' ? escapeHtml(`${amountText(rec.amount_inr, 'INR')}${s.exchange_rate ? ` @ ₹${s.exchange_rate}` : ''}`) : null],
  ];
  let detail = '';
  if (rec.kind === 'billing') {
    head.splice(1, 0, ['Client', escapeHtml(s.project?.client_name || '—')]);
    detail = `<h2>Calculation</h2><div class="calc">${billingCalculationLines(s.details).map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>`;
    if (rec.invoice) detail += `<p class="note">Invoice ${escapeHtml(rec.invoice.invoice_number || '—')} · ${escapeHtml(rec.invoice.status)} · ${escapeHtml(amountText(rec.invoice.amount, rec.invoice.currency))}</p>`;
  } else if (rec.kind === 'salary_employee') {
    const b = s.breakdown || {};
    detail = `<h2>Salary</h2><div class="calc">
      <div>Employee: ${escapeHtml(s.employee?.name)}${s.employee?.employee_code ? ` (${escapeHtml(s.employee.employee_code)})` : ''}${s.employee?.department ? ` · ${escapeHtml(s.employee.department)}` : ''}</div>
      <div>Monthly CTC: ${escapeHtml(amountText(s.ctc))} · per hour ${escapeHtml(amountText(b.hourly_rate))}</div>
      <div>Working days ${escapeHtml(b.working_days)} × ${escapeHtml(b.shift_hours)}h = expected ${escapeHtml(b.expected_hours)}h; paid ${escapeHtml(b.paid_hours)}h; short ${escapeHtml(b.deficit_hours || 0)}h</div>
      <div>Overtime approved: ${escapeHtml(b.ot_approved_hours || 0)}h = ${escapeHtml(amountText(s.ot_amount))}</div>
      <div>Gross ${escapeHtml(amountText(s.gross))} − deductions ${escapeHtml(amountText(s.deductions))} = net ${escapeHtml(amountText(s.net))}</div></div>`;
  } else if (rec.kind === 'vendor_bill' || rec.kind === 'vendor_payment') {
    detail = `<h2>Contractors</h2><table><thead><tr><th>Contractor</th><th>Client · project</th><th>Calculation</th><th class="r">Amount</th><th class="r">INR</th></tr></thead><tbody>
      ${(s.lines || []).map((l) => `<tr><td>${escapeHtml(l.contractor)}</td><td>${escapeHtml([l.project?.client_name, l.project?.name].filter(Boolean).join(' · '))}</td><td>${escapeHtml(vendorLineText(l, l.currency))}</td><td class="r">${escapeHtml(amountText(l.amount, l.currency))}</td><td class="r">${escapeHtml(amountText(l.amount_inr, 'INR'))}</td></tr>`).join('')}
      </tbody></table>`;
    if (rec.vendor_invoices?.length) detail += `<p class="note">Vendor invoice ${escapeHtml(rec.vendor_invoices[0].invoice_number || '—')}: ${rec.vendor_invoices.map((i) => escapeHtml(amountText(i.amount, i.currency))).join(' + ')}</p>`;
  } else if (rec.kind === 'expense') {
    const r = s.record || {};
    detail = `<h2>Expense</h2>${metaTable([
      ['Type', escapeHtml(r.type === 'charge' ? 'Group charge' : 'Expense claim')],
      ['Category', escapeHtml(r.category)],
      ['Employee', escapeHtml(r.person ? `${r.person}${r.employee_code ? ` (${r.employee_code})` : ''}` : '')],
      ['Office', escapeHtml(r.location || '')],
      ['Date', escapeHtml(dateText(r.date))],
      ['Description', escapeHtml(r.description || '')],
      ['Amount', escapeHtml(amountText(r.amount, r.currency))],
    ])}`;
  } else if (rec.kind === 'salary') {
    detail = `<h2>Employees</h2><table><thead><tr><th>Employee</th><th class="r">Net</th></tr></thead><tbody>${(s.lines || []).map((l) => `<tr><td>${escapeHtml(l?.employee?.name)}</td><td class="r">${escapeHtml(amountText(l?.net))}</td></tr>`).join('')}</tbody></table>`;
  }
  const body = `<h1>${escapeHtml(orgName || 'Statement')}</h1><p class="sub">${escapeHtml(KIND_TITLE[rec.kind] || 'Locked record')}</p>${metaTable(head)}${detail}`;
  return openPrint(`${KIND_TITLE[rec.kind] || 'Locked record'} — ${rec.scope_label || ''}`, body);
}
