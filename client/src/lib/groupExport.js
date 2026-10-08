import { downloadText } from './zephyr/csv.js';

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function downloadCsv(filename, headers, rows) {
  downloadText(filename, String.fromCharCode(0xfeff) + toCsv(headers, rows));
}

const html = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// PDF without a new dependency: a clean print view in a new window; the browser's "Save as PDF" does the rest.
export function printReport(title, subtitle, headers, rows) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const body = rows.map((r) => `<tr>${r.map((c) => `<td class="${typeof c === 'number' ? 'n' : ''}">${html(typeof c === 'number' ? c.toLocaleString('en-IN') : c)}</td>`).join('')}</tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${html(title)}</title><style>
    body{font-family:Arial,sans-serif;margin:24px;color:#1f2937}h1{font-size:18px;margin:0}p{color:#6b7280;font-size:12px}
    table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px}th,td{border:1px solid #d1d5db;padding:6px 8px;text-align:left}
    th{background:#f3f4f6}td.n{text-align:right}</style></head><body><h1>${html(title)}</h1><p>${html(subtitle)}</p>
    <table><thead><tr>${headers.map((h) => `<th>${html(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}
