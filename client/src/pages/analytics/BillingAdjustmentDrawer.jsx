import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import { periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { amountText } from '../../components/finance/financePrint.js';

/**
 * An admin's + / - tweak to one project's billed amount for a month. The
 * approved timesheet hours stay the source of truth; each adjustment is a
 * separate line with a mandatory reason, added to the final amount.
 */
export default function BillingAdjustmentDrawer({ target, onClose, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState({ items: [], total: 0 });
  const [form, setForm] = useState({ direction: 'add', amount: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const params = target ? { account_id: target.project.id, period_month: target.period_month, period_year: target.period_year } : null;

  function load() {
    apiClient.get('/billing/adjustments', { params })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load adjustments'), 'Something went wrong'));
  }

  useEffect(() => {
    if (!target) return;
    setForm({ direction: 'add', amount: '', reason: '' });
    load();
  }, [target?.project?.id, target?.period_month, target?.period_year]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return <Drawer open={false} title="" onClose={onClose} />;
  const currency = target.currency;
  const signed = (form.direction === 'subtract' ? -1 : 1) * Number(form.amount || 0);

  async function add(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/billing/adjustments', { ...params, amount: signed, reason: form.reason.trim() });
      pushSuccess?.('Adjustment added');
      setForm({ direction: 'add', amount: '', reason: '' });
      load();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add the adjustment'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    try {
      await apiClient.delete(`/billing/adjustments/${item.id}`);
      load();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to remove the adjustment'), 'Something went wrong');
    }
  }

  return (
    <Drawer open title={`Adjust billing · ${target.project.name}`} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-tertiary-500">
          {periodLabel(target)} · calculated from approved project timesheet hours {amountText(target.totals.amount, currency)}. Add a + or − tweak; it is listed on the invoice and audited. A locked month is flagged for review.
        </p>
        <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
          {data.items.length === 0 && <li className="px-3 py-2 text-xs text-tertiary-400">No adjustments for this month.</li>}
          {data.items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className={`font-medium tabular-nums ${a.amount < 0 ? 'text-danger-700' : 'text-success-700'}`}>{a.amount > 0 ? '+' : ''}{amountText(a.amount, currency)}</span>
                <span className="block text-xs text-tertiary-500">{a.reason}{a.creator?.name ? ` · ${a.creator.name}` : ''}</span>
              </span>
              <button type="button" className="btn-ghost text-xs" onClick={() => remove(a)}>Remove</button>
            </li>
          ))}
        </ul>
        <p className="text-right font-semibold text-tertiary-900">Final amount: {amountText(Number(target.totals.amount) + Number(data.total), currency)}{data.total ? ` (${data.total > 0 ? '+' : ''}${amountText(data.total, currency)})` : ''}</p>
        <form onSubmit={add} className="grid gap-3 rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Type
            <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="add">Add (+)</option>
              <option value="subtract">Deduct (−)</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Amount ({currency})
            <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-3">
            Reason (required)
            <input required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Agreed discount, SLA credit, extra support" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <div className="sm:col-span-3">
            <button type="submit" className="btn-primary" disabled={saving || !(Number(form.amount) > 0) || form.reason.trim().length < 3}>{saving ? 'Saving…' : 'Add adjustment'}</button>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
