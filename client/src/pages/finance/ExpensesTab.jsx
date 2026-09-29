import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Receipt } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useFinanceCategories, useLocationOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import { chargeColumns, chargeQuery } from './GroupChargesTab.jsx';

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

const todayIso = () => new Date().toISOString().slice(0, 10);

// Submit (no `claim`) and edit (`claim` set) share the form. Editing is only offered
// while the claim is pending; receipts attach to the saved claim, so they appear
// once it exists (right after submitting, the drawer reopens in edit mode for them).
// The category comes from the admin-managed Expense categories (Finance → Categories).
function ClaimDrawer({ open, claim, locations, categories, onClose, onSubmit }) {
  const isEditing = Boolean(claim);
  const [fields, setFields] = useState({ location_id: '', category_id: '', expense_date: todayIso(), amount: '', currency: 'INR' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // An older claim may carry only a free-text category: match it by name.
    const byName = (name) => categories.find((c) => c.name.toLowerCase() === String(name || '').toLowerCase())?.id || '';
    setFields(claim
      ? {
        location_id: claim.location_id,
        category_id: claim.category_id || byName(claim.category),
        expense_date: claim.expense_date ? String(claim.expense_date).slice(0, 10) : '',
        amount: String(Number(claim.amount)),
        currency: claim.currency,
      }
      : { location_id: locations[0]?.id || '', category_id: '', expense_date: todayIso(), amount: '', currency: 'INR' });
  }, [open, claim, locations, categories]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...fields, expense_date: fields.expense_date || undefined, amount: Number(fields.amount) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title={isEditing ? 'Edit expense claim' : 'Submit expense claim'} onClose={onClose} size={isEditing ? 'md' : 'sm'} tone={isEditing ? 'edit' : 'create'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="expense-claim-form" className="btn-primary" disabled={saving || !fields.location_id || !fields.category_id || !fields.amount}>
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
          <select required value={fields.category_id} onChange={(e) => set('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            <option value="" disabled>Select category</option>
            {categories.filter((c) => c.is_active || c.id === fields.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Expense date
          <input type="date" max={todayIso()} value={fields.expense_date} onChange={(e) => set('expense_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
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

const EMPTY_FILTERS = { org_membership_id: '', month: '', category_id: '', location_id: '' };

const VIEW_LABEL = { mine: 'My claims', team: 'Reimbursements', group: 'Group expenses' };

/**
 * Finance → Expenses. Everyone: their own claims. Admins also get
 * Reimbursements (every employee's claims, to approve / reimburse) and Group
 * Expenses (the company's group charges). Filters at the top — Employee,
 * Month, Category, Office — combine.
 */
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
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const expenseCategories = useFinanceCategories('expense', { includeInactive: true });
  const chargeCategories = useFinanceCategories('group_charge', { includeInactive: true, enabled: isAdmin });
  const locationOptions = useLocationOptions(true);
  const memberOptions = useOrgMembershipOptions(isAdmin);
  const categories = view === 'group' ? chargeCategories : expenseCategories;
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const params = useMemo(() => {
    const base = chargeQuery({ month: filters.month, date: '', category_id: filters.category_id, location_id: filters.location_id });
    if (view === 'team' && filters.org_membership_id) base.org_membership_id = filters.org_membership_id;
    return base;
  }, [filters, view]);

  async function load() {
    setLoading(true);
    try {
      if (view === 'group') {
        const { data } = await apiClient.get('/billing/group-charges', { params });
        setRows(data.data || []);
      } else {
        const endpoint = view === 'team' ? '/expenses/claims' : '/expenses/claims/me';
        const { data } = await apiClient.get(endpoint, { params: { limit: 100, ...params } });
        setRows(data.data || []);
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load expenses'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [view, JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
  // Group charges and claims use different category lists.
  useEffect(() => { setFilters((f) => ({ ...f, category_id: '' })); }, [view]);
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
    { key: 'date', header: 'Expense date', render: (row) => (row.expense_date ? new Date(row.expense_date).toLocaleDateString(undefined, { timeZone: 'UTC' }) : <span title="Submission date (no expense date recorded)">{new Date(row.created_at).toLocaleDateString()}</span>) },
    ...(view === 'team' ? [{ key: 'person', header: 'Employee', render: (row) => row.org_membership?.person?.name || '—' }] : []),
    { key: 'location', header: 'Office', render: (row) => row.location?.name || '—' },
    { key: 'category', header: 'Category', render: (row) => row.category_ref?.name || row.category },
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

  const filtered = Object.values(filters).some(Boolean);
  const total = useMemo(() => {
    const byCurrency = new Map();
    for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) || 0) + Number(row.amount));
    return [...byCurrency].map(([c, n]) => `${c} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ');
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
          {['mine', ...(isAdmin ? ['team', 'group'] : [])].map((key) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={`border-b-2 px-3 py-2 text-sm font-medium ${view === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setView(key)}>
              {VIEW_LABEL[key]}
            </button>
          ))}
        </div>
        {view !== 'group' && (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}>
            <Plus className="h-4 w-4" /> Submit claim
          </button>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        {view === 'team' && (
          <label className="block text-xs font-medium text-tertiary-600">Employee<div className="mt-1"><SearchableSelect value={filters.org_membership_id} onChange={(v) => setFilter('org_membership_id', v)} options={memberOptions} placeholder="All employees" allowClear /></div></label>
        )}
        <label className="block text-xs font-medium text-tertiary-600">Month<input type="month" value={filters.month} onChange={(e) => setFilter('month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Category
          <select value={filters.category_id} onChange={(e) => setFilter('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Office
          <select value={filters.location_id} onChange={(e) => setFilter('location_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="">All offices</option>
            {locationOptions.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        <div className="flex items-end justify-between gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!filtered}>Clear filters</button>
          {!loading && rows.length > 0 && <span className="pb-1 text-xs font-medium text-tertiary-700">Total {total}</span>}
        </div>
      </div>

      {view === 'group' ? (
        <DataTable columns={chargeColumns} rows={rows} loading={loading} emptyLabel="No group expenses match these filters. Add them under Finance → Group Charges." />
      ) : !loading && rows.length === 0 && !filtered ? (
        <EmptyState icon={Receipt} title="No expense claims yet" description="Submit a claim for reimbursement." action={<button type="button" className="btn-secondary" onClick={() => setDrawerOpen(true)}>Submit claim</button>} />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No claims match these filters." />
      )}
      <ClaimDrawer open={drawerOpen} locations={locations} categories={expenseCategories} onClose={() => setDrawerOpen(false)} onSubmit={createClaim} />
      <ClaimDrawer open={Boolean(editing)} claim={editing} locations={locations} categories={expenseCategories} onClose={() => setEditing(null)} onSubmit={updateClaim} />
    </div>
  );
}
