import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Eye, Lock, MinusCircle, RotateCcw, XCircle } from 'lucide-react';

// Approval + calculation-lock states. Every badge carries an icon AND a text
// label — colour is never the only signal (green = approved/locked, red =
// pending/rejected/attention).
const STATES = {
  // Timesheet / approval
  approved: { label: 'Approved', icon: CheckCircle2, cls: 'bg-green-50 text-green-700 ring-green-200' },
  pending: { label: 'Pending', icon: Clock, cls: 'bg-red-50 text-red-700 ring-red-200' },
  submitted: { label: 'Pending', icon: Clock, cls: 'bg-red-50 text-red-700 ring-red-200' },
  rejected: { label: 'Rejected', icon: XCircle, cls: 'bg-red-100 text-red-800 ring-red-300' },
  no_entry: { label: 'Not logged', icon: MinusCircle, cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  no_entries: { label: 'No entries', icon: MinusCircle, cls: 'bg-tertiary-100 text-tertiary-600 ring-tertiary-200' },
  non_working: { label: 'Non-working', icon: CircleDashed, cls: 'bg-tertiary-50 text-tertiary-500 ring-tertiary-200' },
  outside_contract: { label: 'Outside contract', icon: CircleDashed, cls: 'bg-tertiary-50 text-tertiary-500 ring-tertiary-200' },
  // Calculation lock
  draft: { label: 'Draft', icon: CircleDashed, cls: 'bg-tertiary-100 text-tertiary-700 ring-tertiary-200' },
  reviewed: { label: 'Reviewed', icon: Eye, cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  locked: { label: 'Locked', icon: Lock, cls: 'bg-green-50 text-green-800 ring-green-200' },
  change_detected: { label: 'Change Detected', icon: AlertTriangle, cls: 'bg-red-50 text-red-700 ring-red-300' },
  reopened: { label: 'Reopened', icon: RotateCcw, cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  // Change resolution
  open: { label: 'Open', icon: AlertTriangle, cls: 'bg-red-50 text-red-700 ring-red-200' },
  accepted: { label: 'Accepted', icon: CheckCircle2, cls: 'bg-green-50 text-green-700 ring-green-200' },
  dismissed: { label: 'Dismissed', icon: MinusCircle, cls: 'bg-tertiary-100 text-tertiary-600 ring-tertiary-200' },
};

export function statusLabel(status) {
  return STATES[status]?.label || String(status || '').replace(/_/g, ' ');
}

export default function StatusBadge({ status, label, title, size = 'sm' }) {
  const state = STATES[status] || { label: statusLabel(status), icon: CircleDashed, cls: 'bg-tertiary-100 text-tertiary-700 ring-tertiary-200' };
  const Icon = state.icon;
  const pad = size === 'xs' ? 'px-1.5 py-0 text-[11px]' : 'px-2 py-0.5 text-xs';
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${pad} ${state.cls}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label || state.label}
    </span>
  );
}
