import { useState } from 'react';
import Drawer from '../ui/Drawer.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { vtApi, valterraError } from '../../lib/valterra/api.js';
import { ENTRY_KINDS, EXPENSE_CLASSES, PAYMENT_METHODS } from '../../lib/valterra/meta.js';
import { Area, DateInput, Num, Select, Text, dayOf, toBody, today, withReason } from './ui.jsx';

/**
 * One form for income, expenses, salaries and internal transfers. `kinds` limits what the page can record (the Salaries page
 * only records salary). A closed month asks for a reason (admin only), through withReason.
 */
export default function EntryDrawer({ open, entry, kinds = ENTRY_KINDS.map((k) => k.value), defaultKind, pickers, onClose, onSaved }) {
  const { pushSuccess } = useAlerts();
  const editing = Boolean(entry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const first = defaultKind || kinds[0];
  const [v, setV] = useState(() => ({
    kind: entry?.kind || first, site_id: entry?.site_id || '', category_id: entry?.category_id || '', person_id: entry?.person_id || '', investment_id: entry?.investment_id || '',
    entry_date: dayOf(entry?.entry_date) || today(), due_date: dayOf(entry?.due_date) || '', amount: entry?.amount ?? '', payment_status: entry?.payment_status || 'paid',
    payment_method: entry?.payment_method || '', party_name: entry?.party_name || '', reference: entry?.reference || '', description: entry?.description || '',
    expense_class: entry?.expense_class || 'operating',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const kind = v.kind;
  const catOptions = kind === 'income' ? pickers.incomeCategories : kind === 'expense' ? pickers.expenseCategories : [];

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = toBody(v, { numbers: ['amount'] });
    if (kind === 'transfer') delete body.site_id;
    if (kind !== 'salary') delete body.person_id;
    if (kind !== 'income') delete body.investment_id;
    if (!['income', 'expense'].includes(kind)) delete body.category_id;
    if (kind !== 'expense') delete body.expense_class;
    try {
      if (editing) { delete body.kind; await withReason((reason) => vtApi.updateEntry(entry.id, { ...body, ...(reason ? { reason } : {}) })); } else await withReason((reason) => vtApi.createEntry({ ...body, kind, ...(reason ? { reason } : {}) }));
      pushSuccess(editing ? 'Entry updated' : 'Entry saved');
      onSaved();
    } catch (err) { setError(valterraError(err, 'Could not save')); } finally { setSaving(false); }
  }
  const label = { income: 'Buyer / payer / source', expense: 'Paid to', salary: 'Paid to (if not in the list)', transfer: 'From / to' }[kind];
  return (
    <Drawer open={open} onClose={onClose} size="lg" tone={editing ? 'edit' : 'create'} title={editing ? `Edit ${kind}` : kinds.length === 1 ? `Record ${kind}` : 'Record money'}>
      {open && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing && kinds.length > 1 && <Select label="Type" className="sm:col-span-2" value={v.kind} onChange={(k) => setV((c) => ({ ...c, kind: k, category_id: '' }))} options={ENTRY_KINDS.filter((k) => kinds.includes(k.value)).map((k) => ({ value: k.value, label: `${k.label} - ${k.hint}` }))} />}
            {['income', 'expense'].includes(kind) && <Select label={kind === 'income' ? 'Income category' : 'Expense category'} value={v.category_id} onChange={set('category_id')} options={catOptions} blank="Not set" />}
            {kind === 'expense' && <Select label="Counts as" value={v.expense_class} onChange={set('expense_class')} options={EXPENSE_CLASSES} />}
            {kind === 'salary' && <Select label="Employee" className="sm:col-span-2" value={v.person_id} onChange={set('person_id')} options={pickers.persons} blank="Not in the list" />}
            {kind === 'income' && <Select label="Related investment (optional)" className="sm:col-span-2" value={v.investment_id} onChange={set('investment_id')} options={pickers.investments} blank="None" />}
            {kind !== 'transfer' && <Select label="Mining site" className="sm:col-span-2" value={v.site_id} onChange={set('site_id')} options={entry?.site && !pickers.sites.some((s) => s.value === entry.site_id) ? [{ value: entry.site_id, label: `${entry.site.code} ${entry.site.name}` }, ...pickers.sites] : pickers.sites} blank="Company level (no site)" hint="Pick the site this belongs to. Shared overheads stay at company level and are never spread over the sites." />}
            <DateInput label={kind === 'salary' ? 'Salary date' : 'Date'} value={v.entry_date} onChange={set('entry_date')} required />
            <Num label="Amount (₹)" value={v.amount} onChange={set('amount')} required min="0.01" />
            {kind !== 'transfer' && <Select label="Payment status" value={v.payment_status} onChange={set('payment_status')} options={[{ value: 'paid', label: kind === 'income' ? 'Received' : 'Paid' }, { value: 'unpaid', label: kind === 'income' ? 'Not received yet (receivable)' : 'Not paid yet (payable)' }, ...(editing ? [{ value: 'cancelled', label: 'Cancelled' }] : [])]} />}
            {v.payment_status === 'unpaid' && <DateInput label="Due date" value={v.due_date} onChange={set('due_date')} min={v.entry_date} />}
            <Text label={label} value={v.party_name} onChange={set('party_name')} maxLength={200} />
            <Select label="Payment method" value={v.payment_method} onChange={set('payment_method')} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} blank="Not set" />
            <Text label="Reference number" value={v.reference} onChange={set('reference')} maxLength={120} placeholder="Invoice, voucher or transaction id" />
            <Area label="Notes" className="sm:col-span-2" rows={2} value={v.description} onChange={set('description')} maxLength={1000} />
          </div>
          {kind === 'transfer' && <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">An internal transfer only records that money moved between accounts. It is never income, expense or cash in / out for the result.</p>}
          {kind === 'salary' && <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">Salary is counted once, as a salary cost. Do not also enter it as an expense.</p>}
          {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Save'}</button>
          </div>
        </form>
      )}
    </Drawer>
  );
}
