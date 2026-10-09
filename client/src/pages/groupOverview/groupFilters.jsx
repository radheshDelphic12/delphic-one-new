import { useState } from 'react';

// Filter pieces shared by every Group Dashboard tab, so a period means the same thing everywhere.

export const monthStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Indian financial year (April - March), the convention the rest of the app uses.
export function presetRange(key, pickedMonth) {
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyYear, 3, 1);
  switch (key) {
    case 'this_month': return { from: monthStr(cur), to: monthStr(cur) };
    case 'prev_month': return { from: monthStr(addMonths(cur, -1)), to: monthStr(addMonths(cur, -1)) };
    case 'month': return pickedMonth ? { from: pickedMonth, to: pickedMonth } : null;
    case 'quarter': { const q = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); return { from: monthStr(q), to: monthStr(cur) }; }
    case 'prev_quarter': { const q = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1); return { from: monthStr(q), to: monthStr(addMonths(q, 2)) }; }
    case 'fy': return { from: monthStr(fyStart), to: monthStr(cur) };
    case 'prev_fy': return { from: monthStr(new Date(fyYear - 1, 3, 1)), to: monthStr(new Date(fyYear, 2, 1)) };
    case 'last_12': return { from: monthStr(addMonths(cur, -11)), to: monthStr(cur) };
    default: return null;
  }
}

export const PRESETS = [
  ['this_month', 'This month'], ['prev_month', 'Last month'], ['month', 'Pick a month'], ['quarter', 'This quarter'], ['prev_quarter', 'Last quarter'],
  ['fy', 'Financial year'], ['prev_fy', 'Last financial year'], ['last_12', 'Last 12 months'], ['custom', 'Custom'],
];
export const GROUPINGS = [['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']];
export const FIGURES = [['all', 'All (live)'], ['locked', 'Locked'], ['unlocked', 'Unlocked']];

// A row of pills: one choice at a time, the chosen one filled.
export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary-400">{label}</div>
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-tertiary-50 p-1" role="group" aria-label={label}>
        {options.map(([k, text]) => (
          <button
            key={k}
            type="button"
            aria-pressed={value === k}
            onClick={() => onChange(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === k ? 'bg-white text-primary-700 shadow-soft ring-1 ring-primary-200' : 'text-tertiary-600 hover:bg-white/70'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Period state for a tab: a preset, a single picked month, or a custom start / end month.
 * `range` is { from, to } as YYYY-MM, `valid` is false until both ends are set and in order.
 */
export function usePeriod(initialPreset = 'last_12') {
  const [preset, setPreset] = useState(initialPreset);
  const [custom, setCustom] = useState(presetRange('last_12'));
  const [picked, setPicked] = useState(monthStr(new Date()));
  const range = preset === 'custom' ? custom : presetRange(preset, picked);
  const valid = Boolean(range?.from && range?.to && range.to >= range.from);
  return { preset, setPreset, custom, setCustom, picked, setPicked, range, valid, isDefault: preset === initialPreset, reset: () => setPreset(initialPreset) };
}

/** The Period pills plus the month inputs the chosen pill needs. */
export function PeriodFilters({ period, label = 'Period', presets = PRESETS }) {
  const { preset, setPreset, custom, setCustom, picked, setPicked } = period;
  const inputCls = 'mt-1 block rounded-lg border px-2 py-1.5 text-sm';
  return (
    <>
      <Segmented label={label} value={preset} options={presets} onChange={setPreset} />
      {preset === 'month' && (
        <label className="text-xs font-medium text-tertiary-600">Month
          <input type="month" value={picked} onChange={(e) => e.target.value && setPicked(e.target.value)} className={inputCls} />
        </label>
      )}
      {preset === 'custom' && (
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Start month
            <input type="month" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={inputCls} />
          </label>
          <label className="text-xs font-medium text-tertiary-600">End month
            <input type="month" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={inputCls} />
          </label>
        </div>
      )}
    </>
  );
}
