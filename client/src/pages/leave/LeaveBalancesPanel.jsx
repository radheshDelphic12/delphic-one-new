import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Pencil, Search } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function asOfLabel(data) {
  if (!data) return '';
  const to = new Date(`${data.as_of}T00:00:00`);
  return `1 Jan – ${to.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${data.year}`;
}

// One employee × one leave type. Used / entitlement, remaining underneath;
// upcoming (approved, still ahead) and pending are called out when there are any.
function Counter({ balance }) {
  const tone = !balance.unlimited && balance.remaining === 0 ? 'text-danger-700' : 'text-tertiary-900';
  return (
    <div className="leading-tight" title={`${balance.leave_type_name}: ${num(balance.used)} taken, ${num(balance.upcoming)} approved ahead, ${num(balance.pending)} pending`}>
      <span className={`font-semibold ${tone}`}>{num(balance.used)}</span>
      <span className="text-tertiary-400"> / {balance.unlimited ? '∞' : num(balance.allocated)}</span>
      {balance.customised && <span className="ml-1 text-[10px] font-medium uppercase text-primary-600" title="Set by an admin for this employee">set</span>}
      <p className="text-[11px] text-tertiary-500">
        {balance.unlimited ? 'uncapped' : `${num(balance.remaining)} left`}
        {balance.upcoming > 0 && ` · +${num(balance.upcoming)} ahead`}
        {balance.pending > 0 && ` · ${num(balance.pending)} pending`}
      </p>
    </div>
  );
}

/** Admin sets each paid type's entitlement for one employee — blank/reset falls back to the leave type's default. */
function EntitlementDrawer({ employee, year, types, onClose, onSaved }) {
  const { pushError, pushInfo } = useAlerts();
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setValues(Object.fromEntries(employee.balances.map((b) => [b.leave_type_id, b.unlimited ? '' : String(b.allocated)])));
  }, [employee]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      for (const balance of employee.balances) {
        if (balance.unlimited) continue;
        const next = values[balance.leave_type_id];
        if (next === '' || Number(next) === balance.allocated) continue;
        await apiClient.put(`/leave/balances/${employee.org_membership_id}`, { leave_type_id: balance.leave_type_id, year, allocated: Number(next) });
      }
      pushInfo('Leave balances updated');
      onSaved();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update leave balances'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function reset(balance) {
    try {
      await apiClient.put(`/leave/balances/${employee.org_membership_id}`, { leave_type_id: balance.leave_type_id, year, allocated: null });
      pushInfo(`${balance.code} reset to the default`);
      onSaved();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to reset'), 'Something went wrong');
    }
  }

  const defaultQuota = (balance) => types.find((t) => t.id === balance.leave_type_id)?.annual_quota;

  return (
    <Drawer
      open={Boolean(employee)}
      title={employee ? `${employee.name} — leave balances ${year}` : 'Leave balances'}
      onClose={onClose}
      size="md"
      tone="edit"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="entitlement-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {employee && (
        <form id="entitlement-form" onSubmit={save} className="space-y-3">
          <p className="text-xs text-tertiary-500">
            Days each leave type entitles this employee to in {year}. Days taken are counted from their approved leave, so they can&apos;t be typed in — withdraw a leave from the approval queue to give the days back.
          </p>
          {employee.balances.map((b) => (
            <div key={b.leave_type_id} className="rounded-xl border border-tertiary-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-tertiary-800">{b.leave_type_name} <span className="text-xs text-tertiary-400">({b.code})</span></span>
                <span className="text-xs text-tertiary-500">{num(b.used)} taken{b.upcoming > 0 ? `, ${num(b.upcoming)} ahead` : ''}</span>
              </div>
              {b.unlimited ? (
                <p className="mt-1 text-xs text-tertiary-500">Uncapped — there is no balance to set.</p>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="999"
                    step="0.5"
                    value={values[b.leave_type_id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [b.leave_type_id]: e.target.value }))}
                    className="w-28 rounded-xl border px-3 py-2 text-sm"
                    aria-label={`${b.leave_type_name} entitlement`}
                  />
                  <span className="text-xs text-tertiary-500">days{defaultQuota(b) != null ? ` (default ${defaultQuota(b)})` : ''}</span>
                  {b.customised && <button type="button" className="btn-ghost ml-auto text-xs" onClick={() => reset(b)}>Reset to default</button>}
                </div>
              )}
            </div>
          ))}
        </form>
      )}
    </Drawer>
  );
}

/**
 * Every employee's live leave counters (CL / EL / SL / UL, 1 Jan → today).
 * `compact` is the admin-dashboard version: the same numbers, read-only, in a
 * scrolling card with a link through to the full screen.
 */
export default function LeaveBalancesPanel({ compact = false }) {
  const { pushError } = useAlerts();
  const year = new Date().getFullYear();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get('/leave/balances/overview', { params: { year, ...(search.trim() ? { search: search.trim() } : {}) } })
      .then(({ data: body }) => setData(body.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load leave balances'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [year, search, pushError]);

  // Small debounce so typing in the search box doesn't fire a request per key.
  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  // The dashboard card stays live without a reload: an approval, a withdrawal or
  // the date rolling over shows up within a minute.
  useEffect(() => {
    if (!compact) return undefined;
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [compact, load]);

  const totals = useMemo(() => {
    if (!data) return [];
    return data.types.map((t) => ({
      ...t,
      used: data.employees.reduce((sum, e) => sum + (e.balances.find((b) => b.leave_type_id === t.id)?.used || 0), 0),
    }));
  }, [data]);

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900">
            <CalendarCheck className="h-4 w-4 text-primary-600" /> Leave balances
          </h2>
          <p className="text-xs text-tertiary-500">Live, {asOfLabel(data)}. Taken / entitlement, with what is left.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-tertiary-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee" aria-label="Search employee" className="w-44 rounded-xl border py-2 pl-8 pr-3 text-xs" />
          </label>
          {compact && <Link to="/attendance?section=leave" className="text-xs font-medium text-primary-700 hover:underline">Manage</Link>}
        </div>
      </div>

      {totals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {totals.map((t) => (
            <span key={t.id} className="rounded-full border border-tertiary-100 bg-tertiary-50 px-3 py-1 text-xs text-tertiary-600">
              <span className="font-semibold text-tertiary-900">{t.code}</span> taken across the team: <span className="font-semibold text-tertiary-900">{num(t.used)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        {loading && !data ? (
          <p className="text-sm text-tertiary-500">Loading balances…</p>
        ) : !data || data.employees.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="No employees found" description={search ? 'No one matches that search.' : 'Add employees to see their leave balances.'} />
        ) : (
          <div className={`overflow-auto rounded-xl border border-tertiary-100 ${compact ? 'max-h-80' : 'max-h-[calc(100dvh-24rem)]'}`}>
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-tertiary-50 text-xs uppercase text-tertiary-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  {data.types.map((t) => <th key={t.id} className="px-3 py-2 font-medium" title={t.name}>{t.code}</th>)}
                  {!compact && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-tertiary-100">
                {data.employees.map((e) => (
                  <tr key={e.org_membership_id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-tertiary-900">{e.name}</p>
                      {e.department && <p className="text-[11px] text-tertiary-400">{e.department}</p>}
                    </td>
                    {e.balances.map((b) => <td key={b.leave_type_id} className="px-3 py-2"><Counter balance={b} /></td>)}
                    {!compact && (
                      <td className="px-3 py-2 text-right">
                        <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(e)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!compact && <EntitlementDrawer employee={editing} year={year} types={data?.types || []} onClose={() => setEditing(null)} onSaved={load} />}
    </section>
  );
}
