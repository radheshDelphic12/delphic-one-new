import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

/**
 * Admin / HR: how each leave type behaves for salary - is it offered, does it count against a balance
 * (excluded types are taken without a cap), is it paid, and does a request beyond the balance spill over
 * into Unpaid Leave. Comp Off is part of the balance (admin-set days + one per approved comp-off overtime day).
 */
export default function LeaveTypesAdmin() {
  const { pushError, pushSuccess } = useAlerts();
  const [types, setTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [managers, setManagers] = useState([]);
  const [pick, setPick] = useState('');
  const [mailingList, setMailingList] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const members = useOrgMembershipOptions(open);

  const load = useCallback(() => {
    apiClient.get('/leave/types').then(({ data }) => setTypes(data.data || [])).catch(() => setTypes([]));
  }, []);
  const loadManagers = useCallback(() => {
    apiClient.get('/leave/managers').then(({ data }) => setManagers(data.data || [])).catch(() => setManagers([]));
  }, []);
  const loadMailingList = useCallback(() => {
    apiClient.get('/leave/mailing-list').then(({ data }) => setMailingList(data.data?.emails || [])).catch(() => setMailingList([]));
  }, []);
  useEffect(() => { if (open) { load(); loadManagers(); loadMailingList(); } }, [open, load, loadManagers, loadMailingList]);

  async function saveMailingList(emails, message) {
    try {
      const { data } = await apiClient.put('/leave/mailing-list', { emails });
      setMailingList(data.data?.emails || emails);
      setNewEmail('');
      pushSuccess(message);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the leave mailing list'), 'Something went wrong');
    }
  }

  async function setManager(membershipId, value) {
    try {
      await apiClient.put(`/leave/managers/${membershipId}`, { is_leave_manager: value });
      pushSuccess(value ? 'Leave Manager added' : 'Leave Manager removed');
      setPick('');
      loadManagers();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the Leave Managers'), 'Something went wrong');
    }
  }

  async function patch(type, change) {
    try {
      await apiClient.patch(`/leave/types/${type.id}`, { ...change, reason: 'Changed from Leave settings' });
      pushSuccess(`${type.name} updated`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the leave type'), 'Something went wrong');
    }
  }

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <button type="button" className="text-sm font-semibold text-tertiary-800" onClick={() => setOpen((v) => !v)}>
        Leave type settings (salary) {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tertiary-500">
                <th className="py-1 pr-4">Leave type</th><th className="px-3">Applicable</th><th className="px-3">Counts in balance</th><th className="px-3">Paid</th><th className="px-3">Excess becomes unpaid</th><th className="px-3 text-right">Yearly quota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tertiary-100">
              {types.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 pr-4 font-medium text-tertiary-800">{t.name}</td>
                  <td className="px-3"><input type="checkbox" checked={t.is_applicable !== false} onChange={() => patch(t, { is_applicable: t.is_applicable === false })} aria-label={`${t.name} applicable`} /></td>
                  <td className="px-3"><input type="checkbox" checked={t.counts_in_balance !== false} onChange={() => patch(t, { counts_in_balance: t.counts_in_balance === false })} aria-label={`${t.name} counts in balance`} /></td>
                  <td className="px-3"><input type="checkbox" checked={Boolean(t.paid)} onChange={() => patch(t, { paid: !t.paid })} aria-label={`${t.name} paid`} /></td>
                  <td className="px-3"><input type="checkbox" checked={Boolean(t.overflow_to_unpaid)} disabled={!t.paid} onChange={() => patch(t, { overflow_to_unpaid: !t.overflow_to_unpaid })} aria-label={`${t.name} overflow to unpaid`} /></td>
                  <td className="px-3 text-right tabular-nums">{t.annual_quota ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 border-t border-tertiary-100 pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Leave Managers</h4>
            <p className="text-xs text-tertiary-500">They manage and process leave requests for the company. Admins keep full control and can override any decision.</p>
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {managers.map((m) => <li key={m.org_membership_id} className="inline-flex items-center gap-2 rounded-full bg-tertiary-50 px-3 py-1">{m.name}<button type="button" className="text-xs text-danger-600" onClick={() => setManager(m.org_membership_id, false)}>Remove</button></li>)}
              {managers.length === 0 && <li className="text-xs text-tertiary-400">No Leave Managers yet - admins process leave.</li>}
            </ul>
            <div className="mt-2 flex max-w-md items-end gap-2">
              <div className="flex-1"><SearchableSelect value={pick} onChange={setPick} options={members} placeholder="Add a Leave Manager" /></div>
              <button type="button" className="btn-secondary" disabled={!pick} onClick={() => setManager(pick, true)}>Add</button>
            </div>
          </div>
          <div className="mt-4 border-t border-tertiary-100 pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Leave mailing list</h4>
            <p className="text-xs text-tertiary-500">When someone applies for leave, an email goes to their reporting manager and to every address here (for example HR or a shared inbox).</p>
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {mailingList.map((email) => <li key={email} className="inline-flex items-center gap-2 rounded-full bg-tertiary-50 px-3 py-1">{email}<button type="button" className="text-xs text-danger-600" onClick={() => saveMailingList(mailingList.filter((e) => e !== email), 'Removed from the leave mailing list')}>Remove</button></li>)}
              {mailingList.length === 0 && <li className="text-xs text-tertiary-400">No addresses yet - only the reporting manager is emailed.</li>}
            </ul>
            <form className="mt-2 flex max-w-md items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) saveMailingList([...mailingList, newEmail.trim()], 'Added to the leave mailing list'); }}>
              <input type="email" className="flex-1 rounded-lg border border-tertiary-200 px-3 py-2 text-sm" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="hr@company.com" aria-label="Leave mailing list email" />
              <button type="submit" className="btn-secondary" disabled={!newEmail.trim()}>Add</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
