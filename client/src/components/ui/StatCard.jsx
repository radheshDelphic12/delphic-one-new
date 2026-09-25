/**
 * Dashboard metric card with optional trend hint.
 */
export default function StatCard({ label, value, hint, accent = false }) {
  return (
    <div
      className={`hover-zoom relative rounded-2xl border p-4 shadow-soft ${
        accent ? 'border-primary-600 bg-primary-600 text-white' : 'bg-white'
      }`}
    >
      <div className={`text-sm ${accent ? 'text-primary-100' : 'text-tertiary-500'}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-white' : 'text-tertiary-900'}`}>
        {value ?? '—'}
      </div>
      {hint && (
        <div className={`mt-2 text-xs ${accent ? 'text-primary-100' : 'text-tertiary-400'}`}>{hint}</div>
      )}
    </div>
  );
}
