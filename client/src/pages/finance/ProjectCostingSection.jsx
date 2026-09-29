import { useEffect, useState } from 'react';
import { CalendarX2, History, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions, useProjectOptions } from '../../lib/lookups.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const formatDay = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString() : null);

const STATUS_STYLE = {
  active: 'bg-success-50 text-success-700',
  upcoming: 'bg-primary-50 text-primary-700',
  ended: 'bg-tertiary-100 text-tertiary-500',
};

/**
 * One allocation span. Allocations are effective-dated: "End" sets its last
 * day (history stays), "Change" applies a new % / rate from a date (the days
 * before keep the old values), "Delete" is only for one entered by mistake.
 */
function AllocationRow({ a, onEnd, onChange, onDelete }) {
  const [mode, setMode] = useState(null);
  const [endDate, setEndDate] = useState(localToday);
  const [effective, setEffective] = useState(localToday);
  const [pct, setPct] = useState(a.allocation_percent ?? '');
  const [rate, setRate] = useState(a.cost_rate_per_hr ?? '');
  const range = `${formatDay(a.start_date) || 'Project start'} → ${formatDay(a.end_date) || 'open'}`;
  return (
    <li className={`px-4 py-2.5 text-sm ${a.status === 'ended' ? 'bg-tertiary-50/60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${a.status === 'ended' ? 'text-tertiary-500' : 'text-tertiary-800'}`}>{a.org_membership?.person?.name || 'Unknown'}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[a.status]}`}>{a.status}</span>
          {a.org_membership?.worker_type === 'contractor' && (
            <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700">
              Contractor{a.org_membership.vendor_account ? ` · ${a.org_membership.vendor_account.name}` : ''}
            </span>
          )}
          <span className="text-xs text-tertiary-500">{range}</span>
        </span>
        <span className="flex items-center gap-3 text-tertiary-600">
          <span title="Share of capacity / monthly cost charged to this project">{a.allocation_percent != null ? `${Number(a.allocation_percent)}% allocated` : <span className="text-tertiary-400">even split</span>}</span>
          <span title="Internal cost per approved hour (not client billing)">{a.cost_rate_per_hr != null ? `internal cost ${money(a.cost_rate_per_hr)}/hr` : <span className="text-tertiary-400">no internal cost rate</span>}</span>
          {a.status !== 'ended' && (
            <>
              <button type="button" title="Change % / rate from a date" aria-label="Change allocation" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-600" onClick={() => setMode(mode === 'change' ? null : 'change')}><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" title="End allocation (keeps history)" aria-label="End allocation" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-warning-50 hover:text-warning-700" onClick={() => setMode(mode === 'end' ? null : 'end')}><CalendarX2 className="h-3.5 w-3.5" /></button>
            </>
          )}
          <button type="button" title="Delete (only for an allocation entered by mistake)" aria-label="Delete allocation" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => setMode(mode === 'delete' ? null : 'delete')}><Trash2 className="h-3.5 w-3.5" /></button>
        </span>
      </div>
      {mode === 'end' && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-warning-50/60 p-2 text-xs">
          <label className="font-medium text-tertiary-600">Last day on this project<input type="date" min={a.start_date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1 text-sm" /></label>
          <button type="button" className="btn-secondary text-xs" onClick={() => onEnd(a, endDate).then((done) => done && setMode(null))}>End allocation</button>
          <span className="text-tertiary-500">Days up to then stay on this project in every report.</span>
        </div>
      )}
      {mode === 'change' && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-primary-50/60 p-2 text-xs">
          <label className="font-medium text-tertiary-600">Allocation %<input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="even split" className="mt-1 block w-28 rounded-lg border px-2 py-1 text-sm" /></label>
          <label className="font-medium text-tertiary-600">Internal cost/hr<input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="mt-1 block w-32 rounded-lg border px-2 py-1 text-sm" /></label>
          <label className="font-medium text-tertiary-600">Effective from<input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1 text-sm" /></label>
          <button type="button" className="btn-secondary text-xs" onClick={() => onChange(a, { allocation_percent: pct === '' ? null : Number(pct), cost_rate_per_hr: rate === '' ? null : Number(rate), effective_date: effective }).then((done) => done && setMode(null))}>Apply from this date</button>
        </div>
      )}
      {mode === 'delete' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-danger-50 p-2 text-xs text-danger-700">
          Delete only if this allocation was entered by mistake: it disappears from every past month too. To take someone off the project, use End instead.
          <button type="button" className="btn-secondary text-xs" onClick={() => onDelete(a)}>Delete anyway</button>
        </div>
      )}
    </li>
  );
}

/**
 * Module C — project cost rates & live budget. Cost rate is an ADDITIONAL
 * pay layer on top of a person's salary (see profitability.service
 * computeDayForOrg) — the billable/client-charge side stays exactly the
 * billing rate above, unchanged. Remaining budget is computed live from
 * approved+billable hours × these rates, never stored.
 */
export default function ProjectCostingSection({ accountId: fixedAccountId = '' }) {
  const { pushError, pushInfo } = useAlerts();
  const accountOptions = useProjectOptions(!fixedAccountId);
  const membershipOptions = useOrgMembershipOptions(true);
  const [pickedAccountId, setAccountId] = useState('');
  // Inside a project's profile the project is fixed; on its own it has a picker.
  const accountId = fixedAccountId || pickedAccountId;
  const [budget, setBudget] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [membershipId, setMembershipId] = useState('');
  const [rate, setRate] = useState('');
  const [allocation, setAllocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showEnded, setShowEnded] = useState(false);
  const [saving, setSaving] = useState(false);

  function load(accId) {
    if (!accId) return;
    setLoading(true);
    Promise.all([
      apiClient.get('/billing/budget-summary', { params: { account_id: accId } }),
      apiClient.get('/billing/cost-assignments', { params: { account_id: accId } }),
    ])
      .then(([budgetRes, assignmentsRes]) => {
        setBudget(budgetRes.data.data);
        setAssignments(assignmentsRes.data.data || []);
      })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load project costing'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setBudget(null);
    setAssignments([]);
    load(accountId);
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveRate(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/billing/cost-assignments', {
        account_id: accountId,
        org_membership_id: membershipId,
        cost_rate_per_hr: rate ? Number(rate) : undefined,
        allocation_percent: allocation === '' ? undefined : Number(allocation),
        start_date: startDate || null,
        end_date: endDate || null,
      });
      pushInfo('Assigned to the project');
      setMembershipId('');
      setRate('');
      setAllocation('');
      setStartDate('');
      setEndDate('');
      load(accountId);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to assign the employee'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function run(request, message, failMessage) {
    try {
      await request();
      pushInfo(message);
      load(accountId);
      return true;
    } catch (err) {
      pushError(apiErrorMessage(err, failMessage), 'Something went wrong');
      return false;
    }
  }
  const endAllocation = (a, end_date) => run(() => apiClient.post(`/allocations/${a.id}/end`, { end_date }), 'Allocation ended, history kept', 'Failed to end the allocation');
  const changeAllocation = (a, body) => run(() => apiClient.post('/billing/cost-assignments', { account_id: accountId, org_membership_id: a.org_membership_id, ...body }), 'Allocation updated from that date', 'Failed to change the allocation');
  const deleteAllocation = (a) => run(() => apiClient.delete(`/billing/cost-assignments/${a.id}`), 'Allocation deleted', 'Failed to delete the allocation');
  const visible = showEnded ? assignments : assignments.filter((a) => a.status !== 'ended');
  const endedCount = assignments.filter((a) => a.status === 'ended').length;

  return (
    <div className={fixedAccountId ? 'space-y-3' : 'space-y-3 border-t border-tertiary-100 pt-5'}>
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Project team (Employee ↔ Project), cost rates &amp; budget</h3>
        <p className="mt-0.5 text-xs text-tertiary-500">
          Assign employees and contractors (vendor resources) to this project — they can only log hours on projects assigned to them. Neither field below is ever used for client billing; that is the project&apos;s billing rate above.
        </p>
        <dl className="mt-2 grid gap-2 text-xs text-tertiary-600 sm:grid-cols-2">
          <div className="rounded-xl bg-tertiary-50 px-3 py-2">
            <dt className="font-semibold text-tertiary-800">Allocation %</dt>
            <dd>How much of the person&apos;s working capacity goes to this project (e.g. 60% here, 40% on another). That share of their monthly salary — or a contractor&apos;s vendor rate — is this project&apos;s cost in P&amp;L, Resource Revenue and Vendor Payments. Empty = split evenly across their projects.</dd>
          </div>
          <div className="rounded-xl bg-tertiary-50 px-3 py-2">
            <dt className="font-semibold text-tertiary-800">Internal cost rate / hour</dt>
            <dd>The person&apos;s internal cost per hour on this contract (e.g. ₹500/h × 8 approved hours = ₹4,000). When set, P&amp;L costs this person by approved hours × this rate <em>instead of</em> the salary allocation, and it drives the budget burn below. Optional.</dd>
          </div>
        </dl>
      </div>

      {!fixedAccountId && (
        <div className="max-w-sm">
          <SearchableSelect value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Select a project to view/manage" searchPlaceholder="Search projects…" />
        </div>
      )}

      {!accountId ? null : loading ? (
        <p className="text-sm text-tertiary-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          {budget && (
            <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
              <div className="rounded-xl border border-tertiary-100 bg-white p-3">
                <p className="text-xs text-tertiary-500">Budget</p>
                <p className="mt-0.5 font-heading text-base font-semibold text-tertiary-900">
                  {budget.budget_amount !== null ? `${budget.currency} ${money(budget.budget_amount)}` : '—'}
                </p>
              </div>
              <div className="rounded-xl border border-tertiary-100 bg-white p-3">
                <p className="text-xs text-tertiary-500">Cost incurred</p>
                <p className="mt-0.5 font-heading text-base font-semibold text-tertiary-900">{budget.currency} {money(budget.cost_incurred)}</p>
              </div>
              <div className={`rounded-xl border p-3 ${budget.remaining_budget !== null && budget.remaining_budget < 0 ? 'border-danger-200 bg-danger-50' : 'border-tertiary-100 bg-white'}`}>
                <p className="text-xs text-tertiary-500">Remaining</p>
                <p className={`mt-0.5 font-heading text-base font-semibold ${budget.remaining_budget !== null && budget.remaining_budget < 0 ? 'text-danger-700' : 'text-tertiary-900'}`}>
                  {budget.remaining_budget !== null ? `${budget.currency} ${money(budget.remaining_budget)}` : '—'}
                </p>
              </div>
            </div>
          )}
          {budget?.budget_amount === null && (
            <p className="text-xs text-tertiary-400">No budget set for this project yet — edit it from Accounts → this project → Project budget.</p>
          )}

          {visible.length === 0 ? (
            <EmptyState icon={Wallet} title={assignments.length ? 'No current allocations' : 'No one assigned yet'} description="Assign employees below. Dates and a cost rate are optional." />
          ) : (
            <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
              {visible.map((a) => <AllocationRow key={a.id} a={a} onEnd={endAllocation} onChange={changeAllocation} onDelete={deleteAllocation} />)}
            </ul>
          )}
          {endedCount > 0 && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs" onClick={() => setShowEnded((v) => !v)}>
              <History className="h-3.5 w-3.5" /> {showEnded ? 'Hide' : 'Show'} {endedCount} ended allocation{endedCount === 1 ? '' : 's'}
            </button>
          )}

          <form onSubmit={saveRate} className="flex flex-wrap items-end gap-2">
            {/* Resource type follows the person's user type (People → Full-Time Employee / Contractor). */}
            <div className="w-56"><SearchableSelect value={membershipId} onChange={setMembershipId} options={membershipOptions} placeholder="Select employee or contractor" searchPlaceholder="Search people…" /></div>
            <input type="number" min="0" max="100" step="1" placeholder="Allocation % (optional)" title="Share of this person's capacity / monthly cost on this project" aria-label="Allocation percent" value={allocation} onChange={(e) => setAllocation(e.target.value)} className="w-44 rounded-xl border px-3 py-2 text-sm" />
            <input type="number" min="0" step="0.01" placeholder="Internal cost/hr (optional)" title="Internal cost per approved hour — never client billing" aria-label="Internal cost rate per hour" value={rate} onChange={(e) => setRate(e.target.value)} className="w-48 rounded-xl border px-3 py-2 text-sm" />
            <label className="text-xs font-medium text-tertiary-600">From<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} title="First day on the project (blank = from the project start)" className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" /></label>
            <label className="text-xs font-medium text-tertiary-600">To<input type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} title="Last day (blank = open-ended)" className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" /></label>
            <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving || !membershipId}>
              <Plus className="h-4 w-4" /> {saving ? 'Saving…' : 'Assign'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
