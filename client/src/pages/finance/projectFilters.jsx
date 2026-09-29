import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { PROJECT_CATEGORIES } from '../../lib/projectCategories.js';

// Requirement type filter shared by Finance → Projects and Project P&L. A
// project's category is a ReqType: every type a project can have today, plus
// the rows with none yet (active client accounts whose billing isn't set up).
export const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  ...PROJECT_CATEGORIES.filter((c) => !c.disabled).map((c) => ({ key: c.value, label: c.label })),
  { key: 'none', label: 'No category' },
];

export function matchesCategory(category, key) {
  if (key === 'all') return true;
  if (key === 'none') return !category;
  return category === key;
}

/** A row of filter pills, each with the count of rows it matches. */
export function FilterPills({ label, options, rows, matches, value, onChange, loading }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
      <span className="text-xs font-medium text-tertiary-500">{label}</span>
      {options.map(({ key, label: text }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === key ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-tertiary-200 bg-white text-tertiary-600 hover:border-tertiary-300'
          }`}
        >
          {text}
          <span className={`rounded-full px-1.5 tabular-nums ${value === key ? 'bg-primary-100' : 'bg-tertiary-100'}`}>
            {loading ? '…' : rows.filter((row) => matches(row, key)).length}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CategoryFilter({ rows, getCategory, value, onChange, loading }) {
  return (
    <FilterPills
      label="Project type"
      options={CATEGORY_FILTERS}
      rows={rows}
      matches={(row, key) => matchesCategory(getCategory(row), key)}
      value={value}
      onChange={onChange}
      loading={loading}
    />
  );
}

// Project contract tracking — see billing.service contractState.
export const CONTRACT_STATES = [
  { key: 'not_started', label: 'Not started', tone: 'gray' },
  { key: 'running', label: 'Running', tone: 'green' },
  { key: 'about_to_end', label: 'About to end', tone: 'amber' },
  { key: 'on_hold', label: 'On hold', tone: 'purple' },
  { key: 'completed', label: 'Completed', tone: 'blue' },
];
export const CONTRACT_FILTERS = [{ key: 'all', label: 'All' }, ...CONTRACT_STATES];

export function money(n, currency) {
  const value = Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return currency ? `${currency} ${value}` : value;
}

/**
 * Finance's exchange rates (INR per unit of each foreign currency). Returns
 * { rates, toInr, reload }: toInr(amount, currency) is null when that
 * currency has no rate yet.
 */
export function useExchangeRates() {
  const [rates, setRates] = useState([]);
  const reload = useCallback(
    () => apiClient.get('/billing/exchange-rates').then(({ data }) => setRates(data.data || [])).catch(() => setRates([])),
    []
  );
  useEffect(() => { reload(); }, [reload]);
  const byCurrency = new Map([['INR', 1], ...rates.filter((r) => r.rate_to_inr).map((r) => [r.currency, r.rate_to_inr])]);
  const toInr = (amount, currency) => (byCurrency.has(currency || 'INR') ? Number(amount || 0) * byCurrency.get(currency || 'INR') : null);
  return { rates, toInr, reload };
}
