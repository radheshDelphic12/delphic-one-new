import { useState } from 'react';
import { ENTRY_KINDS, ENTRY_STATUSES, EXPENSE_CLASSES, PAYMENT_METHODS, inr } from '../../lib/foundation/meta.js';
import { Area, DateInput, Num, Select, Text, dayOf, toBody, today } from './ui.jsx';

/**
 * One form for money going out, coming in, or moving between the foundation's own accounts. The kind decides which fields
 * apply. If the server refuses a spend because it would pass the budget, `overBudget` carries the numbers and the
 * form shows them; someone who may override then gives the reason and saves again.
 */
export default function EntryForm({ initial, fixedCampaign, campaigns = [], categories, canApprove, canOverride, overBudget, needsReason, onSubmit, onCancel, saving, error }) {
  const editing = Boolean(initial);
  const [v, setV] = useState(() => ({
    kind: initial?.kind || 'expense',
    status: initial?.status || '',
    campaign_id: fixedCampaign?.id || initial?.campaign_id || '',
    category_id: initial?.category_id || '',
    expense_class: initial?.expense_class || '',
    entry_date: dayOf(initial?.entry_date) || today(),
    amount: initial?.amount ?? '',
    payment_method: initial?.payment_method ?? '',
    party_name: initial?.party_name ?? '',
    reference: initial?.reference ?? '',
    description: initial?.description ?? '',
    override_reason: '',
    reason: '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const scope = v.kind === 'funding' ? 'funding' : 'expense';
  const catOptions = categories.filter((c) => c.scope === scope && c.active).map((c) => ({ value: c.id, label: c.name }));
  // A person who cannot approve records spending as pending; finance and admins may enter it already approved or paid.
  const startStatuses = v.kind === 'expense' ? ENTRY_STATUSES.expense.filter((s) => ['pending', ...(canApprove ? ['approved', 'paid'] : [])].includes(s.value)) : v.kind === 'funding' ? ENTRY_STATUSES.funding.filter((s) => s.value !== 'cancelled') : [];
  const status = v.status || (v.kind === 'expense' ? 'pending' : v.kind === 'funding' ? 'received' : 'recorded');
  const counted = (initial ? initial.status : status) && ['approved', 'paid', 'received'].includes(initial ? initial.status : status);
  const klass = v.expense_class || (v.campaign_id ? 'programme' : 'operational');
  const submit = (e) => {
    e.preventDefault();
    const body = toBody({ ...v, category_id: v.category_id || '' }, { numbers: ['amount'] });
    delete body.reason; delete body.kind; delete body.status; delete body.expense_class; delete body.override_reason;
    if (v.kind === 'transfer') delete body.campaign_id;
    if (v.reason.trim()) body.reason = v.reason.trim();
    if (editing) {
      if (v.override_reason.trim()) body.override_reason = v.override_reason.trim();
      body.expense_class = v.kind === 'expense' ? klass : undefined;
      onSubmit(body);
      return;
    }
    onSubmit({ ...body, kind: v.kind, status, ...(v.kind === 'expense' ? { expense_class: klass } : {}), ...(v.override_reason.trim() ? { override_reason: v.override_reason.trim() } : {}) });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {!editing && <Select label="Type" className="sm:col-span-2" value={v.kind} onChange={(k) => setV((c) => ({ ...c, kind: k, status: '', category_id: '' }))} options={ENTRY_KINDS.map((k) => ({ value: k.value, label: `${k.label} - ${k.hint}` }))} />}
        {!fixedCampaign && v.kind !== 'transfer' && <Select label="Campaign" value={v.campaign_id} onChange={set('campaign_id')} options={campaigns} blank={v.kind === 'expense' ? 'General (no campaign)' : 'General fund (no campaign)'} />}
        {v.kind !== 'transfer' && <Select label={v.kind === 'funding' ? 'Funding source' : 'Spending category'} value={v.category_id} onChange={set('category_id')} options={catOptions} blank="Not set" />}
        {v.kind === 'expense' && <Select label="Counts as" className="sm:col-span-2" value={klass} onChange={set('expense_class')} options={EXPENSE_CLASSES} />}
        {!editing && startStatuses.length > 1 && <Select label="Status" value={status} onChange={set('status')} options={startStatuses.map((s) => ({ value: s.value, label: `${s.label} - ${s.hint}` }))} />}
        <DateInput label="Date" value={v.entry_date} onChange={set('entry_date')} required />
        <Num label="Amount (₹)" value={v.amount} onChange={set('amount')} required min="0.01" />
        <Text label={v.kind === 'funding' ? 'Donor / contributor' : v.kind === 'transfer' ? 'From / to' : 'Payee / beneficiary'} value={v.party_name} onChange={set('party_name')} maxLength={200} />
        <Select label="Payment method" value={v.payment_method} onChange={set('payment_method')} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} blank="Not set" />
        <Text label="Reference number" value={v.reference} onChange={set('reference')} maxLength={120} placeholder="Invoice, voucher or transaction id" />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.description} onChange={set('description')} maxLength={2000} />
      </div>
      {v.kind === 'transfer' && <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">An internal transfer only records that money moved between accounts. It is never counted as income or expense.</p>}
      {((editing && counted) || needsReason) && <Text label={needsReason ? 'Reason (this month is closed; recorded in the audit trail)' : 'Reason for the change (required: this money already counts)'} value={v.reason} onChange={set('reason')} maxLength={500} required />}
      {overBudget && (
        <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">This would take the campaign {inr(overBudget.detail?.overspend)} over its allocated budget.</p>
          <p className="text-xs">Allocated {inr(overBudget.detail?.allocated)} · already spent or committed {inr(overBudget.detail?.committed_or_spent)} · left {inr(overBudget.detail?.remaining)}.</p>
          {canOverride ? <Text label="Reason for going over budget (recorded in the audit trail)" value={v.override_reason} onChange={set('override_reason')} maxLength={500} required /> : <p className="text-xs">Ask an admin to approve it, or revise the campaign budget first.</p>}
        </div>
      )}
      {error && !overBudget && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Save entry'}</button>
      </div>
    </form>
  );
}
