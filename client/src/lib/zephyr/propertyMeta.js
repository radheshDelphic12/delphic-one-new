// Labels and tones for the property, rent and task screens. Keys match the server constants.
const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.value, r]));

export const PROPERTY_TYPES = [
  { value: 'plot', label: 'Plot' },
  { value: 'house', label: 'House' },
  { value: 'building', label: 'Building' },
  { value: 'shops', label: 'Shops' },
  { value: 'office', label: 'Office' },
  { value: 'commercial_complex', label: 'Commercial complex' },
  { value: 'other', label: 'Other' },
];
export const PROPERTY_TYPE_LABEL = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.value, t.label]));

export const PROPERTY_STATUSES = [
  { value: 'active', label: 'Active', tone: 'green' },
  { value: 'under_construction', label: 'Under construction', tone: 'amber' },
  { value: 'under_renovation', label: 'Under renovation', tone: 'amber' },
  { value: 'held', label: 'Held', tone: 'blue' },
  { value: 'sold', label: 'Sold', tone: 'gray' },
  { value: 'inactive', label: 'Inactive', tone: 'gray' },
];
export const PROPERTY_STATUS_META = toMap(PROPERTY_STATUSES);

export const UNIT_STATUSES = [
  { value: 'available', label: 'Available', tone: 'green' },
  { value: 'rented', label: 'Rented', tone: 'blue' },
  { value: 'sold', label: 'Sold', tone: 'gray' },
  { value: 'held', label: 'Held', tone: 'purple' },
  { value: 'under_construction', label: 'Under construction', tone: 'amber' },
  { value: 'under_renovation', label: 'Under renovation', tone: 'amber' },
  { value: 'vacant', label: 'Vacant', tone: 'cyan' },
];
export const UNIT_STATUS_META = toMap(UNIT_STATUSES);

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];
export const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label]));

export const RENT_STATUS = {
  pending: { label: 'Pending', tone: 'blue' },
  partial: { label: 'Partially paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  overdue: { label: 'Overdue', tone: 'red' },
  waived: { label: 'Waived', tone: 'gray' },
};

export const FINANCING_TYPES = [
  { value: 'bank_loan', label: 'Bank loan' },
  { value: 'private_loan', label: 'Private loan' },
  { value: 'other', label: 'Other' },
];
export const EMI_FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export const EVENT_KINDS = [
  { value: 'note', label: 'Note' },
  { value: 'construction', label: 'Construction' },
  { value: 'renovation', label: 'Renovation' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'loan', label: 'Loan' },
];
export const EVENT_TONE = { purchase: 'blue', construction: 'amber', renovation: 'amber', valuation: 'purple', rent: 'green', sale: 'red', loan: 'cyan', status: 'gray', note: 'gray' };

export const TASK_TYPES = [
  { value: 'visit_property', label: 'Visit property' },
  { value: 'collect_rent', label: 'Collect rent' },
  { value: 'inspect', label: 'Inspect property' },
  { value: 'coordinate_vendor', label: 'Coordinate vendor' },
  { value: 'collect_documents', label: 'Collect documents' },
  { value: 'verify_work', label: 'Verify construction work' },
  { value: 'follow_up_tenant', label: 'Follow up with tenant' },
  { value: 'follow_up_client', label: 'Follow up with client' },
  { value: 'collect_payment', label: 'Collect payment' },
  { value: 'update_property', label: 'Update property information' },
  { value: 'other', label: 'Other' },
];
export const TASK_TYPE_LABEL = Object.fromEntries(TASK_TYPES.map((t) => [t.value, t.label]));
export const TASK_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'blue' },
  { value: 'in_progress', label: 'In progress', tone: 'amber' },
  { value: 'completed', label: 'Completed', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'gray' },
];
export const TASK_STATUS_META = toMap(TASK_STATUSES);
export const PRIORITY_TONE = { high: 'red', normal: 'blue', low: 'gray' };

export const monthLabel = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const shiftMonth = (m, delta) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
};
