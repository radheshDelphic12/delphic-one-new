import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { promptAction } from '../../lib/confirmAction.js';
import { useProjectOptions, useVendorAccountOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const money = (n, c = 'INR') => `${c} ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = 'block text-xs font-medium text-tertiary-600';
const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Finance > Credit notes (Invoicing and Vendor Invoices both open it): a numbered credit of an amount to a client, or from a vendor,
 * optionally against one invoice, whose pending amount then drops. Download as PDF; cancel with a reason (never deleted).
 */
export default function CreditNotesPanel({ partyType = 'client' }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    apiClient.get('/billing/credit-notes', { params: { party_type: partyType } }).then(({ data }) => setRows(data.data || [])).catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Could not load credit notes'), 'Something went wrong'); });
  }, [partyType, pushError]);
  useEffect(() => { load(); }, [load]);

  async function cancel(row) {
    const reason = await promptAction(`Cancel credit note ${row.number}? Reason (required):`, '');
    if (!reason) return;
    try { await apiClient.post(`/billing/credit-notes/${row.id}/cancel`, { reason }); pushSuccess('Credit note cancelled'); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not cancel it'), 'Not cancelled'); }
  }
  const columns = [
    { key: 'number', header: 'Credit note', render: (r) => <span className="font-medium text-tertiary-900">{r.number}<span className="block text-xs text-tertiary-500">{r.issue_date}</span></span> },
    { key: 'account', header: partyType === 'client' ? 'Client / project' : 'Vendor', render: (r) => r.account.name },
    { key: 'invoice', header: 'Against invoice', render: (r) => (r.invoice ? r.invoice.number || 'Invoice' : <span className="text-tertiary-400">No invoice</span>) },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-semibold">{money(r.amount, r.currency)}</span> },
    { key: 'reason', header: 'Reason', render: (r) => <span className="text-xs text-tertiary-700">{r.reason}</span> },
    { key: 'status', header: 'Status', render: (r) => (r.status === 'cancelled' ? <span className="text-xs text-danger-600">Cancelled{r.cancel_reason ? `: ${r.cancel_reason}` : ''}</span> : <span className="text-xs text-success-700">Issued</span>) },
    {
      key: 'actions', header: '', render: (r) => (
        <span className="flex gap-1">
          <button type="button" className="btn-ghost text-xs" onClick={() => downloadFile(`/billing/credit-notes/${r.id}/pdf`, {}, `credit-note-${r.number.replace(/\//g, '-')}.pdf`).catch((e) => pushError(apiErrorMessage(e, 'Download failed'), 'Download failed'))}><Download className="h-3 w-3" /> PDF</button>
          {r.status === 'issued' && <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => cancel(r)}>Cancel</button>}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-3" data-testid="credit-notes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tertiary-600">{partyType === 'client' ? 'A credit to a client lowers what they owe; against an invoice, its pending amount drops (the invoice is paid once covered).' : 'A credit note from a vendor lowers what we owe; against a vendor invoice, its net payable drops.'}</p>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setOpen(true)} data-testid="credit-note-new"><Plus className="h-4 w-4" />New credit note</button>
      </div>
      <DataTable columns={columns} rows={rows || []} loading={!rows} emptyLabel="No credit notes yet." />
      <CreditNoteDrawer open={open} partyType={partyType} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />
    </div>
  );
}

function CreditNoteDrawer({ open, partyType, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const projects = useProjectOptions(open && partyType === 'client');
  const vendors = useVendorAccountOptions(open && partyType === 'vendor');
  const [form, setForm] = useState({ account_id: '', invoice_id: '', amount: '', issue_date: today(), reason: '' });
  const [invoices, setInvoices] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm({ account_id: '', invoice_id: '', amount: '', issue_date: today(), reason: '' }); }, [open]);
  // the account's invoices that are still open (to pick the one the credit is against)
  useEffect(() => {
    if (!open || !form.account_id) { setInvoices([]); return; }
    const req = partyType === 'client'
      ? apiClient.get('/billing/invoices', { params: { client_account_id: form.account_id } }).then(({ data }) => (data.data || []).filter((i) => i.status === 'sent' && Number(i.pending_amount) > 0).map((i) => ({ id: i.id, label: `${i.invoice_number || 'Draft'} · ${i.period_month}/${i.period_year} · pending ${money(i.pending_amount, i.currency)}`, open: Number(i.pending_amount), currency: i.currency })))
      : apiClient.get('/billing/vendor-invoices', { params: { vendor_account_id: form.account_id } }).then(({ data }) => (data.data || []).filter((i) => !i.paid).map((i) => ({ id: i.id, label: `${i.invoice_number || 'Invoice'} · ${i.period_month}/${i.period_year} · payable ${money(i.net_payable, i.currency)}`, open: Number(i.net_payable), currency: i.currency })));
    req.then(setInvoices).catch(() => setInvoices([]));
  }, [open, form.account_id, partyType]);
  const chosen = useMemo(() => invoices.find((i) => i.id === form.invoice_id), [invoices, form.invoice_id]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.post('/billing/credit-notes', { party_type: partyType, account_id: form.account_id, ...(form.invoice_id ? { invoice_id: form.invoice_id } : {}), amount: Number(form.amount), issue_date: form.issue_date, reason: form.reason.trim() });
      pushSuccess(`Credit note ${data.data.number} issued`);
      onSaved();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not issue the credit note'), 'Not issued'); } finally { setSaving(false); }
  }
  const options = partyType === 'client' ? projects : vendors;
  return (
    <Drawer open={open} title={partyType === 'client' ? 'New credit note to a client' : 'New credit note from a vendor'} onClose={onClose} size="sm" tone="create" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="credit-note-form" className="btn-primary" disabled={saving || !form.account_id || !(Number(form.amount) > 0) || form.reason.trim().length < 3}>{saving ? 'Saving...' : 'Issue credit note'}</button></>}>
      <form id="credit-note-form" onSubmit={save} className="space-y-3">
        <label className={label}>{partyType === 'client' ? 'Project / client' : 'Vendor'}
          <SearchableSelect options={options} value={form.account_id} onChange={(v) => setForm((f) => ({ ...f, account_id: v || '', invoice_id: '' }))} placeholder="Choose" />
        </label>
        <label className={label}>Against invoice (optional)
          <select className={input} value={form.invoice_id} onChange={set('invoice_id')} disabled={!form.account_id} data-testid="credit-note-invoice"><option value="">No particular invoice</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select>
        </label>
        <label className={label}>Amount{chosen ? ` (${chosen.currency}, at most ${chosen.open})` : ''}<input type="number" min="0" step="0.01" className={input} value={form.amount} onChange={set('amount')} required data-testid="credit-note-amount" /></label>
        <label className={label}>Date<input type="date" className={input} value={form.issue_date} onChange={set('issue_date')} /></label>
        <label className={label}>Reason (shown on the credit note)<textarea className={input} rows={3} value={form.reason} onChange={set('reason')} required data-testid="credit-note-reason" /></label>
      </form>
    </Drawer>
  );
}
