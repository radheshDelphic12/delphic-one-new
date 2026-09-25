const COLOR_MAP = {
  open: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-amber-50 text-amber-700',
  on_hold: 'bg-tertiary-100 text-tertiary-700',
  closed: 'bg-green-50 text-green-700',
  dropped: 'bg-red-50 text-red-700',
  interviewing: 'bg-indigo-50 text-indigo-700',
  offer: 'bg-purple-50 text-purple-700',
  offer_sent: 'bg-purple-50 text-purple-700',
  bgv: 'bg-cyan-50 text-cyan-700',
  sourced: 'bg-slate-100 text-slate-700',
  internal_screening: 'bg-indigo-50 text-indigo-700',
  submitted_to_client: 'bg-blue-50 text-blue-700',
  interview_scheduled: 'bg-violet-50 text-violet-700',
  interview_result: 'bg-fuchsia-50 text-fuchsia-700',
  backout: 'bg-orange-50 text-orange-700',
  rejected: 'bg-red-50 text-red-700',
  pending: 'bg-tertiary-100 text-tertiary-700',
  pass: 'bg-green-50 text-green-700',
  fail: 'bg-red-50 text-red-700',
  no_show: 'bg-amber-50 text-amber-700',
  cleared: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
  active: 'bg-green-50 text-green-700',
  scheduled: 'bg-violet-50 text-violet-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-tertiary-100 text-tertiary-500',
  lead: 'bg-purple-50 text-purple-700',
  meeting_scheduled: 'bg-blue-50 text-blue-700',
  rescheduled: 'bg-amber-50 text-amber-700',
  urgent: 'bg-red-50 text-red-700',
  high: 'bg-amber-50 text-amber-700',
  medium: 'bg-blue-50 text-blue-700',
  low: 'bg-tertiary-100 text-tertiary-700',
  direct: 'bg-blue-50 text-blue-700',
  vendor: 'bg-amber-50 text-amber-800',
  linkedin: 'bg-green-50 text-green-700',
  internal: 'bg-sky-50 text-sky-800',
  external: 'bg-violet-50 text-violet-800',
};

const LABEL_OVERRIDES = {
  no_show: 'Candidate did not join',
  // Candidate source labels — the stored enum values stay `direct` / `linkedin`.
  direct: 'Bench',
  linkedin: 'Market',
};

export default function Badge({ value, label }) {
  const classes = COLOR_MAP[value] || 'bg-tertiary-100 text-tertiary-700';
  const text = label || LABEL_OVERRIDES[value] || String(value).replace(/_/g, ' ');
  const caseClass = LABEL_OVERRIDES[value] || label ? 'normal-case' : 'capitalize';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${caseClass} ${classes}`}>
      {text}
    </span>
  );
}
