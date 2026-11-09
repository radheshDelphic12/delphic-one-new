import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, FileText, Landmark, Percent, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { KpiTile, SectionHeading } from './groupUi.jsx';

// Group Dashboard > GST & TDS (docs/features/GROUP-TAX-TRACKING.md): invoice-wise base / GST / TDS, TDS receivable, GST payable, vendor TDS.

const SUBTABS = [
  { key: 'invoices', label: 'Invoices & tax' },
  { key: 'tds', label: 'TDS receivable' },
  { key: 'gst', label: 'GST payable' },
  { key: 'vendors', label: 'TDS payable' },
  { key: 'challans', label: 'Challans' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SYMBOL = { INR: '₹', USD: '$', AED: 'AED ', EUR: '€', GBP: '£', SAR: 'SAR ' };
const money = (n, cur = 'INR') => `${Number(n) < 0 ? '-' : ''}${SYMBOL[cur] ?? `${cur} `}${Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const thr = `${th} text-right`;
const td = 'px-3 py-2 align-top';
const tdr = `${td} text-right tabular-nums`;
const labelCls = 'mb-1 block text-xs font-medium text-tertiary-600';
const todayYmd = () => new Date().toLocaleDateString('en-CA');
const thisMonth = () => todayYmd().slice(0, 7);
const monthsAgo = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return d.toLocaleDateString('en-CA').slice(0, 7); };
const TAX_BADGE = { gst_tds: ['blue', 'GST + TDS'], gst: ['blue', 'GST'], tds: ['amber', 'TDS'], none: ['gray', 'No GST / TDS'] };
const TDS_STATUS = { receivable: ['amber', 'Receivable'], part_received: ['blue', 'Part received'], received: ['green', 'Received'], not_deducted: ['gray', 'Not deducted yet'] };
const INV_STATUS = { sent: ['amber', 'Unpaid'], part_paid: ['blue', 'Part paid'], paid: ['green', 'Paid'] };

const get = (path, params) => apiClient.get(`/group-tax${path}`, { params }).then((r) => r.data.data);

function useTax(path, params, extra = '') {
  const [state, setState] = useState({ data: null, loading: true });
  const key = JSON.stringify(params) + extra;
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return get(path, params).then((data) => setState({ data, loading: false })).catch(() => setState({ data: null, loading: false }));
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

function Tiles({ children }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

function Field({ label, children }) {
  return <div><label className={labelCls}>{label}</label>{children}</div>;
}

/** A small form drawer used for every "record ..." action. */
function RecordDrawer({ open, title, onClose, onSave, busy, children, saveLabel = 'Save' }) {
  return (
    <Drawer open={open} onClose={onClose} title={title} tone="create" footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={onSave} data-testid="tax-save">{busy ? 'Saving…' : saveLabel}</button></div>}>
      <div className="space-y-3">{children}</div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function InvoicesView({ params, onOpenTds }) {
  const { data, loading } = useTax('/invoices', params);
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Skeleton className="h-48 w-full" />;
  if (!data) return <p className="text-sm text-tertiary-500">Could not load the invoices.</p>;
  const inr = data.totals.find((t) => t.currency === 'INR');
  const others = data.totals.filter((t) => t.currency !== 'INR');
  return (
    <div className="space-y-4" data-testid="tax-invoices">
      <Tiles>
        <KpiTile label="Billing (base amount)" value={money(inr?.base || 0)} icon={Receipt} theme="blue" hint={`${inr?.invoices || 0} INR invoice${inr?.invoices === 1 ? '' : 's'}`} />
        <KpiTile label="GST charged" value={money(inr?.gst || 0)} icon={Percent} theme="purple" hint="payable to the government" />
        <KpiTile label="TDS deducted by clients" value={money(inr?.tds || 0)} icon={Landmark} theme="orange" hint="comes back as a refund later" />
        <KpiTile label="Net payable by clients" value={money(inr?.total || 0)} icon={Banknote} theme="green" hint={`paid ${money(inr?.paid || 0)} · unpaid ${money(inr?.pending || 0)}`} />
      </Tiles>
      <p className="text-xs text-tertiary-500">Net payable = base + GST - TDS. <button type="button" className="text-primary-700 hover:underline" onClick={onOpenTds}>See the TDS receivable</button>.</p>

      {others.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card" data-testid="tax-other-currencies">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted"><tr><th className={th}>Other currencies (never added to INR)</th><th className={thr}>Invoices</th><th className={thr}>Base</th><th className={thr}>GST</th><th className={thr}>TDS</th><th className={thr}>Payable</th><th className={thr}>Unpaid</th></tr></thead>
            <tbody>
              {others.map((t) => (
                <tr key={t.currency} className="border-t border-tertiary-100">
                  <td className={`${td} font-medium`}>{t.currency}{t.no_tax_invoices === t.invoices && <span className="ml-2 text-xs font-normal text-tertiary-500">no GST / TDS (foreign payer)</span>}</td>
                  <td className={tdr}>{t.invoices}</td><td className={tdr}>{money(t.base, t.currency)}</td><td className={tdr}>{money(t.gst, t.currency)}</td><td className={tdr}>{money(t.tds, t.currency)}</td><td className={tdr}>{money(t.total, t.currency)}</td><td className={tdr}>{money(t.pending, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Company</th><th className={th}>Invoice</th><th className={th}>Client</th><th className={th}>Date</th><th className={thr}>Base</th><th className={thr}>GST</th><th className={thr}>TDS</th><th className={thr}>Payable</th><th className={thr}>Unpaid</th><th className={th}>Tax</th><th className={th}>Status</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.key} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={() => setOpen(r)} data-testid="tax-invoice-row">
                <td className={td}>{r.company}</td>
                <td className={`${td} font-medium text-tertiary-900`}>{r.number || '—'}{r.kind === 'group_invoice' && <span className="ml-1 text-[10px] font-normal text-tertiary-500">Book Keeping</span>}</td>
                <td className={td}>{r.client || '—'}{r.project && r.project !== r.client && <span className="block text-[11px] text-tertiary-500">{r.project}</span>}</td>
                <td className={`${td} whitespace-nowrap`}>{r.invoice_date}{r.billing_month && (r.billing_month !== r.period_month || r.billing_year !== r.period_year) && <span className="block text-[11px] text-tertiary-500" data-testid="billing-period">For {String(r.billing_month).padStart(2, '0')}/{r.billing_year}</span>}</td>
                <td className={tdr}>{money(r.base, r.currency)}{r.adjustment ? <span className="block text-[11px] font-normal text-tertiary-500" data-testid="base-adjustment">{money(r.gross_base, r.currency)} {r.adjustment < 0 ? '−' : '+'} {money(Math.abs(r.adjustment), r.currency)} adj.</span> : null}</td>
                <td className={tdr}>{r.gst ? money(r.gst, r.currency) : '—'}</td>
                <td className={tdr}>{r.tds ? money(-r.tds, r.currency) : '—'}</td>
                <td className={`${tdr} font-medium`}>{money(r.total, r.currency)}</td>
                <td className={tdr}>{r.pending ? money(r.pending, r.currency) : '—'}</td>
                <td className={td}><Pill tone={TAX_BADGE[r.tax_mode][0]}>{TAX_BADGE[r.tax_mode][1]}</Pill></td>
                <td className={td}><Pill tone={(INV_STATUS[r.status] || INV_STATUS.sent)[0]}>{(INV_STATUS[r.status] || INV_STATUS.sent)[1]}</Pill></td>
              </tr>
            ))}
            {!data.rows.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-tertiary-500">No invoices in these months.</td></tr>}
          </tbody>
        </table>
      </div>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `Invoice ${open.number || ''}` : ''} tone="info">
        {open && (
          <div className="space-y-3 text-sm" data-testid="tax-invoice-detail">
            <p className="text-xs text-tertiary-500">{open.company} · {open.client} · {open.invoice_date} · {open.fy}</p>
            <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
              <li className="flex justify-between px-3 py-2"><span>Base amount</span><b className="tabular-nums">{money(open.base, open.currency)}</b></li>
              {open.lines.map((l, i) => <li key={i} className="flex justify-between px-3 py-2"><span>{l.label} <span className="text-xs text-tertiary-400">({l.kind === 'gst' ? 'GST' : l.kind === 'tds' ? 'TDS deducted by the client' : 'other'})</span></span><b className={`tabular-nums ${l.amount < 0 ? 'text-danger-700' : ''}`}>{l.amount > 0 ? '+' : ''}{money(l.amount, open.currency)}</b></li>)}
              {!open.lines.length && <li className="px-3 py-2 text-xs text-tertiary-500">No GST or TDS on this invoice{open.currency !== 'INR' ? ' (paid in a foreign currency)' : ''}.</li>}
              <li className="flex justify-between bg-canvas-muted px-3 py-2"><span className="font-medium">Payable by the client</span><b className="tabular-nums">{money(open.total, open.currency)}</b></li>
              <li className="flex justify-between px-3 py-2"><span>Paid</span><span className="tabular-nums">{money(open.paid, open.currency)}</span></li>
              <li className="flex justify-between px-3 py-2"><span>Unpaid</span><span className="tabular-nums">{money(open.pending, open.currency)}</span></li>
            </ul>
            {open.tds > 0 && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">The {money(open.tds, open.currency)} of TDS is deposited with the government by the client and comes back as a refund later. Track it under TDS receivable.</p>}
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function TdsView({ params }) {
  const { pushError, pushSuccess } = useAlerts();
  const { data, loading, reload } = useTax('/tds-receivable', params);
  const [filter, setFilter] = useState('all');
  const [refund, setRefund] = useState(null); // { item, amount, received_on, reference, note }
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Skeleton className="h-48 w-full" />;
  if (!data) return <p className="text-sm text-tertiary-500">Could not load the TDS receivable.</p>;
  const inr = data.totals.find((t) => t.currency === 'INR');
  const items = data.items.filter((i) => (filter === 'all' ? true : filter === 'outstanding' ? i.outstanding > 0 : i.status === filter));

  async function save() {
    setBusy(true);
    try {
      await apiClient.post('/group-tax/tds-receipts', { invoice_kind: refund.item.kind, invoice_id: refund.item.id, amount: Number(refund.amount), received_on: refund.received_on, reference: refund.reference || undefined, note: refund.note || undefined });
      pushSuccess('TDS refund recorded.', 'Saved');
      setRefund(null);
      reload();
    } catch (err) { pushError(apiErrorMessage(err, 'Failed to record the refund'), 'Could not save'); } finally { setBusy(false); }
  }
  async function removeReceipt(id) {
    if (!window.confirm('Remove this refund entry? The TDS goes back to receivable.')) return;
    try { await apiClient.delete(`/group-tax/tds-receipts/${id}`, { data: {} }); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Failed to remove'), 'Something went wrong'); }
  }

  return (
    <div className="space-y-4" data-testid="tax-tds">
      <Tiles>
        <button type="button" className="text-left" onClick={() => setFilter('outstanding')} title="Show the invoices behind this"><KpiTile label="TDS receivable (asset)" value={money(inr?.outstanding || 0)} icon={Wallet} theme="orange" hint="deducted by clients, refund awaited" /></button>
        <KpiTile label="TDS deducted so far" value={money(inr?.deducted || 0)} icon={Landmark} theme="blue" hint="on invoices the client has paid" />
        <KpiTile label="Refunds received" value={money(inr?.received || 0)} icon={Banknote} theme="green" hint="recorded against invoices" />
        <KpiTile label="Yet to be deducted" value={money(inr?.yet_to_deduct || 0)} icon={FileText} theme="purple" hint="on unpaid invoices" />
      </Tiles>

      {data.by_fy.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted"><tr><th className={th}>Financial year</th><th className={th}>Currency</th><th className={thr}>Deducted</th><th className={thr}>Refund received</th><th className={thr}>Receivable</th></tr></thead>
            <tbody>{data.by_fy.map((f) => <tr key={`${f.fy}${f.currency}`} className="border-t border-tertiary-100"><td className={`${td} font-medium`}>{f.fy}</td><td className={td}>{f.currency}</td><td className={tdr}>{money(f.deducted, f.currency)}</td><td className={tdr}>{money(f.received, f.currency)}</td><td className={`${tdr} font-medium`}>{money(f.outstanding, f.currency)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="TDS status">
        {[['all', 'All'], ['outstanding', 'Receivable now'], ['receivable', 'Nothing received'], ['part_received', 'Part received'], ['received', 'Received'], ['not_deducted', 'Not deducted yet']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${filter === k ? 'border-yellow-300 bg-yellow-100 text-yellow-900' : 'border-tertiary-100 bg-canvas-muted text-tertiary-600 hover:bg-tertiary-50'}`}>{l}</button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Company</th><th className={th}>Invoice</th><th className={th}>Client</th><th className={th}>FY</th><th className={thr}>Invoice TDS</th><th className={thr}>Deducted</th><th className={thr}>Refund received</th><th className={thr}>Receivable</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.key} className="border-t border-tertiary-100" data-testid="tds-row">
                <td className={td}>{i.company}</td>
                <td className={`${td} font-medium text-tertiary-900`}>{i.number || '—'}<span className="block text-[11px] font-normal text-tertiary-500">{i.invoice_date}</span></td>
                <td className={td}>{i.client || '—'}</td>
                <td className={td}>{i.fy}</td>
                <td className={tdr}>{money(i.tds_expected, i.currency)}</td>
                <td className={tdr}>{money(i.tds_deducted, i.currency)}</td>
                <td className={tdr}>{money(i.received, i.currency)}{i.receipts.map((r) => (
                  <span key={r.id} className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-tertiary-500">{r.received_on}{r.reference ? ` · ${r.reference}` : ''}
                    <button type="button" aria-label="Remove this refund" className="text-danger-600 hover:text-danger-700" onClick={() => removeReceipt(r.id)}><Trash2 className="h-3 w-3" /></button>
                  </span>
                ))}</td>
                <td className={`${tdr} font-medium`}>{money(i.outstanding, i.currency)}</td>
                <td className={td}><Pill tone={TDS_STATUS[i.status][0]}>{TDS_STATUS[i.status][1]}</Pill></td>
                <td className={`${td} text-right`}>{i.outstanding > 0 && <button type="button" className="btn-secondary text-xs" data-testid="record-refund" onClick={() => setRefund({ item: i, amount: String(i.outstanding), received_on: todayYmd(), reference: '', note: '' })}>Record refund</button>}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-tertiary-500">No invoice with TDS here.</td></tr>}
          </tbody>
        </table>
      </div>

      <RecordDrawer open={Boolean(refund)} title="Record a TDS refund" onClose={() => setRefund(null)} onSave={save} busy={busy || !refund || !(Number(refund.amount) > 0)} saveLabel="Save refund">
        {refund && (
          <>
            <p className="text-xs text-tertiary-500">Invoice {refund.item.number} · {refund.item.client} · receivable {money(refund.item.outstanding, refund.item.currency)}</p>
            <Field label={`Amount received (${refund.item.currency}) *`}><input type="number" min="0.01" step="0.01" className={FIELD_INPUT} aria-label="Refund amount" value={refund.amount} onChange={(e) => setRefund((p) => ({ ...p, amount: e.target.value }))} /></Field>
            <Field label="Received on *"><input type="date" className={FIELD_INPUT} aria-label="Received on" value={refund.received_on} onChange={(e) => setRefund((p) => ({ ...p, received_on: e.target.value }))} /></Field>
            <Field label="Reference (refund order / bank reference)"><input className={FIELD_INPUT} aria-label="Reference" maxLength={120} value={refund.reference} onChange={(e) => setRefund((p) => ({ ...p, reference: e.target.value }))} /></Field>
            <Field label="Note"><textarea rows={2} className={FIELD_INPUT} maxLength={500} value={refund.note} onChange={(e) => setRefund((p) => ({ ...p, note: e.target.value }))} /></Field>
          </>
        )}
      </RecordDrawer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
const KIND_LABEL = {
  gst: 'GST payment',
  gst_credit: 'GST credit set off',
  tds_salary: 'TDS on salaries (employees)',
  tds_vendor: 'TDS on vendor / contractor payments',
  advance_tax: 'Advance tax / income tax',
  pf: 'PF',
  esi: 'ESI',
  pt: 'Professional tax',
  other: 'Other',
};

async function downloadChallan(id, name) {
  const { data: blob } = await apiClient.get(`/group-tax/challans/${id}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'challan';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Record (or edit) a challan: what was deposited with the government, its number, the period, who it covers (employees and / or vendors,
 * picked from lists) and the uploaded challan. Used from the Challans tab, from GST payable and from TDS payable with the kind pre-chosen.
 */
function ChallanDrawer({ draft, companies, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(null);
  const [parties, setParties] = useState({ employees: [], vendors: [] });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draft) { setForm(null); setFile(null); return; }
    setForm({
      kind: draft.kind || 'gst',
      challan_number: draft.challan_number || '',
      bsr_code: draft.bsr_code || '',
      bank: draft.bank || '',
      period_month: String(draft.period_month || new Date().getMonth() + 1),
      period_year: String(draft.period_year || new Date().getFullYear()),
      covers_months: draft.covers_months || 1,
      amount: draft.amount != null ? String(draft.amount) : '',
      paid_on: draft.paid_on || todayYmd(),
      org_id: draft.org_id || '',
      note: draft.note || '',
      picked: (draft.parties || []).map((p) => ({ key: `${p.kind}:${p.id}`, kind: p.kind, id: p.id, label: p.label, amount: p.amount != null ? String(p.amount) : '' })),
    });
    get('/parties').then(setParties).catch(() => {});
  }, [draft]);

  if (!draft || !form) return <Drawer open={false} title="" onClose={onClose} />;
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const options = [
    ...parties.employees.map((e) => ({ id: `employee:${e.id}`, label: e.label, hint: `Employee · ${e.hint}` })),
    ...parties.vendors.map((v) => ({ id: `vendor:${v.id}`, label: v.label, hint: `Vendor · ${v.hint}` })),
  ];
  const labelOf = new Map(options.map((o) => [o.id, o.label]));
  const onPick = (keys) => setForm((p) => ({
    ...p,
    picked: keys.map((key) => p.picked.find((x) => x.key === key) || { key, kind: key.split(':')[0], id: key.split(':')[1], label: labelOf.get(key) || key, amount: '' }),
  }));
  const credit = form.kind === 'gst_credit';

  async function save() {
    setBusy(true);
    try {
      const body = new FormData();
      const fields = { kind: form.kind, challan_number: form.challan_number, bsr_code: form.bsr_code, bank: form.bank, period_month: form.period_month, period_year: form.period_year, covers_months: form.covers_months, amount: form.amount, paid_on: form.paid_on, org_id: form.org_id, note: form.note };
      for (const [k, v] of Object.entries(fields)) body.append(k, v ?? '');
      body.append('parties', JSON.stringify(form.picked.map((x) => ({ kind: x.kind, id: x.id, ...(Number(x.amount) > 0 ? { amount: Number(x.amount) } : {}) }))));
      if (file) body.append('file', file);
      if (draft.id) await apiClient.patch(`/group-tax/challans/${draft.id}`, body);
      else await apiClient.post('/group-tax/challans', body);
      pushSuccess(draft.id ? 'Challan updated.' : 'Challan recorded.', 'Saved');
      onSaved?.();
      onClose();
    } catch (err) { pushError(apiErrorMessage(err, 'Failed to save the challan'), 'Could not save'); } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} title={draft.id ? 'Edit challan' : credit ? 'Record a GST credit' : 'Record a challan'} tone={draft.id ? 'edit' : 'create'} size="lg"
      footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" data-testid="challan-save" disabled={busy || !(Number(form.amount) > 0) || !form.paid_on} onClick={save}>{busy ? 'Saving…' : 'Save challan'}</button></div>}>
      <div className="space-y-3" data-testid="challan-form">
        <Field label="What was deposited *">
          <select className={FIELD_INPUT} aria-label="Challan type" value={form.kind} onChange={set('kind')}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {!credit && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Challan number (CIN / CRN)"><input className={FIELD_INPUT} aria-label="Challan number" maxLength={60} value={form.challan_number} onChange={set('challan_number')} /></Field>
            <Field label="BSR code"><input className={FIELD_INPUT} aria-label="BSR code" maxLength={20} value={form.bsr_code} onChange={set('bsr_code')} /></Field>
            <Field label="Bank"><input className={FIELD_INPUT} aria-label="Bank" maxLength={80} value={form.bank} onChange={set('bank')} /></Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount (INR) *"><input type="number" min="0.01" step="0.01" className={FIELD_INPUT} aria-label="Challan amount" value={form.amount} onChange={set('amount')} /></Field>
          <Field label={credit ? 'Date *' : 'Paid on *'}><input type="date" className={FIELD_INPUT} aria-label="Paid on" value={form.paid_on} onChange={set('paid_on')} /></Field>
          <Field label="Company">
            <select className={FIELD_INPUT} aria-label="Company" value={form.org_id} onChange={set('org_id')}>
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="For the month"><select className={FIELD_INPUT} aria-label="Period month" value={form.period_month} onChange={set('period_month')}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Year"><input type="number" className={FIELD_INPUT} aria-label="Period year" value={form.period_year} onChange={set('period_year')} /></Field>
          <Field label="Covers"><select className={FIELD_INPUT} aria-label="Covers" value={form.covers_months} onChange={(e) => setForm((p) => ({ ...p, covers_months: Number(e.target.value) }))}><option value={1}>That month</option><option value={3}>The quarter ending that month</option></select></Field>
        </div>
        <Field label="Who this covers (pick employees and / or vendors)">
          <MultiSelectDropdown value={form.picked.map((x) => x.key)} onChange={onPick} options={options} placeholder="Choose employees and vendors" searchPlaceholder="Search people and vendors…" emptyMessage="No employees or vendors found." />
        </Field>
        {form.picked.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-2" data-testid="challan-parties">
            {form.picked.map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{x.label} <span className="text-xs text-tertiary-400">{x.kind}</span></span>
                <input type="number" min="0" step="0.01" placeholder="Amount (optional)" aria-label={`Amount for ${x.label}`} className="w-36 rounded-lg border border-tertiary-200 px-2 py-1 text-right text-sm" value={x.amount} onChange={(e) => setForm((p) => ({ ...p, picked: p.picked.map((y) => (y.key === x.key ? { ...y, amount: e.target.value } : y)) }))} />
              </li>
            ))}
            {form.picked.some((x) => Number(x.amount) > 0) && <li className="text-right text-xs text-tertiary-500">Listed amounts: {money(form.picked.reduce((s, x) => s + (Number(x.amount) || 0), 0))} of {money(Number(form.amount) || 0)}</li>}
          </ul>
        )}
        <Field label={draft.has_file ? `Challan file (one is already uploaded: ${draft.file_name}; choose another to replace it)` : 'Upload the challan (PDF or image)'}>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="block w-full text-sm" aria-label="Challan file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Field label="Note"><textarea rows={2} className={FIELD_INPUT} maxLength={500} value={form.note} onChange={set('note')} /></Field>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function ChallanRow({ c, onEdit, onRemove, onFile }) {
  return (
    <tr className="border-t border-tertiary-100" data-testid="challan-row">
      <td className={`${td} whitespace-nowrap`}>{c.paid_on}</td>
      <td className={td}><Pill tone={c.kind.startsWith('gst') ? 'blue' : c.kind.startsWith('tds') ? 'amber' : 'gray'}>{c.kind_label}</Pill></td>
      <td className={`${td} font-medium text-tertiary-900`}>{c.challan_number || '—'}{c.bsr_code && <span className="block text-[11px] font-normal text-tertiary-500">BSR {c.bsr_code}</span>}</td>
      <td className={td}>{c.company}</td>
      <td className={td}>{c.period}</td>
      <td className={td}>{c.parties.length ? <span title={c.parties.map((p) => p.label).join(', ')}>{c.parties.slice(0, 2).map((p) => p.label).join(', ')}{c.parties.length > 2 ? ` +${c.parties.length - 2} more` : ''}</span> : <span className="text-tertiary-300">—</span>}</td>
      <td className={`${tdr} font-medium`}>{money(c.amount)}</td>
      <td className={`${td} whitespace-nowrap text-right`}>
        {c.has_file ? <button type="button" className="btn-ghost text-xs" onClick={() => onFile(c)}>Challan</button> : <span className="text-[11px] text-tertiary-400">no file</span>}
        <button type="button" className="btn-ghost text-xs" onClick={() => onEdit(c)}>Edit</button>
        <button type="button" aria-label="Remove this challan" className="rounded p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => onRemove(c)}><Trash2 className="h-3.5 w-3.5" /></button>
      </td>
    </tr>
  );
}

function useChallanActions(reload) {
  const { pushError, pushSuccess } = useAlerts();
  return {
    async remove(c) {
      const reason = window.prompt(`Remove the ${c.kind_label} challan ${c.challan_number || ''}? Give a reason (optional):`);
      if (reason === null) return;
      try { await apiClient.delete(`/group-tax/challans/${c.id}`, { data: { reason: reason.trim() || undefined } }); pushSuccess('Challan removed.', 'Removed'); reload(); } catch (err) { pushError(apiErrorMessage(err, 'Failed to remove'), 'Something went wrong'); }
    },
    async file(c) {
      try { await downloadChallan(c.id, c.file_name); } catch (err) { pushError(apiErrorMessage(err, 'The challan could not be downloaded'), 'Something went wrong'); }
    },
  };
}

function ChallansView({ params, companies }) {
  const [kind, setKind] = useState('');
  const { data, loading, reload } = useTax('/challans', { ...params, ...(kind ? { kind } : {}) }, kind);
  const [draft, setDraft] = useState(null);
  const actions = useChallanActions(reload);
  if (loading && !data) return <Skeleton className="h-48 w-full" />;
  if (!data) return <p className="text-sm text-tertiary-500">Could not load the challans.</p>;
  const total = data.totals.reduce((s, t) => s + t.amount, 0);
  return (
    <div className="space-y-4" data-testid="tax-challans">
      <Tiles>
        <KpiTile label="Deposited with the government" value={money(total)} icon={Landmark} theme="blue" hint={`${data.items.length} challan${data.items.length === 1 ? '' : 's'} in these months (by paid date)`} />
        {data.totals.slice(0, 3).map((t) => <KpiTile key={t.kind} label={t.label} value={money(t.amount)} icon={FileText} theme={t.kind.startsWith('gst') ? 'purple' : t.kind.startsWith('tds') ? 'orange' : 'green'} hint={`${t.challans} challan${t.challans === 1 ? '' : 's'}`} />)}
      </Tiles>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-72"><label className={labelCls}>Type</label>
          <SearchableSelect ariaLabel="Challan type filter" allowClear value={kind} onChange={setKind} options={data.kinds.map((k) => ({ value: k.value, label: k.label }))} placeholder="All challans" searchPlaceholder="Search…" />
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="add-challan" onClick={() => setDraft({ kind: kind || 'gst' })}><Plus className="h-4 w-4" /> Record challan</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Paid on</th><th className={th}>Type</th><th className={th}>Challan no.</th><th className={th}>Company</th><th className={th}>For</th><th className={th}>Covers</th><th className={thr}>Amount</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.items.map((c) => <ChallanRow key={c.id} c={c} onEdit={setDraft} onRemove={actions.remove} onFile={actions.file} />)}
            {!data.items.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-tertiary-500">No challan recorded in these months.</td></tr>}
          </tbody>
        </table>
      </div>
      <ChallanDrawer draft={draft} companies={companies} onClose={() => setDraft(null)} onSaved={reload} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function GstView({ params, companies }) {
  const [by, setBy] = useState('month');
  const { data, loading, reload } = useTax('/gst', { ...params, by }, by);
  const [open, setOpen] = useState(null); // a period row opened for its invoices and payments
  const [draft, setDraft] = useState(null);
  const actions = useChallanActions(reload);
  if (loading && !data) return <Skeleton className="h-48 w-full" />;
  if (!data) return <p className="text-sm text-tertiary-500">Could not load the GST figures.</p>;
  const t = data.totals;

  const openPay = (p) => {
    const m = by === 'quarter' ? Number(p.key.endsWith('Q1') ? 6 : p.key.endsWith('Q2') ? 9 : p.key.endsWith('Q3') ? 12 : 3) : Number(p.key.slice(5, 7));
    const y = by === 'quarter' ? (m === 3 ? Number(p.key.slice(0, 4)) + 1 : Number(p.key.slice(0, 4))) : Number(p.key.slice(0, 4));
    setDraft({ kind: 'gst', period_month: m, period_year: y, covers_months: by === 'quarter' ? 3 : 1, amount: Math.max(p.payable, 0) || '' });
  };

  return (
    <div className="space-y-4" data-testid="tax-gst">
      <Tiles>
        <KpiTile label="GST collected" value={money(t.collected)} icon={Percent} theme="purple" hint="on the invoices of these months" />
        <KpiTile label="GST paid to the government" value={money(t.paid)} icon={Banknote} theme="green" hint="challans recorded" />
        <KpiTile label="Credits set off" value={money(t.credits)} icon={FileText} theme="blue" hint="input tax credit etc." />
        <KpiTile label="GST still to pay" value={money(t.balance)} icon={Wallet} theme="orange" hint="all months up to the last one shown" />
      </Tiles>
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-xl border border-tertiary-100 bg-white p-0.5 text-xs" role="tablist" aria-label="GST period">
          {[['month', 'Month-wise'], ['quarter', 'Quarter-wise']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} data-testid={`gst-by-${k}`} onClick={() => setBy(k)} className={`rounded-[10px] px-3 py-1.5 font-medium ${by === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{l}</button>)}
        </div>
        <p className="text-xs text-tertiary-500">GST is due on the invoice date. Indian quarters: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar. INR invoices only.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Period</th><th className={thr}>GST collected</th><th className={thr}>Paid</th><th className={thr}>Credits</th><th className={thr}>Payable</th><th className={thr}>Balance carried</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.periods.map((p) => (
              <GstPeriodRows key={p.key} p={p} open={open === p.key} onToggle={() => setOpen(open === p.key ? null : p.key)} onPay={() => openPay(p)} onRemove={(x) => actions.remove({ id: x.id, kind_label: x.kind === 'credit' ? 'GST credit' : 'GST', challan_number: x.challan_number })} onFile={(x) => actions.file({ id: x.id, file_name: `challan-${x.challan_number || x.id}` })} />
            ))}
            {!data.periods.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-tertiary-500">No GST in these months.</td></tr>}
          </tbody>
        </table>
      </div>
      <ChallanDrawer draft={draft} companies={companies} onClose={() => setDraft(null)} onSaved={reload} />
    </div>
  );
}

function GstPeriodRows({ p, open, onToggle, onPay, onRemove, onFile }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" onClick={onToggle} data-testid="gst-row">
        <td className={`${td} font-medium text-tertiary-900`}>{p.label}</td>
        <td className={tdr}>{money(p.collected)}</td>
        <td className={tdr}>{money(p.paid)}</td>
        <td className={tdr}>{money(p.credits)}</td>
        <td className={`${tdr} font-medium`}>{money(p.payable)}</td>
        <td className={tdr}>{money(p.balance)}</td>
        <td className={`${td} text-right`}><button type="button" className="btn-secondary text-xs" data-testid="record-gst" onClick={(e) => { e.stopPropagation(); onPay(); }}><Plus className="mr-1 inline h-3 w-3" />Record challan</button></td>
      </tr>
      {open && (
        <tr className="bg-canvas-muted/60" data-testid="gst-detail">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-xs font-semibold text-tertiary-600">Invoices ({p.invoices.length})</p>
            <ul className="mb-2 mt-1 space-y-0.5 text-xs">{p.invoices.map((i) => <li key={i.key} className="flex justify-between"><span>{i.number || '—'} · {i.client} · {i.company} · {i.invoice_date} · base {money(i.base)}</span><b className="tabular-nums">{money(i.gst)}</b></li>)}</ul>
            {p.payments.length > 0 && <p className="text-xs font-semibold text-tertiary-600">Challans and credits</p>}
            <ul className="mt-1 space-y-0.5 text-xs">{p.payments.map((x) => <li key={x.id} className="flex items-center justify-between"><span>{x.kind === 'credit' ? 'Credit' : 'Paid'} on {x.paid_on}{x.challan_number ? ` · challan ${x.challan_number}` : ''}{x.note ? ` · ${x.note}` : ''}{x.covers_months === 3 ? ' · quarter' : ''}</span><span className="flex items-center gap-2"><b className="tabular-nums">{money(x.amount)}</b>{x.has_file && <button type="button" className="text-primary-700 hover:underline" onClick={() => onFile(x)}>Challan</button>}<button type="button" aria-label="Remove this entry" className="text-danger-600" onClick={() => onRemove(x)}><Trash2 className="h-3.5 w-3.5" /></button></span></li>)}</ul>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function TdsPayableView({ params, companies }) {
  const { data, loading, reload } = useTax('/tds-payable', params);
  const [draft, setDraft] = useState(null);
  const actions = useChallanActions(reload);
  if (loading && !data) return <Skeleton className="h-48 w-full" />;
  if (!data) return <p className="text-sm text-tertiary-500">Could not load the TDS withheld.</p>;
  const record = (kind, owed) => setDraft({ kind, amount: Math.max(owed, 0) || '' });

  return (
    <div className="space-y-4" data-testid="tax-vendors">
      <Tiles>
        <KpiTile label="TDS withheld from salaries" value={money(data.employees.withheld)} icon={Landmark} theme="orange" hint={`deposited ${money(data.employees.deposited)}`} />
        <KpiTile label="Salary TDS still to deposit" value={money(data.employees.to_deposit)} icon={Wallet} theme="purple" hint="withheld - challans recorded" />
        <KpiTile label="TDS withheld from vendors" value={money(data.inr.withheld)} icon={Landmark} theme="orange" hint={`deposited ${money(data.inr.deposited)}`} />
        <KpiTile label="Vendor TDS still to deposit" value={money(data.inr.to_deposit)} icon={Wallet} theme="purple" hint="withheld - challans recorded" />
      </Tiles>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="record-deposit-salary" onClick={() => record('tds_salary', data.employees.to_deposit)}><Plus className="h-4 w-4" /> Challan for salary TDS</button>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="record-deposit" onClick={() => record('tds_vendor', data.inr.to_deposit)}><Plus className="h-4 w-4" /> Challan for vendor TDS</button>
      </div>

      <SectionHeading title="Employees" hint="TDS taken from the salary (Payroll > Salary adjustments > TDS)" />
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Company</th><th className={th}>Employee</th><th className={th}>Month</th><th className={thr}>TDS withheld</th><th className={th}>Note</th></tr></thead>
          <tbody>
            {data.employee_rows.map((r) => <tr key={r.id} className="border-t border-tertiary-100" data-testid="employee-tds-row"><td className={td}>{r.company}</td><td className={`${td} font-medium`}>{r.employee}{r.employee_code && <span className="ml-1 text-[11px] font-normal text-tertiary-500">{r.employee_code}</span>}</td><td className={td}>{r.period}</td><td className={tdr}>{money(r.tds)}</td><td className={`${td} text-xs text-tertiary-500`}>{r.note || ''}</td></tr>)}
            {!data.employee_rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-tertiary-500">No salary TDS in these months.</td></tr>}
          </tbody>
        </table>
      </div>

      <SectionHeading title="Vendors" hint="A payment to a vendor is base + GST - TDS; the GST can be entered as the invoice's adjustment until GST fields are added" />
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Company</th><th className={th}>Vendor</th><th className={th}>Invoice</th><th className={th}>Period</th><th className={thr}>Base</th><th className={thr}>TDS withheld</th><th className={thr}>Adjustment / GST</th><th className={thr}>Net payable</th></tr></thead>
          <tbody>
            {data.rows.map((r) => <tr key={r.id} className="border-t border-tertiary-100" data-testid="vendor-tds-row"><td className={td}>{r.company}</td><td className={`${td} font-medium`}>{r.vendor}{r.project && <span className="block text-[11px] font-normal text-tertiary-500">{r.project}</span>}</td><td className={td}>{r.number || '—'}</td><td className={td}>{r.period}</td><td className={tdr}>{money(r.base, r.currency)}</td><td className={tdr}>{money(r.tds, r.currency)}</td><td className={tdr}>{r.adjustment ? money(r.adjustment, r.currency) : '—'}</td><td className={`${tdr} font-medium`}>{money(r.net_payable, r.currency)}</td></tr>)}
            {!data.rows.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-tertiary-500">No vendor invoice with TDS in these months.</td></tr>}
          </tbody>
        </table>
      </div>

      <SectionHeading title="Challans for TDS" hint="deposited with the government" />
      <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-canvas-muted"><tr><th className={th}>Paid on</th><th className={th}>Type</th><th className={th}>Challan no.</th><th className={th}>Company</th><th className={th}>For</th><th className={th}>Covers</th><th className={thr}>Amount</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data.deposits.map((c) => <ChallanRow key={c.id} c={c} onEdit={setDraft} onRemove={actions.remove} onFile={actions.file} />)}
            {!data.deposits.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-tertiary-500">No TDS challan recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <ChallanDrawer draft={draft} companies={companies} onClose={() => setDraft(null)} onSaved={reload} />
    </div>
  );
}

/** Group Dashboard > GST & TDS. */
export default function GroupTaxTab() {
  const [view, setView] = useState('invoices');
  const [from, setFrom] = useState(monthsAgo(1));
  const [to, setTo] = useState(thisMonth());
  const [orgId, setOrgId] = useState('');
  const [currency, setCurrency] = useState('');
  const [options, setOptions] = useState({ companies: [], currencies: ['INR'] });
  useEffect(() => { get('/options').then(setOptions).catch(() => {}); }, []);
  const params = useMemo(() => ({ from, to, ...(orgId ? { org_id: orgId } : {}), ...(currency ? { currency } : {}) }), [from, to, orgId, currency]);

  return (
    <div className="space-y-4" data-testid="group-tax">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div><label className={labelCls}>From month</label><input type="month" className={FIELD_INPUT} aria-label="From month" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className={labelCls}>To month</label><input type="month" className={FIELD_INPUT} aria-label="To month" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="w-56"><label className={labelCls}>Company</label><SearchableSelect ariaLabel="Company" allowClear value={orgId} onChange={setOrgId} options={options.companies.map((c) => ({ value: c.id, label: c.name }))} placeholder="All companies" searchPlaceholder="Search…" /></div>
        {(view === 'invoices' || view === 'tds') && <div className="w-36"><label className={labelCls}>Currency</label><SearchableSelect ariaLabel="Currency" allowClear value={currency} onChange={setCurrency} options={options.currencies.map((c) => ({ value: c, label: c }))} placeholder="All" searchPlaceholder="Search…" /></div>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="GST and TDS views">
        {SUBTABS.map((s) => <button key={s.key} type="button" role="tab" aria-selected={view === s.key} data-testid={`tax-view-${s.key}`} onClick={() => setView(s.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${view === s.key ? 'border-yellow-300 bg-yellow-100 text-yellow-900 shadow-sm' : 'border-tertiary-100 bg-canvas-muted text-tertiary-600 hover:bg-tertiary-50'}`}>{s.label}</button>)}
      </div>
      {view === 'invoices' && <InvoicesView params={params} onOpenTds={() => setView('tds')} />}
      {view === 'tds' && <TdsView params={params} />}
      {view === 'gst' && <GstView params={{ from, to, ...(orgId ? { org_id: orgId } : {}) }} companies={options.companies} />}
      {view === 'vendors' && <TdsPayableView params={{ from, to, ...(orgId ? { org_id: orgId } : {}) }} companies={options.companies} />}
      {view === 'challans' && <ChallansView params={{ from, to, ...(orgId ? { org_id: orgId } : {}) }} companies={options.companies} />}
    </div>
  );
}
