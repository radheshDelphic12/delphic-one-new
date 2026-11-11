// Pure rules of HR letters: the serial number format, the {{fields}} of a template and the final text. No database here.

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FIELD_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

/** Indian financial year of a date, e.g. 2026-27 (April to March). */
function financialYear(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() + 1 >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Serial number from a format. Tokens: {PREFIX} {YYYY} {YY} {MM} {FY} {SEQ:n} (running number padded to n digits; {SEQ} = 4).
 * The series is the format with everything filled in except the running number: letters of one series are numbered one after another,
 * and a new series (a new financial year in the format, say) starts again at 1.
 */
function serialParts(format, { prefix, issuedOn }) {
  const d = new Date(issuedOn);
  const fill = (text) => text
    .replace(/\{PREFIX\}/g, String(prefix || 'LTR').toUpperCase())
    .replace(/\{YYYY\}/g, String(d.getUTCFullYear()))
    .replace(/\{YY\}/g, String(d.getUTCFullYear() % 100).padStart(2, '0'))
    .replace(/\{MM\}/g, String(d.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/\{FY\}/g, financialYear(d));
  const m = /\{SEQ(?::(\d{1,2}))?\}/.exec(format);
  const width = m && m[1] ? Number(m[1]) : 4;
  const filled = fill(format);
  const seqToken = /\{SEQ(?::\d{1,2})?\}/;
  return {
    series: filled.replace(seqToken, '#'),
    build: (n) => filled.replace(seqToken, String(n).padStart(width, '0')),
  };
}

/** A format must hold exactly one {SEQ} and only known tokens, or two letters could share a number. */
function checkSerialFormat(format) {
  const f = String(format || '');
  if (!f.trim()) return 'The serial number format is empty';
  if ((f.match(/\{SEQ(?::\d{1,2})?\}/g) || []).length !== 1) return 'The serial number format needs exactly one {SEQ} (the running number)';
  const unknown = (f.match(/\{[^}]*\}/g) || []).filter((t) => !/^\{(PREFIX|YYYY|YY|MM|FY|SEQ(:\d{1,2})?)\}$/.test(t));
  if (unknown.length) return `Unknown serial token ${unknown[0]}. Use {PREFIX} {YYYY} {YY} {MM} {FY} {SEQ:4}`;
  if (f.length > 60) return 'The serial number format is too long (60 characters at most)';
  return null;
}

/** The {{field}} names a text uses, in order of appearance, each once. */
function fieldsIn(...texts) {
  const out = [];
  for (const t of texts) for (const m of String(t || '').matchAll(FIELD_RE)) if (!out.includes(m[1].toLowerCase())) out.push(m[1].toLowerCase());
  return out;
}

/** Fill {{fields}}; a field with no value stays visible as [field] so a preview shows what is missing. Returns { text, missing }. */
function fill(text, values) {
  const missing = [];
  const out = String(text || '').replace(FIELD_RE, (_, name) => {
    const key = name.toLowerCase();
    const v = values[key];
    if (v === undefined || v === null || String(v).trim() === '') { if (!missing.includes(key)) missing.push(key); return `[${key}]`; }
    return String(v);
  });
  return { text: out, missing };
}

const longDate = (d) => { if (!d) return ''; const x = new Date(d); return `${x.getUTCDate()} ${MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };

/** Fields every letter can use without typing: the company, the date and the serial number. */
const COMMON_FIELDS = [
  ['company_name', 'Company name'], ['company_address', 'Company address'], ['date', 'Date of the letter'], ['serial_number', 'Serial number of the letter'],
];
/** Fields taken from an employee's record. */
const EMPLOYEE_FIELDS = [
  ['employee_name', 'Employee name'], ['employee_code', 'Employee code'], ['designation', 'Designation'], ['department', 'Department'], ['joining_date', 'Joining date'],
  ['last_working_day', 'Last working day'], ['manager_name', 'Reporting manager'], ['work_email', 'Work email'],
];
const RECIPIENT_FIELDS = [['recipient_name', 'Name of the person or company'], ['recipient_email', 'Email'], ['recipient_address', 'Address']];

module.exports = { financialYear, serialParts, checkSerialFormat, fieldsIn, fill, longDate, COMMON_FIELDS, EMPLOYEE_FIELDS, RECIPIENT_FIELDS };
