import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import Drawer from '../ui/Drawer.jsx';
import Pill from '../ui/Pill.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { nxCan } from '../../lib/novarex/useNovarex.js';
import { INVESTMENT_STATUS_META, PAYMENT_METHODS, STORED_STATUSES, inr } from '../../lib/novarex/meta.js';
import { Area, DateInput, Money, Num, Select, Text, dayOf, toBody, today, withReason } from './ui.jsx';

function InvestmentForm({ initial, categories, outlets = [], onSaved, onCancel, me }) {
  const editing = Boolean(initial);
  const { pushSuccess } = useAlerts();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [v, setV] = useState(() => ({
    name: initial?.name || '', category_id: initial?.category_id || '', outlet_id: initial?.outlet_id || '', investor: initial?.investor || '', investment_date: dayOf(initial?.investment_date) || today(),
    amount: initial?.amount ?? '', expected_return_amount: initial?.expected_return_amount ?? '', expected_return_date: dayOf(initial?.expected_return_date) || '',
    expected_return_rate: initial?.expected_return_rate ?? '', status: initial?.stored_status || 'active', reference: initial?.reference || '', notes: initial?.notes || '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = toBody(v, { numbers: ['amount', 'expected_return_amount', 'expected_return_rate'] });
    try {
      const saved = await withReason((reason) => (editing ? nxApi.updateInvestment(initial.id, { ...body, ...(reason ? { reason } : {}) }) : nxApi.createInvestment({ ...body, ...(reason ? { reason } : {}) })));
      pushSuccess(editing ? 'Investment updated' : 'Investment added');
      onSaved(saved);
    } catch (err) { setError(novarexError(err, 'Could not save the investment')); } finally { setSaving(false); }
  }
  const canEdit = nxCan(me, 'investmentsEdit');
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Investment name / description" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} placeholder="e.g. Growth fund, Warehouse lease deposit" />
        <Select label="Outlet" value={v.outlet_id} onChange={set('outlet_id')} options={initial?.outlet && !outlets.some((s) => s.value === initial.outlet_id) ? [{ value: initial.outlet_id, label: `${initial.outlet.code} ${initial.outlet.name}` }, ...outlets] : outlets} blank="Company level (no outlet)" hint="Pick the outlet this capital was placed in. Leave blank for company-level capital." />
        <Select label="Category / type" value={v.category_id} onChange={set('category_id')} options={categories} blank="Not set" />
        <Text label="Investor / funding source" value={v.investor} onChange={set('investor')} maxLength={200} />
        <DateInput label="Investment date" value={v.investment_date} onChange={set('investment_date')} required />
        <Num label="Original investment amount (₹)" value={v.amount} onChange={set('amount')} required min="1" />
        <Num label="Expected return amount (₹)" value={v.expected_return_amount} onChange={set('expected_return_amount')} hint="Principal + earnings you expect back. Optional." />
        <DateInput label="Expected return date" value={v.expected_return_date} onChange={set('expected_return_date')} />
        <Num label="Expected return rate (%)" value={v.expected_return_rate} onChange={set('expected_return_rate')} />
        <Select label="Status" value={v.status} onChange={set('status')} options={STORED_STATUSES.map((s) => ({ value: s.value, label: `${s.label} - ${s.hint}` }))} hint="Partially returned, completed and overdue follow automatically from the returns." />
        <Text label="Reference" className="sm:col-span-2" value={v.reference} onChange={set('reference')} maxLength={120} placeholder="Agreement, folio or deal number" />
        <Area label="Notes" className="sm:col-span-2" rows={3} value={v.notes} onChange={set('notes')} maxLength={2000} />
      </div>
      <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">A planned investment is not counted as invested until it is made active. Capital placed is not an expense, and principal that comes back is never income.</p>
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Close</button>
        {canEdit && <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Add investment'}</button>}
      </div>
    </form>
  );
}

function ReturnsPanel({ investment, onChanged, canEdit }) {
  const { pushSuccess, pushError } = useAlerts();
  const [v, setV] = useState({ return_date: today(), principal: '', earnings: '', payment_method: '', reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const open = investment.base_status && investment.counted && investment.base_status !== 'completed';
  async function add(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = toBody(v, { numbers: ['principal', 'earnings'] });
      body.principal = Number(body.principal || 0);
      body.earnings = Number(body.earnings || 0);
      const saved = await withReason((reason) => nxApi.addReturn(investment.id, { ...body, ...(reason ? { reason } : {}) }));
      pushSuccess('Return recorded');
      setV({ return_date: today(), principal: '', earnings: '', payment_method: '', reference: '', notes: '' });
      onChanged(saved);
    } catch (err) { setError(novarexError(err, 'Could not record the return')); } finally { setSaving(false); }
  }
  async function reverse(r) {
    const reason = window.prompt('Reason to reverse this return (it will stop counting):');
    if (!reason || !reason.trim()) return;
    try { onChanged(await withReason((x) => nxApi.updateReturn(r.id, { status: 'reversed', reason: x || reason.trim() }))); pushSuccess('Return reversed'); } catch (err) { pushError(novarexError(err, 'Could not reverse'), 'Not changed'); }
  }
  async function remove(r) {
    if (!window.confirm('Delete this return record?')) return;
    try { await withReason((reason) => nxApi.deleteReturn(r.id, reason)); onChanged(await nxApi.investment(investment.id)); } catch (err) { pushError(novarexError(err, 'Could not delete'), 'Not deleted'); }
  }
  return (
    <section className="mt-5 space-y-3 border-t pt-4" aria-label="Returns">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">Returns received</h3>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[['Invested', investment.amount], ['Principal returned', investment.principal_returned], ['Earnings', investment.earnings], ['Outstanding principal', investment.outstanding_principal]].map(([l, n]) => (
          <div key={l} className="rounded-xl border bg-tertiary-50/50 px-3 py-2"><div className="text-tertiary-500">{l}</div><div className="mt-0.5 text-sm font-semibold text-tertiary-900"><Money v={n} /></div></div>
        ))}
      </div>
      {investment.returns.length === 0 ? <p className="text-xs text-tertiary-400">No returns recorded yet.</p> : (
        <ul className="divide-y rounded-xl border">
          {investment.returns.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${r.status === 'reversed' ? 'opacity-55' : ''}`}>
              <span><span className="font-medium text-tertiary-900">{dayOf(r.return_date)}</span> <span className="text-xs text-tertiary-500">{r.reference || r.payment_method || ''}</span>
                <span className="block text-xs text-tertiary-600">Principal {inr(r.principal)} · Earnings {inr(r.earnings)}{r.notes ? ` · ${r.notes}` : ''}</span></span>
              <span className="flex items-center gap-1">
                {r.status === 'reversed' && <Pill tone="purple">Reversed</Pill>}
                {canEdit && r.status !== 'reversed' && <button type="button" title="Reverse" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => reverse(r)}><RotateCcw className="h-4 w-4" /></button>}
                {canEdit && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && open && (
        <form onSubmit={add} className="space-y-3 rounded-xl border bg-tertiary-50/40 p-3">
          <p className="text-xs font-medium text-tertiary-700">Record a return - principal and earnings are kept apart</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DateInput label="Date received" value={v.return_date} onChange={set('return_date')} required />
            <Select label="Payment method" value={v.payment_method} onChange={set('payment_method')} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} blank="Not set" />
            <Num label="Principal returned (₹)" value={v.principal} onChange={set('principal')} max={investment.outstanding_principal} hint={`Up to ${inr(investment.outstanding_principal)} is still outstanding. This is not income.`} />
            <Num label="Earnings received (₹)" value={v.earnings} onChange={set('earnings')} hint="Profit / interest on top of the principal. This is income." />
            <Text label="Reference" value={v.reference} onChange={set('reference')} maxLength={120} />
            <Text label="Notes" value={v.notes} onChange={set('notes')} maxLength={1000} />
          </div>
          {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
          <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={saving || !(Number(v.principal) > 0 || Number(v.earnings) > 0)}>{saving ? 'Saving...' : 'Record return'}</button></div>
        </form>
      )}
      {canEdit && investment.counted && investment.base_status === 'completed' && <p className="text-xs text-tertiary-500">All principal is back. Earnings can still be recorded by editing the investment status if more are due.</p>}
    </section>
  );
}

/** Add, edit and record the returns of one investment. */
export default function InvestmentDrawer({ open, investment, categories, outlets, me, onClose, onChanged }) {
  const [current, setCurrent] = useState(investment);
  useEffect(() => { setCurrent(investment); }, [investment, open]);
  const changed = (inv) => { if (inv?.id) setCurrent(inv); onChanged(inv); };
  const meta = current ? INVESTMENT_STATUS_META[current.status] : null;
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={current ? 'edit' : 'create'} title={current ? `${current.code} · ${current.name}` : 'New investment'}>
      {open && (
        <div>
          {current && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-tertiary-600"><Pill tone={meta?.tone}>{meta?.label}</Pill>{current.expected_return_date && <span>Expected back by {current.expected_return_date}</span>}{current.return_pct !== null && <span>Earnings so far {current.return_pct}% of the amount</span>}</div>}
          <InvestmentForm key={current?.id || 'new'} initial={current} categories={categories} outlets={outlets} me={me} onCancel={onClose} onSaved={(saved) => { changed(saved); if (!current) onClose(); }} />
          {current && <ReturnsPanel investment={current} canEdit={nxCan(me, 'investmentsEdit')} onChanged={changed} />}
        </div>
      )}
    </Drawer>
  );
}
