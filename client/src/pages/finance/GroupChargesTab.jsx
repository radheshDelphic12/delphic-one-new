import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Hash, Plus, Receipt } from 'lucide-react';
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

// Group expense against this company: the day it was paid (its month follows),
// an admin-managed category, and optionally the office it belongs to.
function GroupExpenseDrawer({ open, onClose, onSubmit, categories, locations }) {
  const [fields, setFields] = useState(emptyFields);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setFields(emptyFields()); }, [open]);

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
        notes: fields.notes.trim() || undefined,
      });
      onClose();
    } catch {
      // onSubmit already surfaced the error; keep the drawer open so nothing typed is lost.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Add group expense" onClose={onClose} size="sm" tone="create" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="group-expense-form" className="btn-primary" disabled={saving || !fields.category_id || !fields.amount || !fields.payment_date}>
          {saving ? 'Saving…' : 'Add expense'}
        </button>
      </>
    }>
      <form id="group-expense-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Category
          <select required value={fields.category_id} onChange={(e) => set('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            <option value="" disabled>Select category</option>
            {categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
  const { user } = useAuth();
  const canAdd = can(user?.role, 'manageGroupCharges');
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
        <DataTable columns={chargeColumns} rows={rows} loading={loading} emptyLabel="No group charges match these filters." />
      )}
      {canAdd && <GroupExpenseDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} categories={categories} locations={locations} />}
    </div>
  );
}
