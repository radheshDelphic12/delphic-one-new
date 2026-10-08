import { compact } from '../format.js';

export const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
/** Lakh / Crore display (₹90L, ₹1Cr); the full amount goes in a tooltip via <Money>. */
export const inrShort = (v) => `${Number(v) < 0 ? '-' : ''}₹${compact(Math.abs(Number(v || 0)))}`;
export const pctLabel = (v) => (v === null || v === undefined ? '-' : `${v}%`);
export const qtyLabel = (v, unit) => (v === null || v === undefined ? '-' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`);

// The six Acconcy services (fixed by the business; the server owns the same list).
export const SERVICE_TYPES = [
  { value: 'gold_silver', label: 'Investment in Gold & Silver', short: 'Gold & Silver', tone: 'amber' },
  { value: 'financial_consulting', label: 'Financial Consulting', short: 'Consulting', tone: 'purple' },
  { value: 'venture_capital', label: 'Venture Capitalist', short: 'Venture Capital', tone: 'blue' },
  { value: 'corporate_finance', label: 'Corporate Finance', short: 'Corporate Finance', tone: 'gray' },
  { value: 'transaction_advisory', label: 'Transaction Advisory', short: 'Transaction Advisory', tone: 'cyan' },
  { value: 'valuation', label: 'Valuation', short: 'Valuation', tone: 'red' },
];
export const SERVICE_META = Object.fromEntries(SERVICE_TYPES.map((s) => [s.value, s]));
export const serviceLabel = (key) => SERVICE_META[key]?.label || key || '-';

export const LEAD_STAGES = [
  { value: 'new', label: 'New', tone: 'blue' },
  { value: 'in_discussion', label: 'In discussion', tone: 'blue' },
  { value: 'qualification', label: 'Qualification', tone: 'purple' },
  { value: 'proposal', label: 'Proposal', tone: 'cyan' },
  { value: 'negotiation', label: 'Negotiation', tone: 'amber' },
  { value: 'won', label: 'Won', tone: 'green' },
  { value: 'on_hold', label: 'On hold', tone: 'gray' },
  { value: 'dropped', label: 'Dropped', tone: 'red' },
  { value: 'closed', label: 'Closed', tone: 'gray' },
];
export const OPEN_STAGES = ['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'on_hold'];
export const DONE_STAGES = ['won', 'dropped', 'closed'];
export const STAGE_META = Object.fromEntries(LEAD_STAGES.map((s) => [s.value, s]));

export const DEAL_STATUSES = [
  { value: 'planned', label: 'Planned', tone: 'blue' },
  { value: 'active', label: 'Active', tone: 'purple' },
  { value: 'on_hold', label: 'On hold', tone: 'gray' },
  { value: 'completed', label: 'Completed', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
];
export const DEAL_STATUS_META = Object.fromEntries(DEAL_STATUSES.map((s) => [s.value, s]));

export const INVESTMENT_TYPES = [
  { value: 'gold', label: 'Gold', tone: 'amber' },
  { value: 'silver', label: 'Silver', tone: 'gray' },
  { value: 'venture', label: 'Venture / Business', tone: 'blue' },
  { value: 'other', label: 'Other', tone: 'gray' },
];
export const INVESTMENT_TYPE_META = Object.fromEntries(INVESTMENT_TYPES.map((s) => [s.value, s]));
export const INVESTMENT_STATUSES = [
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'partly_realised', label: 'Partly realised', tone: 'amber' },
  { value: 'realised', label: 'Realised', tone: 'gray' },
];
export const INVESTMENT_STATUS_META = Object.fromEntries(INVESTMENT_STATUSES.map((s) => [s.value, s]));

export const ASSET_CATEGORIES = [
  { value: 'cash_bank', label: 'Cash & bank' },
  { value: 'property', label: 'Property' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'receivable', label: 'Receivable' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
];
export const ASSET_CATEGORY_LABEL = Object.fromEntries(ASSET_CATEGORIES.map((c) => [c.value, c.label]));

export const SALARY_STATUS = { draft: { label: 'Draft', tone: 'gray' }, approved: { label: 'Approved', tone: 'blue' }, paid: { label: 'Paid', tone: 'green' } };

export const TASK_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'amber' },
  { value: 'in_progress', label: 'In progress', tone: 'blue' },
  { value: 'done', label: 'Done', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'gray' },
];
export const TASK_STATUS_META = Object.fromEntries(TASK_STATUSES.map((s) => [s.value, s]));
export const PRIORITIES = [
  { value: 'low', label: 'Low', tone: 'gray' },
  { value: 'medium', label: 'Medium', tone: 'blue' },
  { value: 'high', label: 'High', tone: 'red' },
];
export const PRIORITY_META = Object.fromEntries(PRIORITIES.map((s) => [s.value, s]));
export const TASK_TYPES = [
  ['client_meeting', 'Client meeting'], ['financial_analysis', 'Financial analysis'], ['investment_research', 'Investment research'],
  ['due_diligence', 'Due diligence'], ['valuation_analysis', 'Valuation analysis'], ['transaction_documentation', 'Transaction documentation'],
  ['client_follow_up', 'Client follow-up'], ['vendor_coordination', 'Vendor coordination'], ['investment_monitoring', 'Investment monitoring'], ['other', 'Other'],
].map(([value, label]) => ({ value, label }));
export const TASK_TYPE_LABEL = Object.fromEntries(TASK_TYPES.map((t) => [t.value, t.label]));

/** Months for the valuation / P&L pickers, newest first. */
export const monthOptions = (count = 24) => {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i += 1) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};
