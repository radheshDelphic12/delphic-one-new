import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { apiErrorMessage, canAssignRecruiters } from '../profiles/profileUtils.js';

// role='recruiter' picks from the recruiter roster (server enforces the role match).
// role='vendor_team' picks from every active person — it's a cross-functional tag
// for whoever is working the vendor-sourcing side of a requirement, not an account role.
const ROLE_CONFIG = {
  recruiter: {
    title: 'Assign recruiters',
    viewTitle: 'Recruiter assignments',
    fieldLabel: 'Recruiter',
    placeholder: 'Select recruiter',
    searchPlaceholder: 'Search recruiters…',
    directoryParams: { role: 'recruiter', active: 'true' },
    saveLabel: 'Assign',
    emptyLabel: 'No active assignments.',
  },
  vendor_team: {
    title: 'Assign vendor team',
    viewTitle: 'Vendor team assignments',
    fieldLabel: 'Team member',
    placeholder: 'Select person',
    searchPlaceholder: 'Search people…',
    directoryParams: { active: 'true' },
    saveLabel: 'Assign',
    emptyLabel: 'No active assignments.',
  },
};

export default function AssignRecruiterDrawer({ requirement, role = 'recruiter', onClose }) {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const config = ROLE_CONFIG[role];
  const canAssign = canAssignRecruiters(user, requirement);
  const isSalesButNotOwner = user?.role === 'sales' && !canAssign;
  const [assignments, setAssignments] = useState([]);
  const [people, setPeople] = useState([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const requests = [apiClient.get(`/requirements/${requirement.id}/assignments`)];
      if (canAssign) requests.push(apiClient.get('/users/directory', { params: config.directoryParams }));
      const [assignmentsResponse, usersResponse] = await Promise.all(requests);
      setAssignments((assignmentsResponse.data.data || []).filter((row) => row.role_on_req === role));
      setPeople(usersResponse?.data?.data || []);
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to load assignments'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirement.id, role]);

  async function assignPerson(event) {
    event.preventDefault();
    if (!selectedPersonId) return;
    setSaving(true);
    try {
      await apiClient.post(`/requirements/${requirement.id}/assign`, {
        user_id: selectedPersonId,
        role_on_req: role,
      });
      setSelectedPersonId('');
      await loadData();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to assign'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function unassignPerson(assignmentId) {
    setSaving(true);
    try {
      await apiClient.post(`/requirements/${requirement.id}/unassign`, { assignment_id: assignmentId });
      await loadData();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to unassign'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const activePersonIds = new Set(assignments.filter((row) => !row.unassigned_at).map((row) => row.user?.id));
  const availablePeople = people.filter((person) => !activePersonIds.has(person.id));
  const active = assignments.filter((row) => !row.unassigned_at);
  const ended = assignments.filter((row) => row.unassigned_at);

  return (
    <Drawer
      open
      size="md"
      tone={canAssign ? 'edit' : 'info'}
      title={canAssign ? config.title : config.viewTitle}
      onClose={onClose}
      footer={
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="mb-3 text-xs text-tertiary-500">{requirement.title}</p>
      {requirement.sales_owner?.name && (
        <p className="mb-3 text-xs text-tertiary-500">
          Sales owner: <span className="font-medium text-tertiary-800">{requirement.sales_owner.name}</span>
        </p>
      )}

      {isSalesButNotOwner && (
        <p className="mb-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Only the sales owner (or an admin) can change assignments on this requirement.
        </p>
      )}

      {!canAssign && !isSalesButNotOwner && (
        <p className="mb-3 rounded-xl border border-tertiary-100 bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">
          View only - sign in as Admin or the Sales owner to assign or unassign.
        </p>
      )}

      {canAssign && (
        <form onSubmit={assignPerson} className="mb-4 space-y-2 rounded-xl border border-primary-100 bg-primary-50 p-3">
          <label className="block text-xs font-medium text-primary-900">
            {config.fieldLabel}
            <SearchableSelect
              className="mt-1"
              required
              value={selectedPersonId}
              onChange={setSelectedPersonId}
              placeholder={config.placeholder}
              searchPlaceholder={config.searchPlaceholder}
              options={availablePeople.map((person) => ({ value: person.id, label: person.name }))}
            />
          </label>
          <button type="submit" disabled={saving || !selectedPersonId} className="btn-primary w-full">
            {saving ? 'Saving…' : config.saveLabel}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-tertiary-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-success-700">Active</h3>
            <ul className="space-y-2">
              {active.map((row) => (
                <li key={row.id} className="rounded-xl border border-success-100 bg-success-50/50 px-3 py-2 text-sm">
                  <div className="font-medium text-tertiary-900">{row.user?.name || '—'}</div>
                  {canAssign && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => unassignPerson(row.id)}
                      className="mt-1 text-xs font-medium text-danger-700 hover:underline"
                    >
                      Unassign
                    </button>
                  )}
                </li>
              ))}
              {active.length === 0 && <li className="text-sm text-tertiary-400">{config.emptyLabel}</li>}
            </ul>
          </div>
          {ended.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Ended</h3>
              <ul className="space-y-2">
                {ended.map((row) => (
                  <li key={row.id} className="rounded-xl border bg-tertiary-50 px-3 py-2 text-sm text-tertiary-600">
                    {row.user?.name || '—'} · ended {new Date(row.unassigned_at).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
