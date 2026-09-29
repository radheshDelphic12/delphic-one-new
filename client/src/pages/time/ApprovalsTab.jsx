import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import RejectReasonModal from './RejectReasonModal.jsx';

/**
 * Approval inbox for a reporting manager: timesheet entries and
 * regularisation requests from their direct reports. Approve is one click;
 * reject asks for a reason, which is shown back to the employee.
 */
export default function ApprovalsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState({ entries: [], regularizations: [] });
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null); // { kind, row }

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get('/timesheets/approvals/pending')
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load approvals'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [pushError]);

  useEffect(() => { load(); }, [load]);

  async function decideEntry(entry, status, reason) {
    try {
      await apiClient.post(`/timesheets/entries/${entry.id}/decision`, { status, reason });
      pushSuccess(`Entry ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record the decision'), 'Something went wrong');
      throw err;
    }
  }

  async function decideRegularisation(ticket, status, reason) {
    try {
      await apiClient.post(`/timesheets/regularization-tickets/${ticket.id}/decision`, { status, decision_reason: reason });
      pushSuccess(`Request ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record the decision'), 'Something went wrong');
      throw err;
    }
  }

  const empty = !loading && data.entries.length === 0 && data.regularizations.length === 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-tertiary-500">Timesheets and regularisation requests from people who report to you.</p>

      {empty && <EmptyState icon={CheckCircle2} title="Nothing waiting on you" description="When your team submits hours, they'll show up here." />}

      {data.regularizations.length > 0 && (
        <section>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Regularisation requests</h3>
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {data.regularizations.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-tertiary-700">
                  <b className="text-tertiary-900">{t.org_membership?.person?.name || t.requester?.name}</b> — {String(t.date || t.timesheet_entry?.date || '').slice(0, 10)} · {t.target_hours ?? t.requested_change?.hours}h
                  {t.account?.name ? ` · ${t.account.name}` : ''}
                  <span className="block text-xs text-tertiary-500">{t.reason}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => decideRegularisation(t, 'approved')}>Approve</button>
                  <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting({ kind: 'regularisation', row: t })}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.entries.length > 0 && (
        <section>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Timesheet entries</h3>
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {data.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-tertiary-700">
                  <b className="text-tertiary-900">{e.org_membership?.person?.name}</b> — {String(e.date).slice(0, 10)} · {e.hours}h{Number(e.overtime_hours) ? ` + ${Number(e.overtime_hours)}h overtime` : ''}
                  {e.account?.name ? ` · ${e.account.name}` : ''}
                  {e.notes && <span className="block text-xs text-tertiary-500">{e.notes}</span>}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => decideEntry(e, 'approved')}>Approve</button>
                  <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting({ kind: 'entry', row: e })}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RejectReasonModal
        open={Boolean(rejecting)}
        title={rejecting?.kind === 'entry' ? 'Reject timesheet entry' : 'Reject regularisation request'}
        subject={rejecting ? `${rejecting.row.org_membership?.person?.name || rejecting.row.requester?.name || 'Employee'}` : ''}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => (rejecting.kind === 'entry' ? decideEntry(rejecting.row, 'rejected', reason) : decideRegularisation(rejecting.row, 'rejected', reason))}
      />
    </div>
  );
}
