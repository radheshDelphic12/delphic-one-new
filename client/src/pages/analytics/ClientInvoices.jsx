import { useEffect, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useProjectOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import PeriodPicker, { periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { amountText, billingCalculationLines, dateText, printClientInvoice } from '../../components/finance/financePrint.js';

const today = () => new Date().toISOString().slice(0, 10);
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

/** Invoice fields + the live preview of how the amount is worked out. */
function InvoicePreview({ preview, fixedAmount }) {
  if (!preview) return null;
  const d = preview.details;
  const p = preview.project;
  return (
    <div className="space-y-2 rounded-xl border border-tertiary-100 bg-tertiary-50/60 p-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-tertiary-500">Project</dt><dd className="font-medium text-tertiary-900">{p.name}{p.code ? ` · ${p.code}` : ''}</dd>
        <dt className="text-tertiary-500">Client</dt><dd className="font-medium text-tertiary-900">{p.client_name || '—'}</dd>
        <dt className="text-tertiary-500">Billing type</dt><dd>{d.billing_type === 'one_time' ? 'One time (fixed bid)' : d.billing_type === 'monthly' ? 'Monthly' : 'Hourly'}</dd>
        <dt className="text-tertiary-500">Currency</dt><dd>{preview.currency}{d.conversion ? ` (converted from ${d.conversion.from_currency} @ ${d.conversion.exchange_rate})` : ''}</dd>
        <dt className="text-tertiary-500">Rate</dt><dd>{amountText(d.rate, d.currency)}{d.billing_type === 'hourly' ? ' / hour' : d.billing_type === 'one_time' ? ' (contract value)' : ' / month'}</dd>
        <dt className="text-tertiary-500">Billing period</dt><dd>{d.period_from ? `${dateText(d.period_from)} – ${dateText(d.period_to)}` : periodLabel(preview)}</dd>
        <dt className="text-tertiary-500">Source</dt><dd>{preview.source === 'locked' ? `Locked billing v${preview.calculation_version}` : 'Live (not locked yet)'}</dd>
      </dl>
      {preview.fixed_bid ? (
        <p className="border-t border-tertiary-200 pt-2 text-xs text-tertiary-700">Fixed-bid contract {amountText(preview.fixed_bid.total, preview.currency)}: this invoice bills only the amount entered above; GST / TDS charges on the contract are added when it is generated.{Number(fixedAmount) > 0 ? ` Invoice amount ${amountText(Number(fixedAmount), preview.currency)}.` : ''}</p>
      ) : (
      <ul className="space-y-0.5 border-t border-tertiary-200 pt-2 text-xs text-tertiary-700">
        {billingCalculationLines(d).map((line) => <li key={line}>{line}</li>)}
      </ul>
      )}
      {!preview.fixed_bid && (d.charges || []).length > 0 && (
        <ul className="space-y-0.5 border-t border-tertiary-200 pt-2 text-xs text-tertiary-700">
          <li className="flex justify-between"><span>Final approved amount</span><span className="tabular-nums">{amountText(preview.amount, preview.currency)}</span></li>
          {d.charges.map((c) => (
            <li key={`${c.label}-${c.mode}-${c.value}`} className="flex justify-between">
              <span>{c.label} ({c.mode === 'percent' ? `${c.value}%` : amountText(c.value, preview.currency)}{c.effect === 'deduct' ? ', deducted' : ''})</span>
              <span className="tabular-nums">{c.amount < 0 ? '− ' : '+ '}{amountText(Math.abs(c.amount), preview.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {!preview.fixed_bid && <p className="text-right text-base font-semibold text-tertiary-900">{(d.charges || []).length > 0 ? 'Total payable ' : ''}{amountText(preview.total_amount ?? preview.amount, preview.currency)}</p>}
    </div>
  );
}

/**
 * Generate (or refresh, while a draft) one project's invoice for a month; with
 * `initial.invoice` it edits that draft (number, date, notes, currency).
 * The invoice number is the company's own — prefilled with a suggestion, and
 * editable. The amount follows the project's contract (monthly: working-day
 * share of the rate; hourly: approved hours × rate), never re-typed by hand.
 */
export function ClientInvoiceDrawer({ open, initial, onClose, onGenerated }) {
  const { pushError, pushSuccess } = useAlerts();
  const projectOptions = useProjectOptions(open);
  const [form, setForm] = useState(null);
  const [numberEdited, setNumberEdited] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [saving, setSaving] = useState(false);
  const editing = initial?.invoice || null;

  useEffect(() => {
    if (!open) return;
    setForm({
      account_id: initial?.account_id || '',
      period: { period_month: initial.period_month, period_year: initial.period_year },
      invoice_number: editing?.invoice_number || '',
      invoice_date: editing?.invoice_date || today(),
      notes: editing?.notes || '',
      currency: editing?.currency || '',
      amount: '',
      fixedAmount: '',
      reason: '',
    });
    setNumberEdited(Boolean(editing));
    setPreview(null);
  }, [open, initial?.account_id, initial?.period_month, initial?.period_year, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !form?.account_id) { setPreview(null); return undefined; }
    let alive = true;
    setPreviewError('');
    apiClient.get('/billing/invoices/preview', { params: { account_id: form.account_id, ...form.period, ...(form.currency ? { currency: form.currency } : {}) } })
      .then(({ data }) => {
        if (!alive) return;
        setPreview(data.data);
        if (!numberEdited) setForm((f) => ({ ...f, invoice_number: data.data.suggested_number || '', invoice_date: data.data.existing?.invoice_date || f.invoice_date }));
        if (editing) setForm((f) => ({ ...f, amount: f.amount === '' ? String(editing.amount) : f.amount }));
      })
      .catch((err) => { if (alive) { setPreview(null); setPreviewError(apiErrorMessage(err, 'Nothing to invoice for that selection')); } });
    return () => { alive = false; };
  }, [open, form?.account_id, form?.period.period_month, form?.period.period_year, form?.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !form) return <Drawer open={false} title="" onClose={onClose} />;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const sentStatus = editing ? editing.status !== 'draft' : preview?.existing && preview.existing.status !== 'draft';
  const locked = !editing && sentStatus;
  const reasonMissing = Boolean(editing) && sentStatus && !form.reason.trim();
  // Fixed bid: the contract value is split into several invoices, each for an amount entered here.
  const fixed = preview?.fixed_bid || (editing?.details?.billing_type === 'one_time' ? editing.details.fixed_bid : null);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const fields = { invoice_number: form.invoice_number.trim(), invoice_date: form.invoice_date, notes: form.notes.trim() || null, ...(form.currency ? { currency: form.currency } : {}) };
      if (!editing && preview?.fixed_bid) fields.amount = Number(form.fixedAmount || preview.amount);
      if (editing) {
        if (form.amount !== '' && Number(form.amount) !== Number(editing.amount)) fields.amount = Number(form.amount);
        if (form.reason.trim()) fields.reason = form.reason.trim();
      }
      const { data } = editing
        ? await apiClient.patch(`/billing/invoices/${editing.id}`, fields)
        : await apiClient.post('/billing/invoices', { client_account_id: form.account_id, ...form.period, ...fields });
      pushSuccess?.(`Invoice ${data.data.invoice_number} ${editing || preview?.existing ? 'updated' : 'generated'}`);
      onGenerated?.(data.data);
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to generate the invoice'), 'Could not generate');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      title={editing ? 'Edit invoice' : preview?.existing ? 'Update invoice' : 'Generate invoice'}
      onClose={onClose}
      size="lg"
      tone="create"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="client-invoice-form" className="btn-primary" disabled={saving || !preview || locked || reasonMissing || !form.invoice_number.trim() || (!editing && Boolean(preview?.fixed_bid) && !(Number(form.fixedAmount) > 0))}>{saving ? 'Saving…' : editing ? 'Save changes' : preview?.existing ? 'Update invoice' : 'Generate invoice'}</button>
        </>
      )}
    >
      <form id="client-invoice-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Project
            <div className="mt-1"><SearchableSelect value={form.account_id} onChange={(v) => set('account_id', v)} options={projectOptions} placeholder="Select project" searchPlaceholder="Search projects…" disabled={Boolean(editing)} /></div>
          </label>
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Invoice currency
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} disabled={(Boolean(editing) && sentStatus) || Boolean(fixed)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-tertiary-50">
              <option value="">Project billing currency{preview && !form.currency ? ` (${preview.currency})` : ''}</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="mt-0.5 block font-normal text-tertiary-400">Another currency is converted with the exchange rates set in Finance.</span>
          </label>
          <div className="sm:col-span-2"><PeriodPicker value={form.period} onChange={(p) => set('period', { period_month: p.period_month, period_year: p.period_year })} label="Billing month" /></div>
          <label className="block text-xs font-medium text-tertiary-600">
            Invoice number
            <input required maxLength={50} value={form.invoice_number} onChange={(e) => { setNumberEdited(true); set('invoice_number', e.target.value); }} placeholder="INV-2026-001" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
            <span className="mt-0.5 block font-normal text-tertiary-400">Suggested — change it to your own numbering.</span>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Invoice date
            <input required type="date" value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          {!editing && preview?.fixed_bid && (
            <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
              Invoice amount ({preview.currency})
              <input required type="number" step="0.01" min="0.01" max={preview.fixed_bid.remaining_to_invoice} value={form.fixedAmount} onChange={(e) => set('fixedAmount', e.target.value)} placeholder={String(preview.fixed_bid.remaining_to_invoice)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              <span className="mt-0.5 block font-normal text-tertiary-400">Fixed-bid contract {amountText(preview.fixed_bid.total, preview.currency)} · already invoiced {amountText(preview.fixed_bid.invoiced, preview.currency)} · at most {amountText(preview.fixed_bid.remaining_to_invoice, preview.currency)} can still be invoiced.</span>
            </label>
          )}
          {editing && (
            <label className="block text-xs font-medium text-tertiary-600">
              Amount ({form.currency || editing.currency})
              <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              <span className="mt-0.5 block font-normal text-tertiary-400">Calculated: {amountText(preview?.amount ?? editing.amount, preview?.currency || editing.currency)}. Changing it records an override.</span>
            </label>
          )}
          {editing && (
            <label className="block text-xs font-medium text-tertiary-600">
              Reason {sentStatus ? <span className="text-danger-600">(required — invoice already {editing.status})</span> : <span className="font-normal text-tertiary-400">(optional)</span>}
              <input maxLength={500} value={form.reason} onChange={(e) => set('reason', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
            </label>
          )}
          <label className="block text-xs font-medium text-tertiary-600 sm:col-span-2">
            Notes <span className="font-normal text-tertiary-400">(optional, printed on the invoice)</span>
            <textarea rows={2} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
        {previewError && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">{previewError}</p>}
        {locked && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">Invoice {preview.existing.invoice_number} for this project and month is already {preview.existing.status} — it can no longer be changed.</p>}
        {preview?.existing && !locked && <p className="text-xs text-tertiary-500">A draft invoice ({preview.existing.invoice_number}) exists for this project and month — saving refreshes it.</p>}
        <InvoicePreview preview={preview} fixedAmount={form.fixedAmount} />
      </form>
    </Drawer>
  );
}

/** Generated client invoices for a month, with download and status steps. */
export function ClientInvoicesTable({ period, refreshKey = 0, onEdit }) {
  const { user } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiClient.get('/billing/invoices', { params: { period_month: period.period_month, period_year: period.period_year } })
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load invoices'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [period.period_month, period.period_year, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Admin delete, any status. A sent / paid invoice needs a reason (audited).
  async function remove(row) {
    const needsReason = row.status !== 'draft';
    const reason = window.prompt(needsReason
      ? `Invoice ${row.invoice_number || ''} is already ${row.status}. Give a reason to delete it (required):`
      : `Delete draft invoice ${row.invoice_number || ''}? Reason (optional):`);
    if (reason === null) return;
    if (needsReason && reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not deleted'); return; }
    try {
      await apiClient.delete(`/billing/invoices/${row.id}`, { data: { reason: reason.trim() || undefined } });
      pushInfo(`Invoice ${row.invoice_number || ''} deleted`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the invoice'), 'Something went wrong');
    }
  }

  async function transition(row, status) {
    try {
      await apiClient.post(`/billing/invoices/${row.id}/status`, { status });
      pushInfo(`Invoice ${row.invoice_number || ''} marked ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the invoice'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'number', header: 'Invoice no.', render: (r) => <span className="font-mono text-xs font-medium text-tertiary-900">{r.invoice_number || '—'}</span> },
    { key: 'project', header: 'Project', render: (r) => <span>{r.project?.name || '—'}{r.project?.code && <span className="block text-xs text-tertiary-500">{r.project.code}</span>}</span> },
    { key: 'client', header: 'Client', render: (r) => r.project?.client_name || '—' },
    { key: 'period', header: 'Period', render: (r) => (r.details?.period_from ? `${dateText(r.details.period_from)} – ${dateText(r.details.period_to)}` : periodLabel(r)) },
    { key: 'type', header: 'Billing', render: (r) => (r.details ? `${r.details.billing_type === 'one_time' ? 'One time' : r.details.billing_type === 'monthly' ? 'Monthly' : 'Hourly'} · ${amountText(r.details.rate, r.currency)}` : '—') },
    { key: 'amount', header: 'Amount', render: (r) => (
      <span className="tabular-nums">
        <span className="font-medium">{amountText(r.total_amount ?? r.amount, r.currency)}</span>
        {r.details?.charges?.length > 0 && <span className="block text-xs text-tertiary-500">{amountText(r.amount, r.currency)} + charges</span>}
      </span>
    ) },
    { key: 'currency', header: 'Currency', render: (r) => r.currency },
    { key: 'status', header: 'Status', render: (r) => <span><Badge value={r.status} />{r.line_items?.source === 'locked' && <span className="block text-[11px] text-success-700">from locked v{r.line_items.calculation_version}</span>}</span> },
    {
      key: 'actions',
      header: 'Action',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => printInvoice(r)}><Printer className="h-3.5 w-3.5" /> Download</button>
          {onEdit && <button type="button" className="btn-ghost text-xs" onClick={() => onEdit(r)}>Edit</button>}
          <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => remove(r)}>Delete</button>
          {r.status === 'draft' && <button type="button" className="btn-ghost text-xs" onClick={() => transition(r, 'sent')}>Mark sent</button>}
          {r.status === 'sent' && <button type="button" className="btn-ghost text-xs" onClick={() => transition(r, 'paid')}>Mark paid</button>}
        </div>
      ),
    },
  ];

  function printInvoice(r) {
    if (!printClientInvoice(r, user?.active_org?.name)) pushError('Allow pop-ups for this site to download the invoice.', 'Pop-up blocked');
  }

  return <DataTable columns={columns} rows={rows} loading={loading} emptyLabel={`No invoices generated for ${periodLabel(period)} yet`} />;
}

export function GenerateInvoiceButton({ onClick, label = 'Generate invoice', compact = false }) {
  return (
    <button type="button" className={`${compact ? 'btn-ghost px-2 py-1 text-xs' : 'btn-primary'} inline-flex items-center gap-1.5`} onClick={onClick}>
      <FileText className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> {label}
    </button>
  );
}
