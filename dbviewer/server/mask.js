// Column-name masking. The patterns mirror SECRET in server/src/config/changeCapture.js (what the app's own change log redacts),
// split in two:
//   ALWAYS    never shown anywhere (screen, CSV, XLSX, comparisons) - a diff only says the column "changed".
//   SENSITIVE personal identifiers - masked unless the super admin asks to reveal them (each reveal is audit-logged).
// MASK_ALWAYS_EXTRA / MASK_SENSITIVE_EXTRA add more regex alternatives (e.g. "salary|phone") without a code change.
const MASK = '••••••';

function build(base, extra) {
  return new RegExp(extra ? `${base}|${extra}` : base, 'i');
}

const ALWAYS = build('pass|secret|token|hash|otp|api_?key', process.env.MASK_ALWAYS_EXTRA);
const SENSITIVE = build('account_number|aadhaar|pan_number|ifsc', process.env.MASK_SENSITIVE_EXTRA);

function classify(column) {
  if (ALWAYS.test(column)) return 'always';
  if (SENSITIVE.test(column)) return 'sensitive';
  return null;
}

// Value as it may be shown. `reveal` only ever opens the sensitive class.
function show(column, value, reveal = false) {
  if (value === null || value === undefined) return null;
  const kind = classify(column);
  if (kind === 'always') return MASK;
  if (kind === 'sensitive' && !reveal) return MASK;
  return value;
}

module.exports = { MASK, classify, show };
