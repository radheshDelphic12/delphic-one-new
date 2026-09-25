const { fail } = require('../utils/response');

// Finance scope reduction (client brief): Vendor Payments, External Access,
// Vendor Ledger and Accounting are switched off for now — hidden in the UI and
// refused here so the API can't be used to reach them either. The code and data
// stay in place; re-enabling a section is a config change, not a rebuild:
//   FINANCE_DISABLED_MODULES=""                       -> everything back on
//   FINANCE_DISABLED_MODULES="accounting,vendor_ledger" -> just those off
// Read on every request (like requireModule) so a change needs no redeploy of code.
const DEFAULT_DISABLED = ['vendor_payments', 'external_access', 'vendor_ledger', 'accounting'];

const LABELS = {
  vendor_payments: 'Vendor Payments',
  external_access: 'External Access',
  vendor_ledger: 'Vendor Ledger',
  accounting: 'Accounting',
};

function disabledFinanceModules() {
  const raw = process.env.FINANCE_DISABLED_MODULES;
  if (raw === undefined) return new Set(DEFAULT_DISABLED);
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function requireFinanceModule(name) {
  return (req, res, next) => {
    if (disabledFinanceModules().has(name)) {
      return fail(res, 404, `${LABELS[name] || 'This section'} is temporarily disabled`);
    }
    return next();
  };
}

module.exports = { requireFinanceModule, disabledFinanceModules, DEFAULT_DISABLED };
