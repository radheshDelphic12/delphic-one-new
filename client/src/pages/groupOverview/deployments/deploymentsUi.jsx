import { useState } from 'react';
import Modal from '../../../components/ui/Modal.jsx';

// Labels, formats and small pieces shared by the Group Travel > Deployments screens (group admin view and the "My deployments" page).

export const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
export const labelCls = 'block text-xs font-medium text-tertiary-600';
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
export const today = () => new Date().toLocaleDateString('en-CA');
export const dayText = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-');
export const whenText = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export const KIND_LABEL = { visit: 'Short visit', assignment: 'Assignment', deployment: 'Long-term deployment' };
export const ARRANGEMENT_LABEL = { client_office: 'At the client office', remote: 'Remote', hybrid: 'Hybrid', inherit: 'Same as the deployment' };
export const CATEGORY_LABEL = { travel_ticket: 'Travel tickets', accommodation: 'Accommodation', food: 'Food', local_conveyance: 'Local conveyance', other: 'Other' };
export const FUNDING_LABEL = { company: 'Company-funded', client: 'Client-funded', shared: 'Shared', client_reimbursable: 'Client-reimbursable' };
export const FREQ_LABEL = { one_time: 'One time', monthly: 'Every month' };
export const ROLE_LABEL = { reporting_manager: 'Reporting manager', delivery_manager: 'Project / delivery manager', finance: 'Finance', admin: 'Administration' };
export const MODE_LABEL = { flight: 'Flight', train: 'Train', bus: 'Bus', local_transport: 'Local transport', accommodation: 'Accommodation', other: 'Other' };
export const STATUS = {
  draft: ['gray', 'Draft'], pending_approval: ['amber', 'Waiting for approval'], approved: ['blue', 'Approved'], active: ['green', 'Active'], closed: ['gray', 'Closed'], cancelled: ['red', 'Cancelled'],
};
export const STATE_EXTRA = { ending_soon: ['amber', 'Ending soon'], overdue: ['red', 'Past its end date'] };
export const EXPENSE_STATUS = { submitted: ['amber', 'To verify'], verified: ['blue', 'Verified'], settled: ['green', 'Settled'], rejected: ['red', 'Rejected'] };
export const RECOVERY = { none: ['gray', 'Nothing to recover'], pending: ['amber', 'Client owes'], partial: ['amber', 'Part recovered'], recovered: ['green', 'Recovered'] };
export const EVENT_LABEL = {
  created: 'Created', edited: 'Edited', submitted: 'Submitted for approval', approved: 'Approved', step_approved: 'Approval step passed', rejected: 'Rejected', started: 'Started',
  extended: 'Extended', person_added: 'Person added', person_replaced: 'Person replaced', person_released: 'Person released early', person_updated: 'Person updated',
  budget_set: 'Budget set', budget_revised: 'Budget revised', change_requested: 'Change sent for approval', closed: 'Closed', cancelled: 'Cancelled', travel_added: 'Travel arrangement added',
  expense_submitted: 'Expense submitted', expense_verified: 'Expense verified', expense_rejected: 'Expense rejected', expense_settled: 'Expense settled', recovery_recorded: 'Client payment recorded',
  overrun_requested: 'Over budget: approval requested', overrun_approved: 'Over budget approved', weekly_review: 'Weekly review', client_feedback: 'Client feedback',
};
export const REQUEST_LABEL = { deployment: 'Deployment approval', extension: 'Extension', allocation: 'Change of people', budget: 'Budget revision', budget_overrun: 'Spend over the budget' };

/** One line describing a request, from its payload. */
export function requestSummary(r) {
  const p = r.payload || {};
  if (r.kind === 'extension') return `Extend the end date to ${dayText(p.new_end_date)}${p.reason ? ` · ${p.reason}` : ''}`;
  if (r.kind === 'allocation') return `${p.action === 'add' ? 'Add' : p.action === 'replace' ? 'Replace with' : 'Release'} ${p.person?.name || 'a person'}${p.reason ? ` · ${p.reason}` : ''}`;
  if (r.kind === 'budget') return `New budget of ${(p.lines || []).length} line${(p.lines || []).length === 1 ? '' : 's'}${p.reason ? ` · ${p.reason}` : ''}`;
  if (r.kind === 'budget_overrun') return `${inr(p.amount)} spent, ${inr(p.over_by)} over the approved budget`;
  return r.emergency ? `Emergency: ${r.emergency_reason || ''}` : 'Approve the deployment and its budget';
}

/** A small dialog asking for a reason (and optionally more), then calls onConfirm(value). */
export function ReasonModal({ open, title, label = 'Reason', required = true, confirmText = 'Confirm', tone = 'btn-primary', onClose, onConfirm, extra = null, busy = false }) {
  const [value, setValue] = useState('');
  if (!open) return null;
  const bad = required && value.trim().length < 3;
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={tone} disabled={bad || busy} onClick={() => onConfirm(value.trim())}>{busy ? 'Please wait…' : confirmText}</button>
        </>
      )}
    >
      <div className="space-y-3">
        {extra}
        <label className={labelCls}>{label}<textarea rows={3} autoFocus className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} /></label>
      </div>
    </Modal>
  );
}

/** Estimated vs actual, as a bar with the variance written out. */
export function BudgetBar({ estimated, actual }) {
  const pct = estimated > 0 ? Math.min(100, (actual / estimated) * 100) : actual > 0 ? 100 : 0;
  const over = actual > estimated && actual > 0;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full rounded-full ${over ? 'bg-danger-500' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-xs text-tertiary-500">{inr(actual)} spent of {inr(estimated)} · {over ? `${inr(actual - estimated)} over` : `${inr(estimated - actual)} left`}</p>
    </div>
  );
}
