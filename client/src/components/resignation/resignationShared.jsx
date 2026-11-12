import { AlertTriangle, Info } from 'lucide-react';
import Modal from '../ui/Modal.jsx';

export const STATUS_LABEL = {
  submitted: 'With manager',
  manager_approved: 'With HR',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  retained: 'Retained',
};

const STATUS_TONE = {
  submitted: 'bg-amber-50 text-amber-700',
  manager_approved: 'bg-blue-50 text-blue-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
  withdrawn: 'bg-tertiary-100 text-tertiary-600',
  retained: 'bg-green-50 text-green-700',
};

export const REASON_LABEL = {
  better_opportunity: 'Better opportunity',
  higher_studies: 'Higher studies',
  personal: 'Personal reasons',
  health: 'Health',
  relocation: 'Relocation',
  compensation: 'Compensation',
  work_environment: 'Work environment',
  other: 'Other',
};

export function StatusPill({ status }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status] || 'bg-tertiary-100 text-tertiary-600'}`}>{STATUS_LABEL[status] || status}</span>;
}

export const todayPlus = (days) => new Date(Date.now() + 330 * 60000 + days * 86400000).toISOString().slice(0, 10);
export const todayYmd = () => todayPlus(0);

/**
 * "Are you sure?" popup. Closing it or choosing Cancel does nothing.
 * `details` is an optional list of [label, value] rows that summarise what is about to happen.
 */
export function ConfirmDialog({ open, title, message, details = [], confirmLabel = 'Yes, continue', danger = false, busy = false, onConfirm, onClose }) {
  const Icon = danger ? AlertTriangle : Info;
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>{busy ? 'Please wait…' : confirmLabel}</button>
        </>
      )}
    >
      <div className="flex items-start gap-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-600'}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-tertiary-700">{message}</p>
          {details.length > 0 && (
            <dl className="mt-4 divide-y divide-tertiary-100 rounded-xl border border-tertiary-100 bg-tertiary-50/50">
              {details.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                  <dt className="text-tertiary-500">{label}</dt>
                  <dd className="text-right font-medium text-tertiary-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </Modal>
  );
}
