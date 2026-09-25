/**
 * Small inline chips showing every internal screening round result on a pipeline
 * card (internal_r1 / internal_r2). Accepts either the full `interview_rounds`
 * array (from /submissions) or the trimmed `internal_rounds` array (from
 * /pipeline/board) — both carry `round_type` + `result`.
 */
const INTERNAL_TYPES = ['internal_r1', 'internal_r2'];

const SHORT_LABEL = { internal_r1: 'IS1', internal_r2: 'IS2' };
const LONG_LABEL = { internal_r1: 'Internal Screening 1', internal_r2: 'Internal Screening 2' };

const RESULT_STYLE = {
  pass: 'bg-green-50 text-green-700 border-green-200',
  fail: 'bg-red-50 text-red-700 border-red-200',
  pending: 'bg-tertiary-50 text-tertiary-500 border-tertiary-200',
  no_show: 'bg-orange-50 text-orange-700 border-orange-200',
  rescheduled: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function ScreeningRoundChips({ rounds = [], className = '' }) {
  const internal = (rounds || [])
    .filter((r) => INTERNAL_TYPES.includes(r.round_type))
    .sort((a, b) => (a.round_number || 0) - (b.round_number || 0));
  if (!internal.length) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {internal.map((r, index) => (
        <span
          key={r.id || `${r.round_type}-${index}`}
          className={`rounded border px-1 py-0.5 text-[10px] font-medium capitalize ${
            RESULT_STYLE[r.result] || RESULT_STYLE.pending
          }`}
          title={`${LONG_LABEL[r.round_type] || r.round_type}: ${r.result}`}
        >
          {SHORT_LABEL[r.round_type] || r.round_type}: {r.result}
        </span>
      ))}
    </div>
  );
}
