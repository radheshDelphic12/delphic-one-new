import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
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
 * Finance's exchange rates (INR per unit of each foreign currency), as
 * { rates, reload }. The conversion itself is done on the server with the same
 * converter everywhere (P&L, Projects, analytics) — screens show its results.
 */
export function useExchangeRates() {
  const [rates, setRates] = useState([]);
  const reload = useCallback(
    () => apiClient.get('/billing/exchange-rates').then(({ data }) => setRates(data.data || [])).catch(() => setRates([])),
    []
  );
  useEffect(() => { reload(); }, [reload]);
  return { rates, reload };
}

/**
 * Finance's INR rate for each foreign currency — one set of rates, editable
 * from Finance → Projects and Project P&L, that every INR figure converts with.
 */
export function ExchangeRatesPanel({ rates, onSaved }) {
  const { pushError, pushInfo } = useAlerts();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(Object.fromEntries(rates.map((r) => [r.currency, r.rate_to_inr ?? ''])));
  }, [rates]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.put('/billing/exchange-rates', {
        rates: rates.map((r) => ({ currency: r.currency, rate_to_inr: form[r.currency] === '' ? null : Number(form[r.currency]) })),
      });
      pushInfo('Exchange rates saved');
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save exchange rates'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const set = rates.filter((r) => r.rate_to_inr !== null);
  return (
    <details className="rounded-xl border border-tertiary-100 bg-white" open={rates.length > 0 && set.length === 0}>
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-tertiary-800">
        Exchange rates (INR)
        <span className="ml-2 text-xs font-normal text-tertiary-500">
          {set.map((r) => `1 ${r.currency} = ₹${r.rate_to_inr}`).join(' · ') || 'Not set'}
        </span>
      </summary>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3 border-t border-tertiary-100 px-4 py-3">
        {rates.map((r) => (
          <label key={r.currency} className="block text-xs font-medium text-tertiary-600">
            1 {r.currency} =
            <span className="mt-1 flex items-center rounded-xl border px-2">
              <span className="text-tertiary-400">₹</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form[r.currency] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [r.currency]: e.target.value }))}
                placeholder="Not set"
                aria-label={`INR per ${r.currency}`}
                className="w-24 bg-transparent px-1.5 py-1.5 text-sm outline-none"
              />
            </span>
          </label>
        ))}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save rates'}</button>
        <p className="w-full text-xs text-tertiary-500">Billing, contractor rates and vendor invoices in these currencies are converted to INR in the P&amp;L and project totals. Salaries are INR.</p>
      </form>
    </details>
  );
}
