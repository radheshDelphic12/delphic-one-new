import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { DEAL_STATUSES, DEAL_STATUS_META, PAY_STATE, TASK_STATUS_META, pctLabel, qtyLabel, useMasters } from '../../lib/gulati/meta.js';
import { usePickers } from '../../lib/gulati/pickers.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import DealForm from '../../components/gulati/DealForm.jsx';
import GulatiDocuments from '../../components/gulati/GulatiDocuments.jsx';
import { Area, DateInput, Detail, Empty, Kpi, Money, Num, Select, Text, card, dayOf, today, toBody, withReason } from '../../components/gulati/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'sales', label: 'Sales' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'documents', label: 'Documents' },
];

// Purchase and sale lines share one form: sourcing side has a vendor, supply side a client.
function LineForm({ kind, deal, initial, parties, onSubmit, onCancel, saving }) {
  const isPurchase = kind === 'purchase';
  const partyKey = isPurchase ? 'vendor_id' : 'client_id';
  const dateKey = isPurchase ? 'purchase_date' : 'sale_date';
  const [v, setV] = useState({
    [partyKey]: initial?.[partyKey] ?? (isPurchase ? deal.vendor_id : deal.party_id) ?? '',
    [dateKey]: dayOf(initial?.[dateKey]) || today(),
    quantity: initial?.quantity ?? '',
    rate: initial?.rate ?? '',
    amount: initial ? initial.amount : '',
    tax: initial?.tax ?? 0,
    reference: initial?.reference ?? '',
    notes: initial?.notes ?? '',
  });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const auto = v.quantity !== '' && v.rate !== '' ? Number(v.quantity) * Number(v.rate) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: ['quantity', 'rate', 'amount', 'tax'] });
        // amount follows quantity x rate unless the user typed their own figure
        if (v.amount === '' || (auto !== null && Number(v.amount) === auto)) delete body.amount;
        onSubmit(body);
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={isPurchase ? 'Vendor' : 'Client'} value={v[partyKey]} onChange={set(partyKey)} options={parties} blank="Not specified" />
        <DateInput label={isPurchase ? 'Purchase date' : 'Sale / supply date'} value={v[dateKey]} onChange={set(dateKey)} required />
        <Num label={`Quantity${deal.unit ? ` (${deal.unit})` : ''}`} value={v.quantity} onChange={set('quantity')} />
        <Num label="Rate" value={v.rate} onChange={set('rate')} />
        <Num label="Amount" value={v.amount} onChange={set('amount')} hint={auto !== null ? `Quantity x rate = ${auto.toLocaleString('en-IN')} (leave blank to use it)` : 'Enter the amount, or quantity and rate'} />
        <Num label="Tax (GST)" value={v.tax} onChange={set('tax')} hint="Tracked separately; profit uses the amount before tax" />
        <Text label="Reference" className="sm:col-span-2" value={v.reference} onChange={set('reference')} maxLength={200} placeholder={isPurchase ? 'PO / invoice number' : 'Challan / invoice number'} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

function PayForm({ line, side, initial, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ amount: initial?.amount ?? (line ? Math.max(0, line.outstanding) : ''), paid_date: dayOf(initial?.paid_date) || today(), mode: initial?.mode ?? '', reference: initial?.reference ?? '', notes: initial?.notes ?? '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v, { numbers: ['amount'] })); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Num label={side === 'vendor' ? 'Amount paid to vendor' : 'Amount received from client'} value={v.amount} onChange={set('amount')} required />
        <DateInput label="Date" value={v.paid_date} onChange={set('paid_date')} required />
        <Text label="Mode" value={v.mode} onChange={set('mode')} placeholder="Bank transfer, cheque, cash..." maxLength={60} />
        <Text label="Reference" value={v.reference} onChange={set('reference')} maxLength={200} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save payment'}</button>
      </div>
    </form>
  );
}

function ExpenseForm({ initial, categories, deal, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ entry_date: dayOf(initial?.entry_date) || today(), category_id: initial?.category_id || categories[0]?.id || '', amount: initial?.amount ?? '', tax: initial?.tax ?? 0, payment_mode: initial?.payment_mode ?? '', reference: initial?.reference ?? '', description: initial?.description ?? '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...toBody(v, { numbers: ['amount', 'tax'] }), type: 'expense', deal_id: deal.id }); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Expense category" value={v.category_id} onChange={set('category_id')} options={categories.map((c) => ({ value: c.id, label: c.name }))} required />
        <DateInput label="Date" value={v.entry_date} onChange={set('entry_date')} required />
        <Num label="Amount" value={v.amount} onChange={set('amount')} required />
        <Num label="Tax (GST)" value={v.tax} onChange={set('tax')} />
        <Text label="Payment mode" value={v.payment_mode} onChange={set('payment_mode')} maxLength={60} />
        <Text label="Reference" value={v.reference} onChange={set('reference')} maxLength={200} />
        <Area label="Description" className="sm:col-span-2" rows={2} value={v.description} onChange={set('description')} maxLength={1000} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save expense'}</button>
      </div>
    </form>
  );
}

function QtyBar({ label, value, of, unit }) {
  const pct = of ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-tertiary-600"><span>{label}</span><span className="tabular-nums">{qtyLabel(value, unit)}{of ? ` of ${qtyLabel(of, unit)}` : ''}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-tertiary-100"><div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function DealTasks({ deal, canTasks, pickers, reload }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const load = useCallback(() => gulatiApi.tasks({ deal_id: deal.id }).then(setRows, () => setRows([])), [deal.id]);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault();
    try {
      await gulatiApi.createTask({ title: title.trim(), deal_id: deal.id, party_id: deal.party_id, ...(assignee ? { assignee_id: assignee } : {}), ...(due ? { due_date: due } : {}) });
      setTitle(''); setDue(''); setAssignee('');
      load(); reload();
    } catch (err) {
      pushError(gulatiError(err, 'Could not add'), 'Could not add');
    }
  }
  async function status(t, s) {
    try { await gulatiApi.updateTask(t.id, { status: s }); load(); reload(); } catch (err) { pushError(gulatiError(err), 'Could not update'); }
  }
  return (
    <div className="space-y-3">
      {canTasks && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_12rem_9rem_auto] sm:items-end">
          <Text label="New task" value={title} onChange={setTitle} placeholder="Confirm vendor material availability" required maxLength={200} />
          <Select label="Assign to" value={assignee} onChange={setAssignee} options={pickers.employees} blank="Unassigned" />
          <DateInput label="Due" value={due} onChange={setDue} />
          <button type="submit" className="btn-primary" disabled={!title.trim()}>Add</button>
        </form>
      )}
      {rows === null ? <div className="text-sm text-tertiary-500">Loading...</div> : rows.length === 0 ? <Empty>No tasks for this deal yet.</Empty> : (
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0"><span className="font-medium text-tertiary-900">{t.title}</span><span className="block text-xs text-tertiary-500">{t.code} · {t.assignee?.name || t.contractor?.name || 'Unassigned'}{t.due_date ? ` · due ${dateLabel(t.due_date)}` : ''}{t.overdue ? ' · overdue' : ''}</span></span>
              <span className="flex items-center gap-2"><Pill tone={TASK_STATUS_META[t.status]?.tone}>{TASK_STATUS_META[t.status]?.label}</Pill>{canTasks && t.status !== 'done' && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => status(t, 'done')}>Mark done</button>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GulatiDealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, loading } = useGulati();
  const { pushError, pushSuccess } = useAlerts();
  const masters = useMasters();
  const pickers = usePickers();
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null); // { kind: 'edit' | 'purchase' | 'sale' | 'pay' | 'expense', ... }
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => gulatiApi.deal(id).then((d) => { setDeal(d); setError(false); }, () => setError(true)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (me && gxCan(me, 'ledger')) gulatiApi.categories('expense').then((c) => setCategories(c.filter((x) => x.active)), () => {}); }, [me]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'deals')) return <Navigate to="/gulati" replace />;
  if (error) return <div className="py-10 text-center text-sm text-tertiary-500">Deal not found. <Link className="text-primary-700 underline" to="/gulati/deals">Back to deals</Link></div>;
  if (!deal) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;

  const isAdmin = me.role === 'admin';
  const canEdit = gxCan(me, 'dealsEdit');
  const canPay = gxCan(me, 'payments');
  const canExpense = gxCan(me, 'ledger');
  const s = deal.summary;
  const locked = ['completed', 'cancelled'].includes(deal.status) && !isAdmin;
  const unit = deal.unit;
  const close = () => setModal(null);

  async function run(fn, ok) {
    setSaving(true);
    try {
      await withReason(fn);
      if (ok) pushSuccess(ok);
      close();
      await load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status) {
    let reason;
    let actual_end;
    if (status === 'cancelled') { reason = window.prompt('Why is this deal cancelled?'); if (!reason?.trim()) return; }
    else if (['completed', 'cancelled'].includes(deal.status)) { reason = window.prompt('Reason for reopening this deal:'); if (!reason?.trim()) return; }
    if (status === 'completed') { actual_end = window.prompt('Actual completion date (YYYY-MM-DD)', today()); if (!actual_end) return; }
    try {
      await gulatiApi.setDealStatus(deal.id, { status, ...(reason ? { reason: reason.trim() } : {}), ...(actual_end ? { actual_end } : {}) });
      load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not change status'), 'Could not change status');
    }
  }
  async function removeDeal() {
    if (!window.confirm(`Delete ${deal.name}? Its purchases, sales and payments are removed from reports.`)) return;
    try {
      await gulatiApi.deleteDeal(deal.id);
      navigate('/gulati/deals');
    } catch (e) {
      pushError(gulatiError(e, 'Could not delete'), 'Delete failed');
    }
  }
  const del = (fn, label) => async () => {
    if (!window.confirm(`Delete this ${label}?`)) return;
    try { await withReason(fn); load(); } catch (e) { pushError(gulatiError(e, 'Could not delete'), 'Delete failed'); }
  };

  const saveDeal = (body) => run(async (reason) => gulatiApi.updateDeal(deal.id, { ...body, ...(reason ? { reason } : {}) }), 'Saved');
  const saveLine = (kind, body) => {
    const api = kind === 'purchase' ? [gulatiApi.createPurchase, gulatiApi.updatePurchase] : [gulatiApi.createSale, gulatiApi.updateSale];
    const row = modal.row;
    return run(async (reason) => (row ? api[1](deal.id, row.id, { ...body, ...(reason ? { reason } : {}) }) : api[0](deal.id, { ...body, ...(reason ? { reason } : {}) })), 'Saved');
  };
  const savePay = (body) => {
    const m = modal;
    return run(async (reason) => {
      const payload = { ...body, ...(reason ? { reason } : {}) };
      if (m.payment) return gulatiApi.updatePayment(deal.id, m.payment.id, payload);
      return m.side === 'vendor' ? gulatiApi.payPurchase(deal.id, m.line.id, payload) : gulatiApi.paySale(deal.id, m.line.id, payload);
    }, 'Payment saved');
  };
  const saveExpense = (body) => run(async (reason) => {
    const payload = { ...body, ...(reason ? { reason } : {}) };
    return modal.row ? gulatiApi.updateEntry(modal.row.id, payload) : gulatiApi.createEntry(payload);
  }, 'Saved');

  const lineCols = (kind) => {
    const rows = kind === 'purchase' ? deal.purchases : deal.sales;
    const dateKey = kind === 'purchase' ? 'purchase_date' : 'sale_date';
    const side = kind === 'purchase' ? 'vendor' : 'client';
    if (rows.length === 0) return <Empty>{kind === 'purchase' ? 'No purchases yet. Record what you source from vendors.' : 'No sales yet. Record each delivery or sale to the client.'}</Empty>;
    return (
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">{kind === 'purchase' ? 'Vendor' : 'Client'}</th><th className="px-3 py-2 text-right font-medium">Quantity</th><th className="px-3 py-2 text-right font-medium">Rate</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 text-right font-medium">{kind === 'purchase' ? 'Paid' : 'Received'}</th><th className="px-3 py-2 font-medium">Payment</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{dateLabel(r[dateKey])}{r.reference && <span className="block text-xs text-tertiary-400">{r.reference}</span>}</td>
                <td className="px-3 py-2">{r.party?.name || '-'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{qtyLabel(r.quantity, unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.rate !== null ? r.rate.toLocaleString('en-IN') : '-'}</td>
                <td className="px-3 py-2 text-right"><Money v={r.amount} className="font-medium" /></td>
                <td className="px-3 py-2 text-right"><Money v={r.paid} /></td>
                <td className="px-3 py-2"><Pill tone={PAY_STATE[r.payment_status].tone}>{PAY_STATE[r.payment_status].label}</Pill></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canPay && r.outstanding > 0 && <button type="button" title="Record payment" className="mr-1 rounded p-1 text-primary-700 hover:bg-primary-50" onClick={() => setModal({ kind: 'pay', side, line: r })}><Wallet className="h-4 w-4" /></button>}
                  {canEdit && !locked && <button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ kind, row: r })}><Pencil className="h-4 w-4" /></button>}
                  {canEdit && !locked && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={del((reason) => (kind === 'purchase' ? gulatiApi.deletePurchase(deal.id, r.id, reason) : gulatiApi.deleteSale(deal.id, r.id, reason)), kind)}><Trash2 className="h-4 w-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const payments = deal.payments || [];
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/gulati/deals" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"><ArrowLeft className="h-3 w-3" />Trading deals</Link>
          <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">{deal.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-tertiary-500">
            <span>{deal.code}</span><Pill tone="blue">{deal.trading_type_label}</Pill>
            <Pill tone={DEAL_STATUS_META[deal.status]?.tone}>{DEAL_STATUS_META[deal.status]?.label}</Pill>
            {s.delayed && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700"><AlertTriangle className="h-3 w-3" />Delayed</span>}
            {deal.lead && <Link className="text-primary-700 hover:underline" to="/gulati/leads">From lead {deal.lead.code}</Link>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (!locked) && (
            <select aria-label="Change status" className="rounded-xl border bg-white px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && setStatus(e.target.value)}>
              <option value="">Change status...</option>
              {DEAL_STATUSES.filter((x) => x.value !== deal.status).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          )}
          {canEdit && !locked && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'edit' })}><Pencil className="h-4 w-4" />Edit</button>}
          {gxCan(me, 'delete') && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={removeDeal}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </div>
      {locked && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">This deal is {deal.status}. Only an admin can change it.</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Purchase cost" value={<Money v={s.purchase_cost} />} />
        <Kpi label="Sales revenue" value={<Money v={s.sales_revenue} />} />
        <Kpi label="Gross profit" value={<Money v={s.gross_profit} signed />} hint={`Margin ${pctLabel(s.gross_margin_pct)}`} />
        <Kpi label="Deal expenses" value={<Money v={s.deal_expenses} />} />
        <Kpi label="Net profit" value={<Money v={s.net_profit} signed />} hint={`Margin ${pctLabel(s.net_margin_pct)}`} tone="gx-copper" />
        <Kpi label="Vendor outstanding" value={<Money v={s.vendor_outstanding} />} hint={`Paid ${Math.round(s.paid_to_vendor).toLocaleString('en-IN')}`} />
        <Kpi label="Client outstanding" value={<Money v={s.client_outstanding} />} hint={`Received ${Math.round(s.received_from_client).toLocaleString('en-IN')}`} />
      </div>

      <SectionTabs tabs={TABS} value={tab} onChange={setTab} className="min-w-0" />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${card} space-y-3`}>
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Quantity</h3>
            <QtyBar label="Sourced from vendors" value={s.quantities.sourced} of={s.quantities.ordered} unit={unit} />
            <QtyBar label="Supplied to client" value={s.quantities.supplied} of={s.quantities.ordered} unit={unit} />
            <div className="grid grid-cols-2 gap-2 pt-1 text-sm">
              <div className="rounded-xl border p-2"><div className="text-[11px] text-tertiary-500">Remaining to source</div><div className="font-semibold tabular-nums">{qtyLabel(s.quantities.remaining_to_source, unit)}</div></div>
              <div className="rounded-xl border p-2"><div className="text-[11px] text-tertiary-500">Remaining to supply</div><div className="font-semibold tabular-nums">{qtyLabel(s.quantities.remaining_to_supply, unit)}</div></div>
            </div>
          </section>
          <section className={card}>
            <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Deal details</h3>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Client">{deal.party?.name}</Detail>
              <Detail label="Vendor">{deal.vendor?.name}</Detail>
              <Detail label="Product">{[deal.product, deal.material_type].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Ordered quantity">{deal.ordered_quantity !== null ? qtyLabel(deal.ordered_quantity, unit) : null}</Detail>
              <Detail label="Start">{deal.start_date ? dateLabel(deal.start_date) : null}</Detail>
              <Detail label="Expected completion">{deal.expected_end ? dateLabel(deal.expected_end) : null}</Detail>
              <Detail label="Actual completion">{deal.actual_end ? dateLabel(deal.actual_end) : null}</Detail>
              <Detail label="Duration">{s.duration_days !== null ? `${s.duration_days} days` : null}</Detail>
              <Detail label="Location">{deal.location}</Detail>
              <Detail label="Assigned">{[deal.assignee?.name, deal.contractor?.name].filter(Boolean).join(' · ')}</Detail>
              <Detail label="Expected purchase">{deal.expected_purchase_amount !== null ? <Money v={deal.expected_purchase_amount} /> : null}</Detail>
              <Detail label="Expected sale">{deal.expected_sale_amount !== null ? <Money v={deal.expected_sale_amount} /> : null}</Detail>
              {deal.cancel_reason && <div className="sm:col-span-2"><Detail label="Cancelled because">{deal.cancel_reason}</Detail></div>}
              <div className="sm:col-span-2"><Detail label="Description"><span className="whitespace-pre-wrap">{deal.description}</span></Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{deal.notes}</span></Detail></div>
            </dl>
          </section>
        </div>
      )}

      {tab === 'purchases' && (
        <div className="space-y-3">
          {canEdit && !locked && <div className="flex justify-end"><button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'purchase' })}><Plus className="h-4 w-4" />Add purchase</button></div>}
          {lineCols('purchase')}
        </div>
      )}
      {tab === 'sales' && (
        <div className="space-y-3">
          {canEdit && !locked && <div className="flex justify-end"><button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'sale' })}><Plus className="h-4 w-4" />Add sale / supply</button></div>}
          {lineCols('sale')}
        </div>
      )}
      {tab === 'expenses' && (
        <div className="space-y-3">
          {canExpense && <div className="flex justify-end"><button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'expense' })}><Plus className="h-4 w-4" />Add expense</button></div>}
          {deal.expenses.length === 0 ? <Empty>No expenses on this deal yet (transport, loading, brokerage, documentation...).</Empty> : (
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2" /></tr></thead>
                <tbody>
                  {deal.expenses.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{dateLabel(e.entry_date)}</td>
                      <td className="px-3 py-2">{e.category_name}</td>
                      <td className="px-3 py-2 text-tertiary-600">{e.description || e.reference || '-'}</td>
                      <td className="px-3 py-2 text-right"><Money v={e.amount} className="font-medium" /></td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{canExpense && <><button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ kind: 'expense', row: e })}><Pencil className="h-4 w-4" /></button><button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={del((reason) => gulatiApi.deleteEntry(e.id, reason), 'expense')}><Trash2 className="h-4 w-4" /></button></>}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-primary-50/40 font-semibold"><td className="px-3 py-2" colSpan={3}>Total expenses</td><td className="px-3 py-2 text-right"><Money v={s.deal_expenses} /></td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
          {payments.length > 0 && (
            <section className={card}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Payments</h3>
              <ul className="divide-y text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>{dateLabel(p.paid_date)} · {p.side === 'vendor' ? 'Paid to vendor' : 'Received from client'}{p.mode ? ` · ${p.mode}` : ''}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <span className="flex items-center gap-1"><Money v={p.amount} className="font-medium" />{canPay && <><button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ kind: 'pay', side: p.side, payment: p })}><Pencil className="h-3.5 w-3.5" /></button><button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={del((reason) => gulatiApi.deletePayment(deal.id, p.id, reason), 'payment')}><Trash2 className="h-3.5 w-3.5" /></button></>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {tab === 'tasks' && <DealTasks deal={deal} canTasks={gxCan(me, 'tasksAll')} pickers={pickers} reload={load} />}
      {tab === 'documents' && <GulatiDocuments ownerType="deal" ownerId={deal.id} canEdit={canEdit || canPay} />}

      <Drawer open={modal?.kind === 'edit'} onClose={close} size="xl" tone="edit" title={`Edit ${deal.name}`}>
        {modal?.kind === 'edit' && <DealForm initial={deal} pickers={pickers} masters={masters} editing saving={saving} onSubmit={saveDeal} onCancel={close} />}
      </Drawer>
      <Modal open={['purchase', 'sale'].includes(modal?.kind)} onClose={close} wide title={`${modal?.row ? 'Edit' : 'Add'} ${modal?.kind === 'purchase' ? 'purchase' : 'sale / supply'}`}>
        {['purchase', 'sale'].includes(modal?.kind) && <LineForm kind={modal.kind} deal={deal} initial={modal.row} parties={modal.kind === 'purchase' ? pickers.vendors : pickers.clients} saving={saving} onSubmit={(b) => saveLine(modal.kind, b)} onCancel={close} />}
      </Modal>
      <Modal open={modal?.kind === 'pay'} onClose={close} title={modal?.payment ? 'Edit payment' : modal?.side === 'vendor' ? 'Pay vendor' : 'Receive from client'}>
        {modal?.kind === 'pay' && <PayForm line={modal.line} side={modal.side} initial={modal.payment} saving={saving} onSubmit={savePay} onCancel={close} />}
      </Modal>
      <Modal open={modal?.kind === 'expense'} onClose={close} wide title={modal?.row ? 'Edit expense' : 'Add deal expense'}>
        {modal?.kind === 'expense' && <ExpenseForm initial={modal.row} categories={categories} deal={deal} saving={saving} onSubmit={saveExpense} onCancel={close} />}
      </Modal>
    </div>
  );
}
