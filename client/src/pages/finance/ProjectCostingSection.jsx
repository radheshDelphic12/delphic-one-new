import { useEffect, useState } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions, useProjectOptions } from '../../lib/lookups.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      await apiClient.post('/billing/cost-assignments', { account_id: accountId, org_membership_id: membershipId, cost_rate_per_hr: rate ? Number(rate) : undefined });
      pushInfo('Employee assigned to the project');
      setMembershipId('');
      setRate('');
      load(accountId);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to assign the employee'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function unassign(assignment) {
    try {
      await apiClient.delete(`/billing/cost-assignments/${assignment.id}`);
      pushInfo('Removed from the project');
      load(accountId);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to remove the assignment'), 'Something went wrong');
    }
  }

  return (
    <div className={fixedAccountId ? 'space-y-3' : 'space-y-3 border-t border-tertiary-100 pt-5'}>
      <div>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Project team (Employee ↔ Project), cost rates &amp; budget</h3>
        <p className="mt-0.5 text-xs text-tertiary-500">
          Assign employees to this project (IT staff can only log hours on projects assigned to them). Optionally set an hourly cost rate — additional to salary — to track budget burn as approved hours accrue.
        </p>
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

          {assignments.length === 0 ? (
            <EmptyState icon={Wallet} title="No one assigned yet" description="Assign employees below. A cost rate is optional." />
          ) : (
            <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
              {assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-medium text-tertiary-800">{a.org_membership?.person?.name || 'Unknown'}</span>
                  <span className="flex items-center gap-3 text-tertiary-600">
                    {a.cost_rate_per_hr != null ? `${money(a.cost_rate_per_hr)}/hr` : <span className="text-tertiary-400">no cost rate</span>}
                    <button type="button" aria-label="Remove from project" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => unassign(a)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={saveRate} className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-tertiary-600">
              Resource type
              {/* Contractor / Vendor Resource are supported by the data model but not offered yet. */}
              <select disabled value="company_employee" onChange={() => {}} className="mt-1 block w-40 rounded-xl border bg-tertiary-50 px-3 py-2 text-sm text-tertiary-600">
                <option value="company_employee">Company Employee</option>
              </select>
            </label>
            <div className="w-56"><SearchableSelect value={membershipId} onChange={setMembershipId} options={membershipOptions} placeholder="Select employee" searchPlaceholder="Search people…" /></div>
            <input type="number" min="0" step="0.01" placeholder="Cost rate/hr (optional)" value={rate} onChange={(e) => setRate(e.target.value)} className="w-44 rounded-xl border px-3 py-2 text-sm" />
            <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving || !membershipId}>
              <Plus className="h-4 w-4" /> {saving ? 'Saving…' : 'Assign'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
