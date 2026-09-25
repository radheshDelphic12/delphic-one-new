import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

function CommissionDrawer({ open, onClose, onSubmit }) {
  const [eligible, setEligible] = useState([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [fields, setFields] = useState({ submission_id: '', amount: '', currency: 'INR' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFields({ submission_id: '', amount: '', currency: 'INR' });
    setLoadingEligible(true);
    apiClient
      .get('/vendor-commissions/eligible-submissions')
      .then(({ data }) => setEligible(data.data || []))
      .catch(() => setEligible([]))
      .finally(() => setLoadingEligible(false));
  }, [open]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...fields, amount: Number(fields.amount) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Raise vendor commission"
      onClose={onClose}
      size="sm"
      tone="create"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="vendor-commission-form" className="btn-primary" disabled={saving || !fields.submission_id || !fields.amount}>
            {saving ? 'Saving…' : 'Raise commission'}
          </button>
        </>
      }
    >
      <form id="vendor-commission-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Closed, vendor-sourced submission
          <select required value={fields.submission_id} onChange={(e) => set('submission_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" disabled={loadingEligible}>
            <option value="">{loadingEligible ? 'Loading…' : 'Select a submission'}</option>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.profile?.name || 'Candidate'} — {s.seat?.requirement?.title || 'Requirement'} ({s.profile?.vendor_account?.name || 'Vendor'})
              </option>
            ))}
          </select>
        </label>
        {!loadingEligible && eligible.length === 0 && (
          <p className="text-xs text-tertiary-500">No closed, vendor-sourced submissions are waiting on a commission right now.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Amount
            <input required type="number" min="0" step="0.01" value={fields.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Currency
            <select value={fields.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </form>
    </Drawer>
  );
}

/**
 * Recruitment-sourcing vendor commission ledger — what's owed to a
 * candidate-sourcing vendor once their placement closes. Deliberately
 * separate from VendorPaymentsTab (a company's own contractor AP); see
 * server/src/modules/vendorCommissions. Master-workspace only.
 */
export default function VendorLedgerTab() {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/vendor-commissions');
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load vendor commissions'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(payload) {
    try {
      await apiClient.post('/vendor-commissions', payload);
      pushInfo('Commission raised');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to raise commission'), 'Something went wrong');
      throw err;
    }
  }

  async function decide(row, status) {
    try {
      await apiClient.post(`/vendor-commissions/${row.id}/decision`, { status });
      pushInfo(`Commission ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record decision'), 'Something went wrong');
    }
  }

  async function pay(row) {
    try {
      await apiClient.post(`/vendor-commissions/${row.id}/pay`);
      pushInfo('Marked paid');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to mark paid'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'vendor', header: 'Vendor', render: (row) => <Link className="text-primary-700 hover:underline" to={`/accounts/${row.vendor_account?.id}`} onClick={(e) => e.stopPropagation()}>{row.vendor_account?.name}</Link> },
    { key: 'candidate', header: 'Candidate', render: (row) => <Link className="text-primary-700 hover:underline" to={`/submissions/${row.submission?.id}`} onClick={(e) => e.stopPropagation()}>{row.submission?.profile?.name || 'Candidate'}</Link> },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${Number(row.amount).toLocaleString()}` },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {row.status === 'pending' && (
            <>
              <button type="button" className="btn-ghost text-xs" onClick={() => decide(row, 'approved')}>Approve</button>
              <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => decide(row, 'rejected')}>Reject</button>
            </>
          )}
          {row.status === 'approved' && <button type="button" className="btn-ghost text-xs" onClick={() => pay(row)}>Mark paid</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}>
          <Plus className="h-4 w-4" /> Raise commission
        </button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={HandCoins} title="No vendor commissions yet" description="Raise a commission once a vendor-sourced candidate's submission closes." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No vendor commissions." />
      )}
      <CommissionDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} />
    </div>
  );
}
