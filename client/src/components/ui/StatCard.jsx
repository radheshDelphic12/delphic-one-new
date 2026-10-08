/**
 * Dashboard metric card with optional trend hint.
 * `accent` fills the card with the brand colour (a good / highlighted number).
 * `tone` "warning" or "danger" tints it softly for things that need attention.
 */
const TONES = {
  warning: { box: 'border-amber-200 bg-amber-50', label: 'text-amber-800', value: 'text-amber-900', hint: 'text-amber-700' },
  danger: { box: 'border-red-200 bg-red-50', label: 'text-red-800', value: 'text-red-700', hint: 'text-red-600' },
};

export default function StatCard({ label, value, hint, accent = false, tone }) {
  const t = !accent && tone ? TONES[tone] : null;
  return (
    <div
      className={`hover-zoom relative rounded-2xl border p-4 shadow-soft ${
        accent ? 'border-primary-600 bg-primary-600 text-white' : t ? t.box : 'bg-white'
      }`}
    >
      <div className={`text-sm ${accent ? 'text-primary-100' : t ? t.label : 'text-tertiary-500'}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-white' : t ? t.value : 'text-tertiary-900'}`}>
        {value ?? '—'}
      </div>
      {hint && (
        <div className={`mt-2 text-xs ${accent ? 'text-primary-100' : t ? t.hint : 'text-tertiary-400'}`}>{hint}</div>
      )}
    </div>
  );
}
