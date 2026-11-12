import { useCallback, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import FilterBar from '../zephyr/FilterBar.jsx';
import { PERIOD_PRESETS, presetRange, rangeLabel } from '../../lib/zklyrera/periods.js';
import { INVESTMENT_STATUSES } from '../../lib/zklyrera/meta.js';

/**
 * One filter state for a whole Zklyrera page: the reporting period (a preset or custom dates) plus the category / status
 * filters. `params` is what the API takes (no preset name); every KPI, chart, table and list on the page reads the same `params`.
 */
export function useZkFilters({ preset = 'current_month', fyStart = 4, extra = {} } = {}) {
  const blank = useMemo(() => ({ preset, ...(preset === 'custom' ? { from: '', to: '' } : presetRange(preset, fyStart)), q: '', ...extra }), [preset, fyStart]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(blank);
  const set = useCallback((key, value) => setF((c) => ({ ...c, [key]: value, ...(key === 'from' || key === 'to' ? { preset: 'custom' } : {}) })), []);
  const setPreset = useCallback((p) => setF((c) => (p === 'custom' ? { ...c, preset: 'custom' } : { ...c, preset: p, ...presetRange(p, fyStart) })), [fyStart]);
  const reset = useCallback(() => setF(blank), [blank]);
  const params = useMemo(() => { const { preset: _p, ...rest } = f; return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== '' && v !== null && v !== undefined)); }, [f]);
  return { f, set, setPreset, reset, blank, params, key: JSON.stringify(params) };
}

const FIELD_DEFS = {
  investment_category_id: (p) => ({ label: 'Investment category', type: 'select', any: 'All', options: p.investmentCategories }),
  investment_id: (p) => ({ label: 'Investment', type: 'select', any: 'All', options: p.investments }),
  investment_status: () => ({ label: 'Investment status', type: 'select', any: 'All', options: INVESTMENT_STATUSES.map((s) => ({ value: s.value, label: s.label })) }),
  income_category_id: (p) => ({ label: 'Income category', type: 'select', any: 'All', options: p.incomeCategories }),
  expense_category_id: (p) => ({ label: 'Expense category', type: 'select', any: 'All', options: p.expenseCategories }),
  category_id: (p, extra) => ({ label: 'Category', type: 'select', any: 'All', options: extra?.categoryOptions || [] }),
  payment_status: () => ({ label: 'Payment status', type: 'select', any: 'All', options: [{ value: 'paid', label: 'Paid / received' }, { value: 'unpaid', label: 'Unpaid (receivable / payable)' }] }),
  person_id: (p) => ({ label: 'Employee', type: 'select', any: 'All', options: p.persons }),
};

/** Period picker + search + the chosen filter fields. `fields` lists the keys from FIELD_DEFS to offer on this page. */
export default function ZkFilterBar({ filters, pickers, fields = [], searchPlaceholder = 'Search...', extraFields = [], categoryOptions, children, showPeriod = true }) {
  const { f, set, setPreset, reset, blank } = filters;
  const list = [
    { key: 'from', label: 'From', type: 'date' },
    { key: 'to', label: 'To', type: 'date' },
    ...fields.map((key) => ({ key, ...FIELD_DEFS[key](pickers, { categoryOptions }) })),
    ...extraFields,
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {showPeriod && (
          <label className="text-xs font-medium text-tertiary-600">
            Period
            <span className="mt-1 flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-primary-100">
              <CalendarDays className="h-4 w-4 text-tertiary-400" />
              <select className="bg-transparent text-sm font-medium text-tertiary-900 focus:outline-none" value={f.preset} onChange={(e) => setPreset(e.target.value)} aria-label="Reporting period">
                {PERIOD_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </span>
          </label>
        )}
        <div className="min-w-0 flex-1">
          <FilterBar q={f.q} onQ={(v) => set('q', v)} searchPlaceholder={searchPlaceholder} fields={list} values={f} defaults={{ ...blank, from: f.preset === 'custom' ? '' : blank.from, to: f.preset === 'custom' ? '' : blank.to }} onChange={set} onReset={reset}>{children}</FilterBar>
        </div>
      </div>
      {showPeriod && <p className="text-xs text-tertiary-500" aria-live="polite">Showing <b className="font-medium text-tertiary-700">{rangeLabel(f)}</b>. Every figure, chart and list on this page follows these filters.</p>}
    </div>
  );
}
