import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import RejectReasonModal from './RejectReasonModal.jsx';
import NoteText from '../../components/NoteText.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import WeekHoursView from './WeekHoursView.jsx';

/**
 * Approval inbox for a reporting manager: timesheet entries and
 * regularisation requests from their direct reports. Approve is one click;
 * reject asks for a reason, which is shown back to the employee.
 */
export default function ApprovalsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState({ entries: [], regularizations: [], overtime: [] });
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null); // { kind, row }
  const [viewing, setViewing] = useState(null); // { membershipId, name, date }
  const [bulkBusy, setBulkBusy] = useState(false);

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

  async function decideOvertime(row, status, reason) {
    try {
      await apiClient.post(`/timesheets/overtime/${row.id}/decision`, { status, reason });
      pushSuccess(status === 'comp_off' ? 'Overtime given as comp off' : `Overtime ${status}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record the decision'), 'Something went wrong');
      throw err;
    }
  }

  // "Approve all" — the whole inbox, or one section. Each item is checked by
  // the server exactly like a single approval; any that can't be approved are reported.
  async function approveAll(sections) {
    const body = {
      entries: sections.includes('entries') ? data.entries.map((e) => e.id) : [],
      overtime: sections.includes('overtime') ? (data.overtime || []).map((o) => o.id) : [],
      regularizations: sections.includes('regularizations') ? data.regularizations.map((t) => t.id) : [],
    };
    const count = body.entries.length + body.overtime.length + body.regularizations.length;
    if (!count || !window.confirm(`Approve ${count} item${count === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    try {
      const { data: res } = await apiClient.post('/timesheets/approvals/bulk', body);
      const { approved, failed } = res.data;
      if (failed.length) pushError(`${approved} approved; ${failed.length} could not be approved (already decided or not yours to decide).`, 'Some items were skipped');
      else pushSuccess(`${approved} item${approved === 1 ? '' : 's'} approved`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to approve'), 'Something went wrong');
    } finally {
      setBulkBusy(false);
      load();
    }
  }

  const overtime = data.overtime || [];
  const totalPending = data.entries.length + data.regularizations.length + overtime.length;
  const sectionApproveAll = (section, count, label = 'Approve all') => (count > 1 ? (
    <button type="button" className="btn-secondary text-xs" disabled={bulkBusy} onClick={() => approveAll([section])}>{label} ({count})</button>
  ) : null);
  const viewWeek = (membership, date) => setViewing({ membershipId: membership?.id, name: membership?.person?.name, date: String(date).slice(0, 10) });
  const empty = !loading && data.entries.length === 0 && data.regularizations.length === 0 && overtime.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tertiary-500">Timesheets and regularisation requests from people who report to you.</p>
        {totalPending > 0 && (
          <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-sm" disabled={bulkBusy} onClick={() => approveAll(['regularizations', 'entries', 'overtime'])}>
            <CheckCircle2 className="h-4 w-4" /> {bulkBusy ? 'Approving…' : `Approve all (${totalPending})`}
          </button>
        )}
      </div>

      {empty && <EmptyState icon={CheckCircle2} title="Nothing waiting on you" description="When your team submits hours, they'll show up here." />}

      {data.regularizations.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Regularisation requests</h3>
            {sectionApproveAll('regularizations', data.regularizations.length)}
          </div>
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

      {overtime.length > 0 && (
        <section>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Overtime</h3>
            {sectionApproveAll('overtime', overtime.length, 'Approve all OT')}
          </div>
          <p className="mb-2 text-xs text-tertiary-500">Hours beyond the day&apos;s shift (or any hours on a weekend / company holiday). Only approved overtime is paid; comp off gives time off instead.</p>
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {overtime.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-tertiary-700">
                  <b className="text-tertiary-900">{o.org_membership?.person?.name}</b> — {String(o.date).slice(0, 10)} · <span className="font-semibold text-purple-700">{o.hours}h overtime</span>
                  <button type="button" className="ml-2 text-xs text-primary-700 hover:underline" onClick={() => viewWeek(o.org_membership, o.date)}>View week</button>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => decideOvertime(o, 'approved')}>Approve OT</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => decideOvertime(o, 'comp_off')}>Comp off</button>
                  <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => setRejecting({ kind: 'overtime', row: o })}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.entries.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Timesheet entries</h3>
            {sectionApproveAll('entries', data.entries.length)}
          </div>
          <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100 bg-white shadow-card">
            {data.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-tertiary-700">
                  <b className="text-tertiary-900">{e.org_membership?.person?.name}</b> — {String(e.date).slice(0, 10)} · {e.hours}h{Number(e.overtime_hours) ? ` + ${Number(e.overtime_hours)}h overtime` : ''}
                  {e.account?.name ? ` · ${e.account.name}` : ''}
                  {e.admin_review && <span className="ml-2" title="The week locked and wasn't reviewed in time — an admin should decide it"><Pill tone="red">Admin review</Pill></span>}
                  <button type="button" className="ml-2 text-xs text-primary-700 hover:underline" onClick={() => viewWeek(e.org_membership, e.date)}>View week</button>
                  {e.notes && <NoteText text={e.notes} className="text-xs text-tertiary-500" />}
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
        title={{ entry: 'Reject timesheet entry', overtime: 'Reject overtime' }[rejecting?.kind] || 'Reject regularisation request'}
        subject={rejecting ? `${rejecting.row.org_membership?.person?.name || rejecting.row.requester?.name || 'Employee'}` : ''}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (rejecting.kind === 'entry') return decideEntry(rejecting.row, 'rejected', reason);
          if (rejecting.kind === 'overtime') return decideOvertime(rejecting.row, 'rejected', reason);
          return decideRegularisation(rejecting.row, 'rejected', reason);
        }}
      />

      <Drawer open={Boolean(viewing)} title={viewing ? `${viewing.name || 'Employee'} — week` : ''} onClose={() => setViewing(null)} size="xl">
        {viewing && <WeekHoursView key={`${viewing.membershipId}-${viewing.date}`} orgMembershipId={viewing.membershipId} initialDate={viewing.date} />}
      </Drawer>
    </div>
  );
}
