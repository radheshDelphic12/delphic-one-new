import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { amountText } from './financePrint.js';

const PRESETS = [
  { label: 'GST', mode: 'percent', value: 18, effect: 'add' },
  { label: 'TDS', mode: 'percent', value: 10, effect: 'deduct' },
  { label: 'Other', mode: 'fixed', value: '', effect: 'add' },
];
const BLANK = { label: '', mode: 'percent', value: '', effect: 'add' };

/** "18% added" / "INR 500.00 deducted" - how one charge reads. */
export function chargeText(c, currency) {
  const what = c.mode === 'percent' ? `${Number(c.value)}%` : amountText(c.value, currency);
  return `${what} ${c.effect === 'deduct' ? 'deducted' : 'added'}`;
}

/**
 * A contract's invoice charges - GST, TDS or anything else. Each is a percentage
 * of (or a fixed amount on) the month's FINAL approved amount (approved timesheet
 * hours + any admin adjustment), added to or deducted from what the client pays.
 * Added, edited and deleted one by one; applies to invoices generated afterwards.
 */
export default function ContractChargesSection({ accountId, currency = 'INR' }) {
  const { pushError, pushSuccess } = useAlerts();
  const [charges, setCharges] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  function load() {
    apiClient.get(`/billing/projects/${accountId}/charges`)
      .then(({ data }) => setCharges(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the charges'), 'Something went wrong'));
  }
  useEffect(load, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const reset = () => { setForm(BLANK); setEditingId(null); };
  const valid = form.label.trim() && Number(form.value) > 0 && (form.mode !== 'percent' || Number(form.value) <= 100);

  async function save() {
    setSaving(true);
    try {
      const body = { label: form.label.trim(), mode: form.mode, value: Number(form.value), effect: form.effect };
      if (editingId) await apiClient.patch(`/billing/charges/${editingId}`, body);
      else await apiClient.post(`/billing/projects/${accountId}/charges`, body);
      pushSuccess?.(editingId ? 'Charge updated' : 'Charge added');
      reset();
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the charge'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function remove(charge) {
    if (!window.confirm(`Delete "${charge.label}" from this contract? Invoices already generated keep it.`)) return;
    try {
      await apiClient.delete(`/billing/charges/${charge.id}`);
      if (editingId === charge.id) reset();
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the charge'), 'Something went wrong');
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Invoice charges (GST, TDS, other)</h3>
        <p className="text-xs text-tertiary-500">
          Worked out on the month&apos;s final approved amount (approved timesheet hours plus any adjustment). Percent = % of that amount; fixed = an amount in {currency}. “Added” raises what the client pays (GST), “deducted” lowers it (TDS). Applies to invoices generated or refreshed after the change.
        </p>
      </div>

      <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
        {charges.length === 0 && <li className="px-3 py-2 text-xs text-tertiary-400">No charges on this contract — invoices carry only the approved amount.</li>}
        {charges.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span><span className="font-medium text-tertiary-900">{c.label}</span> <span className="text-xs text-tertiary-500">· {chargeText(c, currency)}</span></span>
            <span className="flex gap-1">
              <button type="button" className="btn-ghost text-xs" onClick={() => { setEditingId(c.id); setForm({ label: c.label, mode: c.mode, value: String(c.value), effect: c.effect }); }}>Edit</button>
              <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs text-danger-700" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-2 rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-3">
        {!editingId && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="self-center text-tertiary-500">Quick add:</span>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setForm({ label: p.label, mode: p.mode, value: p.value === '' ? '' : String(p.value), effect: p.effect })}>{p.label}</button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Name
            <input value={form.label} maxLength={60} onChange={(e) => set('label', e.target.value)} placeholder="e.g. GST, TDS, Handling fee" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Type
            <select value={form.mode} onChange={(e) => set('mode', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Fixed amount ({currency})</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            {form.mode === 'percent' ? 'Percent' : 'Amount'}
            <input type="number" min="0" step="0.01" max={form.mode === 'percent' ? 100 : undefined} value={form.value} onChange={(e) => set('value', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Effect on the invoice total
            <select value={form.effect} onChange={(e) => set('effect', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="add">Add to the total (e.g. GST)</option>
              <option value="deduct">Deduct from the total (e.g. TDS)</option>
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={saving || !valid} onClick={save}><Plus className="h-4 w-4" /> {editingId ? 'Save charge' : 'Add charge'}</button>
            {editingId && <button type="button" className="btn-secondary" onClick={reset}>Cancel</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
