export const PROJECT_STATUSES = [
  { value: 'planned', label: 'Planned', tone: 'blue' },
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'on_hold', label: 'On hold', tone: 'amber' },
  { value: 'completed', label: 'Completed', tone: 'gray' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
  { value: 'closed', label: 'Closed', tone: 'gray' },
];
export const STATUS_META = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.value, s]));
export const PROJECT_KINDS = [
  { value: 'client', label: 'Client project' },
  { value: 'self', label: 'Self project' },
];
export const KIND_LABEL = Object.fromEntries(PROJECT_KINDS.map((k) => [k.value, k.label]));
export const WO_STATUSES = [
  { value: 'draft', label: 'Draft', tone: 'gray' },
  { value: 'issued', label: 'Issued', tone: 'blue' },
  { value: 'in_progress', label: 'In progress', tone: 'amber' },
  { value: 'completed', label: 'Completed', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
];
export const WO_META = Object.fromEntries(WO_STATUSES.map((s) => [s.value, s]));

export const rupees = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
