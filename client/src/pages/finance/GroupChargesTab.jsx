import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Hash, Plus, Receipt } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { can } from '../../lib/permissions.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
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

function emptyFields() {
  const now = new Date();
  return { period_month: now.getMonth() + 1, period_year: now.getFullYear(), kind: '', amount: '', currency: 'INR' };
}

// Same layout as Finance → Expenses' claim form (category, amount, currency),
// plus the month the expense belongs to. Saved as a group charge on this company.
function GroupExpenseDrawer({ open, onClose, onSubmit }) {
  const [fields, setFields] = useState(emptyFields);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setFields(emptyFields()); }, [open]);

  const set = (key, value) => setFields((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        period_month: Number(fields.period_month),
        period_year: Number(fields.period_year),
        kind: fields.kind.trim(),
        amount: Number(fields.amount),
        currency: fields.currency,
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
        <button type="submit" form="group-expense-form" className="btn-primary" disabled={saving || !fields.kind.trim() || !fields.amount}>
          {saving ? 'Saving…' : 'Add expense'}
        </button>
      </>
    }>
      <form id="group-expense-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">
          Category
          <input required value={fields.kind} onChange={(e) => set('kind', e.target.value)} placeholder="Shared office, group software, seconded staff…" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
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
            Month
            <select value={fields.period_month} onChange={(e) => set('period_month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Year
            <input required type="number" min="2000" max="2100" value={fields.period_year} onChange={(e) => set('period_year', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
        </div>
        <p className="text-xs text-tertiary-500">Recorded as a group charge on this company for the month you pick.</p>
      </form>
    </Drawer>
  );
}

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

  const load = useCallback(() => {
    setLoading(true);
    apiClient.get('/billing/group-charges').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load group charges'), 'Something went wrong')).finally(() => setLoading(false));
  }, [pushError]);

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

  const columns = [
    { key: 'period', header: 'Period', render: (row) => `${MONTHS[row.period_month - 1] || row.period_month} ${row.period_year}` },
    { key: 'kind', header: 'Category' },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${money(row.amount)}` },
    { key: 'raised', header: 'Raised', render: (row) => new Date(row.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Total group charges" value={loading ? '…' : summary.total} icon={Receipt} theme="purple" />
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
      {!loading && rows.length === 0 ? (
        <EmptyState
          title="No group charges yet"
          description="Group expenses for this company, and charges raised against it by the group, will appear here."
          action={canAdd ? <button type="button" className="btn-secondary" onClick={() => setDrawerOpen(true)}>Add Group Expense</button> : null}
        />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No group charges." />
      )}
      {canAdd && <GroupExpenseDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} />}
    </div>
  );
}
