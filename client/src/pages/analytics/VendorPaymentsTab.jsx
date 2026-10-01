import { useEffect, useMemo, useState } from 'react';
import { Building2, IndianRupee, Printer, Truck, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useVendorAccountOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import RecordLockButton from '../../components/finance/RecordLockButton.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { inr } from '../../components/finance/CalculationLockBar.jsx';
import { amountText, dateText, printVendorInvoice, vendorLineText } from '../../components/finance/financePrint.js';
import { GenerateInvoiceButton } from './ClientInvoices.jsx';
import { cleanParams } from './AttendanceSalaryTab.jsx';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * One vendor's invoice for a month: a row per project (and currency) with
 * each contractor's calculation. The invoice number is editable.
 */
function VendorInvoiceDrawer({ target, onClose, onGenerated }) {
  const { pushError, pushSuccess } = useAlerts();
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ invoice_number: '', invoice_date: today(), notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    setPreview(null);
    setError('');
    apiClient.get('/billing/vendor-invoices/preview', { params: { vendor_account_id: target.vendor.id, period_month: target.period_month, period_year: target.period_year } })
      .then(({ data }) => {
        if (!alive) return;
        setPreview(data.data);
        setForm({ invoice_number: data.data.suggested_number || '', invoice_date: data.data.existing?.invoice_date || today(), notes: '' });
      })
      .catch((err) => { if (alive) setError(apiErrorMessage(err, 'Nothing to invoice for this vendor')); });
    return () => { alive = false; };
  }, [target?.vendor.id, target?.period_month, target?.period_year]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return <Drawer open={false} title="" onClose={onClose} />;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/billing/vendor-invoices/generate', { vendor_account_id: target.vendor.id, period_month: target.period_month, period_year: target.period_year, invoice_number: form.invoice_number.trim(), invoice_date: form.invoice_date, notes: form.notes.trim() || null });
      pushSuccess?.(`Vendor invoice ${form.invoice_number} generated`);
      onGenerated?.();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to generate the vendor invoice'), 'Could not generate');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={`Vendor invoice · ${target.vendor.name}`}
      onClose={onClose}
      size="lg"
      tone="create"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="vendor-invoice-form" className="btn-primary" disabled={saving || !preview || !form.invoice_number.trim()}>{saving ? 'Saving…' : preview?.existing ? 'Update invoice' : 'Generate invoice'}</button>
        </>
      )}
    >
      <form id="vendor-invoice-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-tertiary-600">
            Invoice number
            <input required maxLength={50} value={form.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
            <span className="mt-0.5 block font-normal text-tertiary-400">Suggested — use the vendor&apos;s invoice number if you have it.</span>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Invoice date
            <input required type="date" value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Notes <span className="font-normal text-tertiary-400">(optional)</span>
            <textarea rows={2} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
        <p className="text-xs text-tertiary-500">
          {periodLabel(target)} · billing type: monthly vendor rate × allocation, over the days actually worked (approved timesheet hours) — or the project&apos;s contract working days where the project is set to the contract basis (+ approved overtime where the project pays it).
          {preview?.source === 'locked' && ` From the locked vendor record v${preview.locked_version}.`}
          {preview?.existing && ` Replaces the invoice generated earlier (${preview.existing.invoice_number}).`}
        </p>
        {error && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">{error}</p>}
        {(preview?.projects || []).map((p) => (
          <section key={`${p.project.id}|${p.currency}`} className="space-y-1 rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span><span className="font-medium text-tertiary-900">{p.project.name}</span>{p.project.code && <span className="text-xs text-tertiary-500"> · {p.project.code}</span>}<span className="block text-xs text-tertiary-500">Client: {p.project.client_name || '—'}</span></span>
              <span className="text-right font-semibold tabular-nums">{amountText(p.amount, p.currency)}{p.currency !== 'INR' && <span className="block text-xs font-normal text-tertiary-500">{p.amount_inr === null ? `No ${p.currency} exchange rate` : `≈ ${amountText(p.amount_inr, 'INR')} @ ₹${p.exchange_rate}`}</span>}</span>
            </div>
            <ul className="space-y-0.5 text-xs text-tertiary-700">
              {p.contractors.map((c) => <li key={c.org_membership_id}><span className="font-medium">{c.contractor}</span>: {vendorLineText(c, p.currency)} · {c.approved_hours}h logged</li>)}
            </ul>
          </section>
        ))}
      </form>
    </Drawer>
  );
}

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

/**
 * Edit a vendor invoice (all its project rows): number, date and notes apply to
 * every row; each row's amount and currency can be corrected on its own.
 */
function VendorInvoiceEditDrawer({ group, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const first = group?.rows[0];

  useEffect(() => {
    if (!group) return;
    setForm({ invoice_number: first.invoice_number || '', invoice_date: first.invoice_date || today(), notes: first.notes || '' });
    setRows(group.rows.map((r) => ({ id: r.id, label: [r.project?.client_name, r.project?.name].filter(Boolean).join(' · ') || 'Invoice', amount: String(r.amount), currency: r.currency, orig_amount: r.amount, orig_currency: r.currency })));
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!group || !form) return <Drawer open={false} title="" onClose={onClose} />;
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setRow = (id, patch) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      for (const r of rows) {
        const body = { invoice_number: form.invoice_number.trim() || null, invoice_date: form.invoice_date, notes: form.notes.trim() || null };
        if (Number(r.amount) !== Number(r.orig_amount)) body.amount = Number(r.amount);
        if (r.currency !== r.orig_currency) body.currency = r.currency;
        await apiClient.patch(`/billing/vendor-invoices/${r.id}`, body);
      }
      pushSuccess?.(`Vendor invoice ${form.invoice_number || ''} updated`);
      onSaved?.();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the vendor invoice'), 'Could not update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={`Edit vendor invoice · ${first.vendor_account?.name || ''}`}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="vendor-invoice-edit-form" className="btn-primary" disabled={saving || !form.invoice_number.trim() || rows.some((r) => !(Number(r.amount) > 0))}>{saving ? 'Saving…' : 'Save changes'}</button>
        </>
      )}
    >
      <form id="vendor-invoice-edit-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-tertiary-600">
            Invoice number
            <input required maxLength={50} value={form.invoice_number} onChange={(e) => setField('invoice_number', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Invoice date
            <input required type="date" value={form.invoice_date} onChange={(e) => setField('invoice_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Notes
            <textarea rows={2} maxLength={1000} value={form.notes} onChange={(e) => setField('notes', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-tertiary-600">Amounts per project</p>
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_8rem_6rem] items-center gap-2 rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-2 text-sm">
              <span className="truncate text-xs text-tertiary-700">{r.label}</span>
              <input type="number" step="0.01" min="0" value={r.amount} onChange={(e) => setRow(r.id, { amount: e.target.value })} className="rounded-xl border px-2 py-1.5 text-sm" aria-label={`Amount for ${r.label}`} />
              <select value={r.currency} onChange={(e) => setRow(r.id, { currency: e.target.value })} className="rounded-xl border px-2 py-1.5 text-sm" aria-label={`Currency for ${r.label}`}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
          <p className="text-xs text-tertiary-400">Changing an amount or currency overrides the calculated figure; the INR value is refreshed and the change is audited.</p>
        </div>
      </form>
    </Drawer>
  );
}

/** Generated vendor invoices of the month, one line per vendor invoice. */
function VendorInvoicesTable({ period, refreshKey, onEdit }) {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const { data, loading } = useLiveData(() => apiClient.get('/billing/vendor-invoices', { params: period }).then((r) => r.data.data), { deps: [period.period_month, period.period_year, refreshKey] });
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of data || []) {
      const key = `${r.vendor_account_id}|${r.invoice_number || r.id}`;
      if (!map.has(key)) map.set(key, { id: key, rows: [] });
      map.get(key).rows.push(r);
    }
    return [...map.values()];
  }, [data]);
  const columns = [
    { key: 'number', header: 'Invoice no.', render: (g) => <span className="font-mono text-xs font-medium text-tertiary-900">{g.rows[0].invoice_number || '—'}</span> },
    { key: 'vendor', header: 'Vendor', render: (g) => g.rows[0].vendor_account?.name || '—' },
    { key: 'projects', header: 'Client · project', render: (g) => <span className="text-xs">{g.rows.map((r) => [r.project?.client_name, r.project?.name].filter(Boolean).join(' · ')).join('; ')}</span> },
    { key: 'period', header: 'Period', render: (g) => periodLabel(g.rows[0]) },
    { key: 'date', header: 'Invoice date', render: (g) => dateText(g.rows[0].invoice_date) },
    { key: 'amount', header: 'Amount', render: (g) => <span className="font-medium tabular-nums">{g.rows.map((r) => amountText(r.amount, r.currency)).join(' + ')}</span> },
    { key: 'source', header: 'Source', render: (g) => (g.rows[0].generated ? <span className="text-xs text-success-700">Generated{g.rows[0].details?.source === 'locked' ? ` · locked v${g.rows[0].details.locked_version}` : ''}</span> : <span className="text-xs text-tertiary-500">Added by hand</span>) },
    {
      key: 'actions',
      header: 'Action',
      render: (g) => (
        <div className="flex flex-wrap gap-1">
          {onEdit && <button type="button" className="btn-ghost text-xs" onClick={() => onEdit(g)}>Edit</button>}
          {g.rows[0].generated && <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => { if (!printVendorInvoice(g.rows, user?.active_org?.name)) pushError('Allow pop-ups for this site to download the invoice.', 'Pop-up blocked'); }}><Printer className="h-3.5 w-3.5" /> Download</button>}
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} rows={groups} loading={loading} emptyLabel={`No vendor invoices for ${periodLabel(period)} yet`} />;
}

/**
 * Live Analytics → Vendors: what each vendor is owed for its contractors —
 * the contractor's monthly vendor rate × allocation over the project's
 * contract working days (same rule as client billing), plus approved
 * overtime where the project pays it. Each vendor: Generate invoice → Lock.
 * Locking a vendor creates its pending vendor payment and moves it to Locked.
 */
export default function VendorPaymentsTab() {
  const [period, setPeriod] = useState(currentPeriod());
  const [vendorId, setVendorId] = useState('');
  const [invoiceFor, setInvoiceFor] = useState(null);
  const [invoicesKey, setInvoicesKey] = useState(0);
  const [editGroup, setEditGroup] = useState(null);
  const vendorOptions = useVendorAccountOptions(true);
  const params = useMemo(() => cleanParams({ ...period, vendor_account_id: vendorId }), [period, vendorId]);
  const { data, loading, refresh } = useLiveData(() => apiClient.get('/analytics/vendor-payments', { params }).then((r) => r.data.data), { deps: [JSON.stringify(params)], intervalMs: 60000 });
  const records = useLiveData(() => apiClient.get('/analytics/vendor-payments/records', { params: period }).then((r) => r.data.data), { deps: [period.period_month, period.period_year] });
  const changed = () => { refresh?.(); records.refresh?.(); };

  const lineCols = [
    { key: 'vendor', header: 'Vendor', render: (l) => l.vendor?.name || 'No vendor set' },
    { key: 'contractor', header: 'Contractor', render: (l) => <span className="font-medium text-tertiary-900">{l.contractor}</span> },
    { key: 'client', header: 'Client', render: (l) => l.project.client_name || '—' },
    { key: 'project', header: 'Project', render: (l) => <span>{l.project.name}<span className="block text-xs text-tertiary-500">{l.project.code}</span></span> },
    { key: 'rate', header: 'Calculation', render: (l) => <span className="text-xs">{vendorLineText(l, l.currency)}</span> },
    { key: 'hours', header: 'Approved hours', render: (l) => `${l.approved_hours}h${l.overtime_hours ? ` + ${l.overtime_hours} OT` : ''}` },
    { key: 'amount', header: 'Amount', render: (l) => <span className="font-medium tabular-nums">{inr(l.amount, l.currency)}{l.currency !== 'INR' ? <span className="block text-xs text-tertiary-500">{inr(l.amount_inr)}</span> : null}</span> },
    { key: 'approval', header: 'Approval', render: (l) => (
      <span>
        <StatusBadge status={l.approval_status} size="xs" />
        {l.source === 'locked' && <span className="block text-[11px] text-success-700">locked figures</span>}
      </span>
    ) },
  ];
  const vendorCols = [
    { key: 'vendor', header: 'Vendor', render: (v) => <span className="font-medium text-tertiary-900">{v.vendor?.name || 'No vendor set'}</span> },
    { key: 'contractors', header: 'Contractors', render: (v) => v.contractors.join(', ') },
    { key: 'amount', header: 'Amount', render: (v) => (
      <span className="tabular-nums">
        <span className="font-medium">{inr(v.amount_inr)}</span>
        {Object.entries(v.by_currency || {}).filter(([cur]) => cur !== 'INR').map(([cur, amt]) => <span key={cur} className="block text-xs text-tertiary-500">{inr(amt, cur)}</span>)}
      </span>
    ) },
    { key: 'pending', header: 'Unapproved entries', render: (v) => (v.pending_entries || v.rejected_entries ? <StatusBadge status={v.rejected_entries ? 'rejected' : 'pending'} label={`${v.pending_entries} pending · ${v.rejected_entries} rejected`} size="xs" /> : <StatusBadge status="approved" label="All approved" size="xs" />) },
    { key: 'lock', header: 'Lock', render: (v) => (v.vendor ? <RecordLockButton kind="vendor_bill" scopeKey={v.vendor.id} period={period} lock={v.lock} label={`${v.vendor.name} billing`} onChanged={changed} /> : '—') },
    { key: 'invoice', header: 'Invoice', render: (v) => (v.vendor ? <GenerateInvoiceButton compact onClick={() => setInvoiceFor({ vendor: v.vendor, ...period })} /> : '—') },
  ];
  const recordCols = [
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_name },
    { key: 'period', header: 'Period', render: (r) => periodLabel(r) },
    { key: 'amount', header: 'Amount', render: (r) => inr(r.amount, r.currency) },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'created', header: 'Generated', render: (r) => new Date(r.created_at).toLocaleString() },
  ];
  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2"><PeriodPicker value={period} onChange={setPeriod} label="Month" /></div>
        <label className="block text-xs font-medium text-tertiary-600">Vendor<div className="mt-1"><SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="All vendors" allowClear /></div></label>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Owed to vendors · ${periodLabel(period)}`} value={inr(t?.amount_inr)} hint={data?.source === 'locked' ? `whole month locked v${data.locked_version}` : 'live + locked vendors'} icon={IndianRupee} theme="orange" />
        <KpiCard label="Vendors" value={t?.vendors ?? '…'} hint={t?.locked ? `${t.locked} locked` : undefined} icon={Building2} theme="blue" />
        <KpiCard label="Contractors" value={t?.contractors ?? '…'} icon={Users} theme="cyan" />
      </div>
      {data?.missing_rates?.length > 0 && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">Set the {data.missing_rates.join(', ')} exchange rate (Finance → Projects) — those amounts are left out of the INR totals and the vendor can&apos;t be locked yet.</p>}
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Vendors <span className="font-normal text-tertiary-500">— generate each vendor&apos;s invoice, then lock its billing (locked vendors move to Live Analytics → Locked)</span></h2>
        <DataTable columns={vendorCols} rows={(data?.vendors || []).map((v, i) => ({ ...v, id: v.vendor?.id || `none-${i}` }))} loading={loading} emptyLabel="No contractor work in this month" />
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Vendor invoices · {periodLabel(period)}</h2>
        <VendorInvoicesTable period={period} refreshKey={invoicesKey} onEdit={setEditGroup} />
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">By contractor and project</h2>
        <DataTable columns={lineCols} rows={(data?.lines || []).map((l) => ({ ...l, id: `${l.org_membership_id}|${l.project.id}` }))} loading={loading} emptyLabel="No contractors assigned to projects" />
      </section>
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Truck className="h-4 w-4" /> Vendor payments generated from locked vendors</h2>
        <DataTable columns={recordCols} rows={records.data || []} loading={records.loading} emptyLabel="Lock a vendor to generate its pending payment" />
      </section>
      <VendorInvoiceDrawer target={invoiceFor} onClose={() => setInvoiceFor(null)} onGenerated={() => setInvoicesKey((k) => k + 1)} />
      <VendorInvoiceEditDrawer group={editGroup} onClose={() => setEditGroup(null)} onSaved={() => setInvoicesKey((k) => k + 1)} />
    </div>
  );
}
