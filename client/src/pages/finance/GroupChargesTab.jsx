import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Hash, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { can } from '../../lib/permissions.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useFinanceCategories, useLocationOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Charges can be in several currencies — never add them together; show one total per currency.
function totalsLabel(rows) {
  const byCurrency = new Map();
  for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) || 0) + Number(row.amount));
  if (byCurrency.size === 0) return '—';
  return [...byCurrency].map(([currency, total]) => `${currency} ${money(total)}`).join(' · ');
}

const today = () => new Date().toISOString().slice(0, 10);

function emptyFields() {
  return { payment_date: today(), category_id: '', location_id: '', amount: '', currency: 'INR', notes: '' };
}

function fieldsFromCharge(charge) {
  return {
    payment_date: charge.payment_date ? String(charge.payment_date).slice(0, 10) : '',
    category_id: charge.category_id || '',
    location_id: charge.location_id || '',
    amount: String(charge.amount ?? ''),
    currency: charge.currency || 'INR',
    notes: charge.notes || '',
  };
}

// Group expense against this company: the day it was paid (its month follows),
// an admin-managed category, and optionally the office it belongs to.
// Add (no `charge`) and edit (`charge` set) share the form.
function GroupExpenseDrawer({ open, charge, onClose, onSubmit, categories, locations }) {
  const isEditing = Boolean(charge);
  const [fields, setFields] = useState(emptyFields);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setFields(charge ? fieldsFromCharge(charge) : emptyFields()); }, [open, charge]);

  const set = (key, value) => setFields((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        payment_date: fields.payment_date,
        category_id: fields.category_id,
        location_id: fields.location_id || null,
        amount: Number(fields.amount),
        currency: fields.currency,
        notes: fields.notes.trim() || (isEditing ? null : undefined),
      });
      onClose();
    } catch {
      // onSubmit already surfaced the error; keep the drawer open so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title={isEditing ? 'Edit group charge' : 'Add group expense'} onClose={onClose} size="sm" tone={isEditing ? 'edit' : 'create'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="group-expense-form" className="btn-primary" disabled={saving || !fields.category_id || !fields.amount || !fields.payment_date}>
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add expense'}
        </button>
      </>
    }>
      <form id="group-expense-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Category
          <select required value={fields.category_id} onChange={(e) => set('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            <option value="" disabled>Select category</option>
            {/* The charge's current category stays selectable even if it was deactivated since. */}
            {categories.filter((c) => c.is_active || c.id === charge?.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
          </select>
          <span className="mt-1 block font-normal text-tertiary-400">Manage the list under Finance → Categories.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Amount
            <input required type="number" min="0.01" step="0.01" value={fields.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
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
            Payment date
            <input required type="date" value={fields.payment_date} onChange={(e) => set('payment_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Office
            <select value={fields.location_id} onChange={(e) => set('location_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="">Company-wide</option>
              {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">
          Notes <span className="font-normal text-tertiary-400">(optional)</span>
          <input value={fields.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Ahmedabad office rent, September" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        {isEditing && !charge.category_id && charge.kind && <p className="text-xs text-tertiary-500">Currently recorded as “{charge.kind}” — pick a category to save.</p>}
        <p className="text-xs text-tertiary-500">Recorded as a group charge on this company, in the month of the payment date.</p>
      </form>
    </Drawer>
  );
}

export const EMPTY_CHARGE_FILTERS = { month: '', date: '', category_id: '', location_id: '' };

/** Month (YYYY-MM) / exact payment date / category / office — combinable. */
export function GroupChargeFilters({ value, onChange, categories, locations }) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block text-xs font-medium text-tertiary-600">Month<input type="month" value={value.month} onChange={(e) => set('month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm" /></label>
      <label className="block text-xs font-medium text-tertiary-600">Payment date<input type="date" value={value.date} onChange={(e) => set('date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm" /></label>
      <label className="block text-xs font-medium text-tertiary-600">Category
        <select value={value.category_id} onChange={(e) => set('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
        </select>
      </label>
      <label className="block text-xs font-medium text-tertiary-600">Office
        <select value={value.location_id} onChange={(e) => set('location_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
          <option value="">All offices</option>
          {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </label>
      <div className="flex items-end">
        <button type="button" className="btn-ghost text-xs" onClick={() => onChange(EMPTY_CHARGE_FILTERS)} disabled={!Object.values(value).some(Boolean)}>Clear filters</button>
      </div>
    </div>
  );
}

export function chargeQuery(filters) {
  const params = {};
  if (filters.month) {
    const [y, m] = filters.month.split('-');
    params.period_year = Number(y);
    params.period_month = Number(m);
  }
  if (filters.date) params.date = filters.date;
  if (filters.category_id) params.category_id = filters.category_id;
  if (filters.location_id) params.location_id = filters.location_id;
  return params;
}

export const chargeColumns = [
  { key: 'payment_date', header: 'Paid on', render: (row) => (row.payment_date ? new Date(row.payment_date).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—') },
  { key: 'period', header: 'Month', render: (row) => `${MONTHS[row.period_month - 1] || row.period_month} ${row.period_year}` },
  { key: 'kind', header: 'Category', render: (row) => row.category?.name || row.kind },
  { key: 'location', header: 'Office', render: (row) => row.location?.name || 'Company-wide' },
  { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${money(row.amount)}` },
  { key: 'notes', header: 'Notes', render: (row) => row.notes || '—' },
];

/**
 * Group charges on this company: ones the group raised against it (Group
 * Overview → Billing Charges, group-superadmin only) and group expenses this
 * company's admins add here. Admins can only add to their OWN company —
 * charging another company stays with the group superadmin (backend:
 * `POST /billing/group-charges/mine` is `authorize('admin')`, the cross-company
 * `POST /billing/group-charges` is `authorizeGroupSuperadmin`).
 */
export default function GroupChargesTab() {
  const { user, isGroupSuperadmin } = useAuth();
  const canAdd = can(user?.role, 'manageGroupCharges');
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState(EMPTY_CHARGE_FILTERS);
  const categories = useFinanceCategories('group_charge', { includeInactive: true });
  const locations = useLocationOptions(true);
  const params = useMemo(() => chargeQuery(filters), [filters]);

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/billing/group-charges', { params }).then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load group charges'), 'Something went wrong')).finally(() => setLoading(false));
  }, [pushError, params]);

  useEffect(() => { load(); }, [load]);

  async function create(payload) {
    try {
      await apiClient.post('/billing/group-charges/mine', payload);
      pushInfo('Group expense added');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add the group expense'), 'Something went wrong');
      throw err;
    }
  }

  async function update(payload) {
    try {
      await apiClient.patch(`/billing/group-charges/${editing.id}`, payload);
      pushInfo('Group charge updated');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the group charge'), 'Something went wrong');
      throw err;
    }
  }

  const isSuperadmin = Boolean(user?.is_superadmin);
  async function remove(row) {
    if (!window.confirm(`Delete this ${row.currency} ${Number(row.amount).toLocaleString()} ${row.category?.name || row.kind || ''} group expense? This can't be undone.`)) return;
    try {
      await apiClient.delete(`/billing/group-charges/${row.id}`);
      pushInfo('Group expense deleted');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the group expense'), 'Something went wrong');
    }
  }

  // A charge the group raised against this company is the group superadmin's
  // to change — or this company's superadmin, who may also delete any charge.
  const canEditRow = useCallback(
    (row) => canAdd && (!row.raiser?.is_group_superadmin || row.raised_by === user?.id || isGroupSuperadmin || isSuperadmin),
    [canAdd, user?.id, isGroupSuperadmin, isSuperadmin]
  );
  const columns = useMemo(() => (canAdd ? [
    ...chargeColumns,
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <span className="flex gap-1">
          {canEditRow(row)
            ? <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(row)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
            : <span className="text-xs text-tertiary-400">Raised by group</span>}
          {isSuperadmin && <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs text-danger-600" onClick={() => remove(row)}><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
        </span>
      ),
    },
  ] : chargeColumns), [canAdd, canEditRow, isSuperadmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const now = new Date();
    const thisMonth = rows.filter((r) => r.period_month === now.getMonth() + 1 && r.period_year === now.getFullYear());
    return { total: totalsLabel(rows), thisMonth: totalsLabel(thisMonth), count: rows.length };
  }, [rows]);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      <GroupChargeFilters value={filters} onChange={setFilters} categories={categories} locations={locations} />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={filtered ? 'Total (filtered)' : 'Total group charges'} value={loading ? '…' : summary.total} icon={Receipt} theme="purple" />
        <KpiCard label="This month" value={loading ? '…' : summary.thisMonth} icon={CalendarDays} theme="blue" />
        <KpiCard label="Entries" value={loading ? '…' : summary.count} icon={Hash} theme="orange" />
      </div>
      {canAdd && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}>
            <Plus className="h-4 w-4" /> Add Group Expense
          </button>
        </div>
      )}
      {!loading && rows.length === 0 && !filtered ? (
        <EmptyState
          title="No group charges yet"
          description="Group expenses for this company, and charges raised against it by the group, will appear here."
          action={canAdd ? <button type="button" className="btn-secondary" onClick={() => setDrawerOpen(true)}>Add Group Expense</button> : null}
        />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No group charges match these filters." />
      )}
      {canAdd && <GroupExpenseDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} categories={categories} locations={locations} />}
      {canAdd && <GroupExpenseDrawer open={Boolean(editing)} charge={editing} onClose={() => setEditing(null)} onSubmit={update} categories={categories} locations={locations} />}
    </div>
  );
}
