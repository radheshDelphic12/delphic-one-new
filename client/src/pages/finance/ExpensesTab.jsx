import { useEffect, useState } from 'react';
import { Pencil, Plus, Receipt } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

// Submit (no `claim`) and edit (`claim` set) share the form. Editing is only offered
// while the claim is pending; receipts attach to the saved claim, so they appear
// once it exists (right after submitting, the drawer reopens in edit mode for them).
function ClaimDrawer({ open, claim, locations, onClose, onSubmit }) {
  const isEditing = Boolean(claim);
  const [fields, setFields] = useState({ location_id: '', category: '', amount: '', currency: 'INR' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFields(claim
      ? { location_id: claim.location_id, category: claim.category, amount: String(Number(claim.amount)), currency: claim.currency }
      : { location_id: locations[0]?.id || '', category: '', amount: '', currency: 'INR' });
  }, [open, claim, locations]);

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
    <Drawer open={open} title={isEditing ? 'Edit expense claim' : 'Submit expense claim'} onClose={onClose} size={isEditing ? 'md' : 'sm'} tone={isEditing ? 'edit' : 'create'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="expense-claim-form" className="btn-primary" disabled={saving || !fields.location_id || !fields.category.trim() || !fields.amount}>
          {saving ? (isEditing ? 'Saving…' : 'Submitting…') : isEditing ? 'Save changes' : 'Submit claim'}
        </button>
      </>
    }>
      <form id="expense-claim-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Office location
          <select required value={fields.location_id} onChange={(e) => set('location_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            <option value="" disabled>Select location</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Category
          <input required value={fields.category} onChange={(e) => set('category', e.target.value)} placeholder="Travel, supplies, client entertainment…" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
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
      </form>
      {isEditing && (
        <div className="mt-5">
          <FilesPanel entityType="expense_claim" entityId={claim.id} title="Receipts" defaultLabel="Receipt" multiple />
        </div>
      )}
    </Drawer>
  );
}

export default function ExpensesTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { pushError, pushInfo } = useAlerts();
  const [view, setView] = useState('mine');
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const endpoint = view === 'team' ? '/expenses/claims' : '/expenses/claims/me';
      const { data } = await apiClient.get(endpoint, { params: { limit: 50 } });
      setRows(data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load expense claims'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [view]);
  useEffect(() => {
    apiClient.get('/orgs/locations').then(({ data }) => setLocations(data.data || [])).catch(() => setLocations([]));
  }, []);

  async function createClaim(payload) {
    try {
      const { data } = await apiClient.post('/expenses/claims', payload);
      pushInfo('Expense claim submitted — you can attach receipts now');
      load();
      // Reopen in edit mode so the receipts can be attached to the new claim.
      setEditing(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to submit claim'), 'Something went wrong');
      throw err;
    }
  }

  async function updateClaim(payload) {
    try {
      await apiClient.patch(`/expenses/claims/${editing.id}`, payload);
      pushInfo('Expense claim updated');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the claim'), 'Something went wrong');
      throw err;
    }
  }

  async function decide(row, status) {
    try {
      await apiClient.post(`/expenses/claims/${row.id}/decision`, { status });
      pushInfo(`Claim ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record decision'), 'Something went wrong');
    }
  }

  async function reimburse(row) {
    try {
      await apiClient.post(`/expenses/claims/${row.id}/reimburse`);
      pushInfo('Marked reimbursed');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to mark reimbursed'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'created', header: 'Submitted', render: (row) => new Date(row.created_at).toLocaleDateString() },
    ...(view === 'team' ? [{ key: 'person', header: 'Employee', render: (row) => row.org_membership?.person?.name || '—' }] : []),
    { key: 'location', header: 'Location', render: (row) => row.location?.name || '—' },
    { key: 'category', header: 'Category' },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${Number(row.amount).toLocaleString()}` },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {/* A pending claim can be edited by its owner (My claims) or by an admin. */}
          {row.status === 'pending' && (view === 'mine' || isAdmin) && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(row)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
          )}
          {isAdmin && view === 'team' && row.status === 'pending' && (
            <>
              <button type="button" className="btn-ghost text-xs" onClick={() => decide(row, 'approved')}>Approve</button>
              <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => decide(row, 'rejected')}>Reject</button>
            </>
          )}
          {isAdmin && row.status === 'approved' && <button type="button" className="btn-ghost text-xs" onClick={() => reimburse(row)}>Mark reimbursed</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
          {['mine', ...(isAdmin ? ['team'] : [])].map((key) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={`border-b-2 px-3 py-2 text-sm font-medium ${view === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setView(key)}>
              {key === 'mine' ? 'My claims' : 'Team claims'}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}>
          <Plus className="h-4 w-4" /> Submit claim
        </button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No expense claims yet" description="Submit a claim for reimbursement." action={<button type="button" className="btn-secondary" onClick={() => setDrawerOpen(true)}>Submit claim</button>} />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No claims." />
      )}
      <ClaimDrawer open={drawerOpen} locations={locations} onClose={() => setDrawerOpen(false)} onSubmit={createClaim} />
      <ClaimDrawer open={Boolean(editing)} claim={editing} locations={locations} onClose={() => setEditing(null)} onSubmit={updateClaim} />
    </div>
  );
}
