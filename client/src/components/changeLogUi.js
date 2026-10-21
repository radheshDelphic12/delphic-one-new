// Labels shared by the Logs tab and the project history drawer.
export const ACTION_LABEL = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted (permanently)',
  soft_delete: 'Deleted',
  restore: 'Restored',
  bulk_create: 'Bulk create',
  bulk_update: 'Bulk update',
  bulk_delete: 'Bulk delete',
};

export const ACTION_TONE = {
  create: 'bg-green-50 text-green-700',
  update: 'bg-blue-50 text-blue-700',
  delete: 'bg-red-50 text-red-700',
  soft_delete: 'bg-red-50 text-red-700',
  restore: 'bg-amber-50 text-amber-700',
  bulk_create: 'bg-green-50 text-green-700',
  bulk_update: 'bg-blue-50 text-blue-700',
  bulk_delete: 'bg-red-50 text-red-700',
};

const ENTITY_LABEL = {
  account: 'Account',
  requirement: 'Requirement',
  profile: 'Candidate profile',
  submission: 'Submission',
  interview_round: 'Interview round',
  job_applicant: 'Applicant',
  employee: 'Employee',
  expense_claim: 'Expense claim',
  invoice: 'Invoice',
  payroll_run: 'Payroll run',
  payslip: 'Payslip',
  salary_structure: 'Salary structure',
  leave_request: 'Leave request',
  project_allocation: 'Project allocation',
  project_finance_entry: 'Project finance entry',
  project_document: 'Project document',
  project_vendor_invoice: 'Project vendor invoice',
  billing_rate: 'Billing rate',
  vendor_payment: 'Vendor payment',
  self_project: 'Own project',
  team: 'Team',
  policy: 'Policy',
  project: 'Project',
};

export const entityLabel = (type) => ENTITY_LABEL[type] || String(type || '').replace(/_/g, ' ');

export const whenLabel = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
