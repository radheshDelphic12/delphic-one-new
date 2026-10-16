// One source of truth for the employee statuses and work modes: the directory filters,
// the Edit Employee form and the status badges all read from here, so they cannot drift apart.
// `value` is the stored enum (EmploymentStatus / WorkMode); only the label is for people.
export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'notice_period', label: 'Serving notice' },
  { value: 'on_leave', label: 'On long leave' },
  { value: 'pending_onboarding', label: 'Joining soon' },
  { value: 'terminated', label: 'Exited' },
];

export const WORK_MODE_OPTIONS = [
  { value: 'onsite', label: 'Onsite' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

export const employmentStatusLabel = (value) => EMPLOYMENT_STATUS_OPTIONS.find((o) => o.value === value)?.label || String(value || '').replace(/_/g, ' ');
