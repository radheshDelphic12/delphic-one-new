import { useEffect, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const VENDOR_TYPES = ['contractor', 'external_resource', 'third_party'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function nowPeriod() {
  const now = new Date();
  return { period_month: now.getMonth() + 1, period_year: now.getFullYear() };
}

function PaymentDrawer({ open, onClose, onSubmit }) {
  const [fields, setFields] = useState({ vendor_name: '', vendor_type: 'contractor', amount: '', currency: 'INR', ...nowPeriod() });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setFields({ vendor_name: '', vendor_type: 'contractor', amount: '', currency: 'INR', ...nowPeriod() });
  }, [open]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...fields, amount: Number(fields.amount), period_month: Number(fields.period_month), period_year: Number(fields.period_year) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Raise vendor payment" onClose={onClose} size="sm" tone="create" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="vendor-payment-form" className="btn-primary" disabled={saving || !fields.vendor_name.trim() || !fields.amount}>
          {saving ? 'Saving…' : 'Raise payment'}
        </button>
      </>
    }>
      <form id="vendor-payment-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Vendor name
          <input required value={fields.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Vendor type
          <select value={fields.vendor_type} onChange={(e) => set('vendor_type', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
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
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Period month
            <select value={fields.period_month} onChange={(e) => set('period_month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Period year
            <input required type="number" value={fields.period_year} onChange={(e) => set('period_year', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
      </form>
    </Drawer>
  );
}

export default function VendorPaymentsTab() {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/expenses/vendor-payments');
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load vendor payments'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create(payload) {
    try {
      await apiClient.post('/expenses/vendor-payments', payload);
      pushInfo('Vendor payment raised');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to raise vendor payment'), 'Something went wrong');
      throw err;
    }
  }

  async function decide(row, status) {
    try {
      await apiClient.post(`/expenses/vendor-payments/${row.id}/decision`, { status });
      pushInfo(`Payment ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record decision'), 'Something went wrong');
    }
  }

  async function pay(row) {
    try {
      await apiClient.post(`/expenses/vendor-payments/${row.id}/pay`);
      pushInfo('Marked paid');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to mark paid'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'vendor', header: 'Vendor', render: (row) => row.vendor_name },
    { key: 'type', header: 'Type', render: (row) => <span className="capitalize">{row.vendor_type.replace(/_/g, ' ')}</span> },
    { key: 'period', header: 'Period', render: (row) => `${row.period_month}/${row.period_year}` },
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
          <Plus className="h-4 w-4" /> Raise payment
        </button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={Truck} title="No vendor payments yet" description="Raise a payment for a contractor or external resource." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No vendor payments." />
      )}
      <PaymentDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} />
    </div>
  );
}
