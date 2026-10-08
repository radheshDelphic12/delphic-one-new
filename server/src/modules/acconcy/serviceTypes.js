// The six Acconcy services. Leads, deals and investments all carry one of these keys.
const SERVICE_TYPES = [
  { key: 'gold_silver', label: 'Investment in Gold & Silver', short: 'Gold & Silver', investment: true },
  { key: 'financial_consulting', label: 'Financial Consulting', short: 'Consulting', investment: false },
  { key: 'venture_capital', label: 'Venture Capitalist', short: 'Venture Capital', investment: true },
  { key: 'corporate_finance', label: 'Corporate Finance', short: 'Corporate Finance', investment: false },
  { key: 'transaction_advisory', label: 'Transaction Advisory', short: 'Transaction Advisory', investment: false },
  { key: 'valuation', label: 'Valuation', short: 'Valuation', investment: false },
];
const SERVICE_KEYS = SERVICE_TYPES.map((s) => s.key);
const labelOf = (key) => SERVICE_TYPES.find((s) => s.key === key)?.label || key;

module.exports = { SERVICE_TYPES, SERVICE_KEYS, labelOf };
