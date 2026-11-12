export { inr, inrShort, pctLabel } from '../acconcy/meta.js';

// Investment life cycle (stored: planned / active / cancelled; the rest are derived by the server from the returns).
export const INVESTMENT_STATUSES = [
  { value: 'planned', label: 'Planned', tone: 'blue', hint: 'Not invested yet - not counted' },
  { value: 'active', label: 'Active', tone: 'green', hint: 'Capital placed, nothing returned yet' },
  { value: 'partially_returned', label: 'Partially returned', tone: 'amber', hint: 'Some principal recovered' },
  { value: 'completed', label: 'Completed', tone: 'purple', hint: 'All principal recovered' },
  { value: 'overdue', label: 'Overdue', tone: 'red', hint: 'Expected return date passed with money outstanding' },
  { value: 'cancelled', label: 'Cancelled', tone: 'gray', hint: 'Not counted' },
];
export const INVESTMENT_STATUS_META = Object.fromEntries(INVESTMENT_STATUSES.map((s) => [s.value, s]));
export const STORED_STATUSES = INVESTMENT_STATUSES.filter((s) => ['planned', 'active', 'cancelled'].includes(s.value));

export const ENTRY_KINDS = [
  { value: 'income', label: 'Income', hint: 'Other business income (not investment earnings)' },
  { value: 'expense', label: 'Expense', hint: 'Operating or other business expense' },
  { value: 'salary', label: 'Salary', hint: 'Salary paid or payable to an employee' },
  { value: 'transfer', label: 'Internal transfer', hint: 'Moves money between accounts; never income or expense' },
];
export const KIND_LABEL = Object.fromEntries(ENTRY_KINDS.map((k) => [k.value, k.label]));
export const TX_TYPES = [
  { value: 'investment', label: 'Investment placed' },
  { value: 'principal_return', label: 'Principal returned' },
  { value: 'earnings', label: 'Investment earnings' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'salary', label: 'Salary' },
  { value: 'transfer', label: 'Transfer' },
];
export const TX_LABEL = Object.fromEntries(TX_TYPES.map((t) => [t.value, t.label]));
export const TX_TONE = { investment: 'blue', principal_return: 'purple', earnings: 'green', income: 'green', expense: 'amber', salary: 'amber', transfer: 'gray' };

export const PAYMENT_STATUSES = [
  { value: 'paid', label: 'Paid / received', tone: 'green' },
  { value: 'unpaid', label: 'Unpaid (receivable / payable)', tone: 'amber' },
  { value: 'cancelled', label: 'Cancelled', tone: 'gray' },
];
export const STATUS_TONE = { paid: 'green', unpaid: 'amber', cancelled: 'gray', received: 'green', reversed: 'purple', ...Object.fromEntries(INVESTMENT_STATUSES.map((s) => [s.value, s.tone])) };
export const STATUS_LABEL = { paid: 'Paid', unpaid: 'Unpaid', cancelled: 'Cancelled', received: 'Received', reversed: 'Reversed', ...Object.fromEntries(INVESTMENT_STATUSES.map((s) => [s.value, s.label])) };
export const PAYMENT_METHODS = ['Bank transfer', 'Cheque', 'Cash', 'UPI', 'Card', 'Other'];
export const EXPENSE_CLASSES = [
  { value: 'operating', label: 'Operating expense' },
  { value: 'other', label: 'Other expense' },
];

export const PROJECTION_LINES = [
  { value: 'new_investment', label: 'New investment', side: 'capital', hint: 'Capital planned to be placed (not income or expense)' },
  { value: 'principal_recovery', label: 'Principal recovery', side: 'capital', hint: 'Original capital expected back (not profit)' },
  { value: 'investment_earnings', label: 'Investment earnings', side: 'income', hint: 'Profit expected on top of the principal' },
  { value: 'other_income', label: 'Other income', side: 'income', hint: 'Other expected business income' },
  { value: 'operating_expense', label: 'Operating expenses', side: 'expense', hint: 'Planned running costs' },
  { value: 'salary', label: 'Salaries', side: 'expense', hint: 'Planned salary cost' },
  { value: 'other_expense', label: 'Other expenses', side: 'expense', hint: 'Other planned spending' },
];
export const LINE_META = Object.fromEntries(PROJECTION_LINES.map((l) => [l.value, l]));
export const PROJECTION_STATUSES = [
  { value: 'draft', label: 'Draft', tone: 'gray' },
  { value: 'approved', label: 'Approved', tone: 'green' },
  { value: 'archived', label: 'Archived', tone: 'gray' },
];

export const REPORT_LIST = [
  ['monthly', 'Monthly financial report'],
  ['investments', 'Investment register'],
  ['returns', 'Returns received (principal and earnings)'],
  ['income', 'Income by category'],
  ['expenses', 'Expenses by category'],
  ['salaries', 'Salaries by employee'],
  ['projection_vs_actual', 'Projected vs actual'],
];

// One palette for the workspace: ink, brass (the accent), slate, wine and sage.
export const ZK_COLORS = { ink: '#262626', brass: '#B08D57', slate: '#6B7A8F', wine: '#7A2E3B', sage: '#7B9A82', projected: '#9A8C73', grid: '#E7E3DA' };
