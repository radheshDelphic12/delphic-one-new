import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../../components/ui/Modal.jsx';
import { ConfirmDialog, REASON_LABEL, STATUS_LABEL, StatusPill, todayYmd } from '../../components/resignation/resignationShared.jsx';

const box = 'overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card';
const input = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';

function Facts({ r }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-tertiary-400">Proposed last working day</dt><dd>{r.proposed_lwd || 'Not given'}</dd></div>
      <div><dt className="text-xs text-tertiary-400">Reason</dt><dd>{r.reason_category ? `${REASON_LABEL[r.reason_category] || r.reason_category}: ` : ''}{r.reason}</dd></div>
      <div><dt className="text-xs text-tertiary-400">Reporting manager</dt><dd>{r.manager || 'None'}</dd></div>
    </dl>
  );
}

/** What the manager recorded, shown to HR (and to the manager once it has moved on). */
function ManagerRecord({ r }) {
  if (!r.meeting_done && !r.manager_notes) return <p className="text-xs text-tertiary-400">The manager has not met the employee yet.</p>;
  return (
    <div className="rounded-xl bg-tertiary-50 px-3 py-2 text-sm text-tertiary-700">
      <div className="text-xs font-medium text-tertiary-500">Manager&apos;s call{r.meeting_done ? ` (meeting done${r.meeting_date ? ` on ${r.meeting_date}` : ''})` : ' (meeting pending)'}</div>
      {r.manager_notes && <div className="mt-0.5">{r.manager_notes}</div>}
    </div>
  );
}

// ---- manager

function ManagerCard({ r, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const open = r.status === 'submitted';
  const [form, setForm] = useState({ meeting_done: r.meeting_done, meeting_date: r.meeting_date || todayYmd(), manager_notes: r.manager_notes || '' });
  const [confirm, setConfirm] = useState(null); // 'not_retained' | 'retained'
  const [busy, setBusy] = useState(false);

  async function save(outcome = null) {
    setBusy(true);
    try {
      await apiClient.put(`/resignations/${r.id}/manager-review`, { ...form, manager_outcome: outcome });
      pushSuccess(outcome === 'not_retained' ? 'Approved and sent to HR' : outcome === 'retained' ? 'Marked as retained' : 'Saved');
      setConfirm(null);
      await onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Something went wrong');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${box} p-4`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-heading text-sm font-semibold text-tertiary-900">{r.employee}</span>
        <StatusPill status={r.status} />
      </div>
      <Facts r={r} />
      {open ? (
        <div className="mt-3 space-y-3 border-t border-tertiary-100 pt-3">
          <p className="text-xs text-tertiary-500">Meet {r.employee} first: understand the reason and try to retain. Then record it here and approve (it goes to HR) or mark as retained.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-tertiary-700">
              <input type="checkbox" checked={form.meeting_done} onChange={(e) => setForm({ ...form, meeting_done: e.target.checked })} />
              Meeting done with {r.employee}
            </label>
            <label className="text-xs font-medium text-tertiary-600">
              Meeting date
              <input type="date" max={todayYmd()} disabled={!form.meeting_done} value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} className={input} />
            </label>
            <label className="text-xs font-medium text-tertiary-600 sm:col-span-2">
              What came out of the call (the real problem, what you offered)
              <textarea rows={3} maxLength={2000} value={form.manager_notes} onChange={(e) => setForm({ ...form, manager_notes: e.target.value })} className={input} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => save(null)}>Save notes</button>
            <button type="button" className="btn-primary" disabled={busy || !form.meeting_done} title={form.meeting_done ? '' : 'Tick "Meeting done" first'} onClick={() => setConfirm('not_retained')}>Approve and send to HR</button>
            <button type="button" className="btn-secondary" disabled={busy || !form.meeting_done} title={form.meeting_done ? '' : 'Tick "Meeting done" first'} onClick={() => setConfirm('retained')}>Retained, close request</button>
          </div>
        </div>
      ) : (
        <div className="mt-3"><ManagerRecord r={r} /></div>
      )}
      <ConfirmDialog
        open={confirm === 'not_retained'}
        title="Approve this resignation?"
        message={`This confirms you met ${r.employee} and could not retain them. The request goes to HR for the last working day.`}
        confirmLabel="Yes, approve and send to HR"
        busy={busy}
        onConfirm={() => save('not_retained')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'retained'}
        title="Close as retained?"
        message={`This closes the resignation: ${r.employee} stays with the company.`}
        confirmLabel="Yes, retained"
        busy={busy}
        onConfirm={() => save('retained')}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

// ---- HR

function HrCard({ r, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [dialog, setDialog] = useState(null); // 'approve' | 'reject' | 'fnf'
  const [lwd, setLwd] = useState(r.proposed_lwd || '');
  const [remarks, setRemarks] = useState('');
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const waitingManager = r.status === 'submitted' && r.manager_membership_id;
  const canAct = r.status === 'submitted' || r.status === 'manager_approved';

  async function run(path, body, doneMessage) {
    setBusy(true);
    try {
      await apiClient.post(`/resignations/${r.id}/${path}`, body);
      pushSuccess(doneMessage);
      setDialog(null);
      await onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not complete the action'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${box} p-4`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-heading text-sm font-semibold text-tertiary-900">{r.employee}</span>
        {r.employee_code && <span className="text-xs text-tertiary-400">{r.employee_code}</span>}
        <StatusPill status={r.status} />
      </div>
      <Facts r={r} />
      <div className="mt-3"><ManagerRecord r={r} /></div>
      {r.status === 'approved' && (
        <p className="mt-3 text-sm text-tertiary-700">Last working day: <strong>{r.approved_lwd}</strong>{r.fnf_started_at ? ' · F&F started' : ''}</p>
      )}
      {r.decision_remarks && <p className="mt-2 text-xs text-tertiary-500">HR remarks: {r.decision_remarks}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canAct && <button type="button" className="btn-primary" onClick={() => { setLwd(r.proposed_lwd || ''); setDialog('approve'); }}>Approve and set last working day</button>}
        {canAct && <button type="button" className="btn-secondary" onClick={() => setDialog('reject')}>Reject</button>}
        {r.status === 'approved' && !r.fnf_started_at && <button type="button" className="btn-primary" onClick={() => setDialog('fnf')}>Move to F&F</button>}
      </div>

      <Modal
        open={dialog === 'approve'}
        title={`Approve ${r.employee}'s resignation`}
        onClose={() => setDialog(null)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy || !lwd || (waitingManager && !skip)} onClick={() => run('approve', { approved_lwd: lwd, remarks: remarks || undefined, skip_manager_step: skip || undefined }, 'Resignation approved. The employee is now serving notice.')}>{busy ? 'Saving…' : 'Approve'}</button>
          </>
        )}
      >
        <div className="space-y-3">
          {waitingManager && (
            <label className="flex items-start gap-2 text-sm text-amber-700">
              <input type="checkbox" className="mt-0.5" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              The manager has not approved yet. Tick to go ahead without the manager&apos;s step.
            </label>
          )}
          <label className="block text-xs font-medium text-tertiary-600">
            Last working day
            <input type="date" min={todayYmd()} value={lwd} onChange={(e) => setLwd(e.target.value)} className={input} />
            <span className="mt-1 block font-normal text-tertiary-400">{r.proposed_lwd ? `The employee asked for ${r.proposed_lwd}.` : 'The employee did not propose a date.'}</span>
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Remarks (optional)
            <input value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} className={input} />
          </label>
          <p className="text-xs text-tertiary-500">The employee&apos;s status becomes &ldquo;Serving notice&rdquo;. The full and final settlement starts only when you choose &ldquo;Move to F&amp;F&rdquo;.</p>
        </div>
      </Modal>
      <Modal
        open={dialog === 'reject'}
        title={`Reject ${r.employee}'s resignation`}
        onClose={() => setDialog(null)}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-danger" disabled={busy || remarks.trim().length < 3} onClick={() => run('reject', { remarks }, 'Resignation rejected')}>{busy ? 'Saving…' : 'Reject'}</button>
          </>
        )}
      >
        <label className="block text-xs font-medium text-tertiary-600">
          Reason for rejecting (the employee sees this)
          <textarea rows={3} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={input} />
        </label>
      </Modal>
      <ConfirmDialog
        open={dialog === 'fnf'}
        title="Move to full and final settlement?"
        message={`This starts the F&F process for ${r.employee} with ${r.approved_lwd} as the last working day.`}
        confirmLabel="Yes, move to F&F"
        busy={busy}
        onConfirm={() => run('start-fnf', undefined, 'F&F process started')}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function SettingsCard({ settings, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiClient.put('/resignations/settings', {
        resignation_enabled: form.resignation_enabled,
        resignation_manager_required: form.resignation_manager_required,
      });
      pushSuccess('Resignation settings saved');
      await onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the settings'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className={`${box} grid gap-3 p-4 sm:grid-cols-3`}>
      <label className="flex items-center gap-2 text-sm text-tertiary-700">
        <input type="checkbox" checked={form.resignation_enabled} onChange={(e) => setForm({ ...form, resignation_enabled: e.target.checked })} />
        Employees can resign from Settings
      </label>
      <label className="flex items-center gap-2 text-sm text-tertiary-700">
        <input type="checkbox" checked={form.resignation_manager_required} onChange={(e) => setForm({ ...form, resignation_manager_required: e.target.checked })} />
        Manager approves before HR
      </label>
      <div className="flex items-end"><button type="submit" className="btn-secondary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  );
}

export default function ResignationsTab({ showTeam, canHr, isAdmin }) {
  const { pushError } = useAlerts();
  const [team, setTeam] = useState(null);
  const [all, setAll] = useState(null);
  const [settings, setSettings] = useState(null);
  const [filter, setFilter] = useState('pending');

  const load = useCallback(async () => {
    try {
      const calls = [apiClient.get('/resignations/settings')];
      if (showTeam) calls.push(apiClient.get('/resignations/team')); else calls.push(Promise.resolve(null));
      if (canHr) calls.push(apiClient.get('/resignations')); else calls.push(Promise.resolve(null));
      const [s, t, a] = await Promise.all(calls);
      setSettings(s.data.data);
      setTeam(t ? t.data.data : []);
      setAll(a ? a.data.data : []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load resignations'), 'Something went wrong');
      setTeam([]);
      setAll([]);
    }
  }, [showTeam, canHr, pushError]);

  useEffect(() => { load(); }, [load]);

  if (!settings || !team || !all) return <p className="text-sm text-tertiary-400">Loading…</p>;

  const shown = all.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return r.status === 'manager_approved' || (r.status === 'submitted' && !r.manager_membership_id);
    return r.status === filter;
  });
  const waitingOnManagers = all.filter((r) => r.status === 'submitted' && r.manager_membership_id).length;

  return (
    <div className="space-y-6">
      {isAdmin && <SettingsCard settings={settings} onSaved={load} />}

      {showTeam && (
        <section className="space-y-3">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">My team&apos;s resignations</h2>
          {team.length === 0 ? <p className="text-sm text-tertiary-400">None.</p> : team.map((r) => <ManagerCard key={`${r.id}-${r.status}-${r.manager_updated_at}`} r={r} onChanged={load} />)}
        </section>
      )}

      {canHr && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-sm font-semibold text-tertiary-900">All resignations (HR)</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm">
              <option value="pending">Waiting for HR</option>
              <option value="all">All</option>
              {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {waitingOnManagers > 0 && <span className="text-xs text-tertiary-500">{waitingOnManagers} still with the reporting manager</span>}
          </div>
          {shown.length === 0 ? <p className="text-sm text-tertiary-400">Nothing here.</p> : shown.map((r) => <HrCard key={`${r.id}-${r.status}`} r={r} onChanged={load} />)}
        </section>
      )}
    </div>
  );
}
