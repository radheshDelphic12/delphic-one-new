export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function currentPeriod() {
  const now = new Date();
  return { period_month: now.getMonth() + 1, period_year: now.getFullYear() };
}

export function periodLabel({ period_month, period_year }) {
  return `${MONTHS[period_month - 1] || period_month} ${period_year}`;
}

/**
 * Month + year selectors (and, with `allowQuarter`, a Month / Quarter
 * switch). Value: { period, period_month, period_year }. Quarter follows the
 * picked month (Jul–Sep = Q3).
 */
export default function PeriodPicker({ value, onChange, allowQuarter = false, label = 'Period' }) {
  const now = new Date();
  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const quarter = Math.floor((value.period_month - 1) / 3) + 1;
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label={label}>
      {allowQuarter && (
        <label className="text-xs font-medium text-tertiary-600">
          {label}
          <select aria-label="Period type" value={value.period || 'month'} onChange={(e) => set({ period: e.target.value })} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
        </label>
      )}
      {value.period === 'quarter' ? (
        <label className="text-xs font-medium text-tertiary-600">
          Quarter
          <select aria-label="Quarter" value={quarter} onChange={(e) => set({ period_month: (Number(e.target.value) - 1) * 3 + 1 })} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q} ({MONTHS[(q - 1) * 3].slice(0, 3)}–{MONTHS[(q - 1) * 3 + 2].slice(0, 3)})</option>)}
          </select>
        </label>
      ) : (
        <label className="text-xs font-medium text-tertiary-600">
          {allowQuarter ? 'Month' : label}
          <select aria-label="Month" value={value.period_month} onChange={(e) => set({ period_month: Number(e.target.value) })} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
      )}
      <label className="text-xs font-medium text-tertiary-600">
        Year
        <select aria-label="Year" value={value.period_year} onChange={(e) => set({ period_year: Number(e.target.value) })} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
    </div>
  );
}
