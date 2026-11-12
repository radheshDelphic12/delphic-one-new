export { inr, inrShort, pctLabel } from '../acconcy/meta.js';

// Campaign life cycle. The server owns the same list (modules/foundation/campaigns.service.js).
export const CAMPAIGN_STATUSES = [
  { value: 'draft', label: 'Draft', tone: 'gray' },
  { value: 'planned', label: 'Planned', tone: 'blue' },
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'on_hold', label: 'On hold', tone: 'amber' },
  { value: 'completed', label: 'Completed', tone: 'purple' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
];
export const STATUS_META = Object.fromEntries(CAMPAIGN_STATUSES.map((s) => [s.value, s]));
// What a campaign can move to from each status (mirrors the server rule; the server is the judge).
export const NEXT_STATUS = {
  draft: ['planned', 'active', 'cancelled'],
  planned: ['draft', 'active', 'on_hold', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'completed', 'cancelled'],
  completed: ['active'],
  cancelled: ['draft', 'planned'],
};

export const ENTRY_KINDS = [
  { value: 'expense', label: 'Expense / investment', hint: 'Money going out' },
  { value: 'funding', label: 'Funding received', hint: 'Donation, grant, sponsor or allocation' },
  { value: 'transfer', label: 'Internal transfer', hint: 'Moves money between accounts; never income or expense' },
];
export const KIND_LABEL = Object.fromEntries(ENTRY_KINDS.map((k) => [k.value, k.label]));
export const ENTRY_STATUSES = {
  expense: [
    { value: 'pending', label: 'Pending approval', tone: 'gray', hint: 'Not counted yet' },
    { value: 'approved', label: 'Approved (commitment)', tone: 'amber', hint: 'Committed, not paid' },
    { value: 'paid', label: 'Paid', tone: 'green', hint: 'Actual spending' },
    { value: 'rejected', label: 'Rejected', tone: 'red', hint: 'Not counted' },
    { value: 'cancelled', label: 'Cancelled', tone: 'gray', hint: 'Not counted' },
    { value: 'reversed', label: 'Reversed (refund)', tone: 'purple', hint: 'Taken out again' },
  ],
  funding: [
    { value: 'pledged', label: 'Pledged', tone: 'amber', hint: 'Promised, not received' },
    { value: 'received', label: 'Received', tone: 'green', hint: 'Money in' },
    { value: 'cancelled', label: 'Cancelled', tone: 'gray', hint: 'Not counted' },
  ],
  transfer: [{ value: 'recorded', label: 'Recorded', tone: 'gray', hint: 'Not income or expense' }],
};
export const ALL_ENTRY_STATUSES = Object.fromEntries(Object.values(ENTRY_STATUSES).flat().map((s) => [s.value, s]));
// What an entry can move to (mirrors the server rule).
export const ENTRY_NEXT = {
  expense: { pending: ['approved', 'rejected', 'cancelled'], approved: ['paid', 'rejected', 'cancelled'], paid: ['reversed'], rejected: [], cancelled: [], reversed: [] },
  funding: { pledged: ['received', 'cancelled'], received: ['cancelled'], cancelled: [] },
  transfer: { recorded: [] },
};
export const ACTION_LABEL = { approved: 'Approve', paid: 'Mark paid', rejected: 'Reject', cancelled: 'Cancel', reversed: 'Reverse (refund)', received: 'Mark received' };
export const NEEDS_REASON = ['rejected', 'cancelled', 'reversed'];
export const EXPENSE_CLASSES = [
  { value: 'programme', label: 'Programme (counts as investment in the campaign)' },
  { value: 'operational', label: 'Operational (spending, not investment)' },
];
export const PAYMENT_METHODS = ['Bank transfer', 'Cheque', 'Cash', 'UPI', 'Card', 'Other'];

export const FLAG_META = {
  over_budget: { label: 'Over budget', tone: 'red' },
  over_committed: { label: 'Commitments exceed budget', tone: 'amber' },
  projected_overrun: { label: 'Projected overrun', tone: 'amber' },
  no_budget: { label: 'No budget', tone: 'amber' },
  delayed: { label: 'Past end date', tone: 'amber' },
  ending_with_funds: { label: 'Ending, funds left', tone: 'blue' },
  completed_unspent: { label: 'Completed, unspent', tone: 'blue' },
  behind_plan: { label: 'Behind plan', tone: 'blue' },
};
export const REPORT_GROUPS = [
  ['Budgets', ['campaign_budget', 'category_budget', 'location_spend', 'utilization', 'remaining_budget']],
  ['Spending and funding', ['monthly_expenditure', 'quarterly_expenditure', 'planned_vs_actual', 'funding_vs_expenditure']],
  ['Projections and attention', ['projected_expenditure', 'over_budget', 'completed_unspent', 'active_by_category_location']],
];

export const FORECAST_METHODS = [
  { value: 'plan', label: 'Planned schedule (remaining planned investment over the remaining months)' },
  { value: 'run_rate', label: 'Run rate (recent monthly average, needs two complete months)' },
];
