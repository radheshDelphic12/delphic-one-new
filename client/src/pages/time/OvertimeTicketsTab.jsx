import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { useOrgMembershipOptions } from '../../lib/lookups.js';

const todayIso = () => new Date().toISOString().slice(0, 10);
const STATUS = { pending: 'Pending', manager_approved: 'Waiting for admin', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';
const labelCls = 'text-xs font-medium text-tertiary-600';

/**
 * Admin form: apply overtime for any employee (mode "apply"), or correct an existing ticket (mode "edit").
 * Every change needs a reason and is kept on the ticket history and the audit log.
 */
function AdminTicketModal({ mode, ticket, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const members = useOrgMembershipOptions(mode === 'apply');
  const editing = mode === 'edit';
  const [projects, setProjects] = useState([]);
  const [f, setF] = useState(() => ({
    org_membership_id: '',
    date: editing ? ticket.date : todayIso(),
    hours: editing ? String(ticket.hours) : '',
    account_id: editing ? ticket.account_id || '' : '',
    status: editing ? ticket.status : 'approved',
    reason: editing ? ticket.reason || '' : '',
    admin_reason: '',
  }));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setF((cur) => ({ ...cur, [key]: value }));

  // Only the projects this employee is assigned to on that day are offered; a project that no longer
  // applies after the employee or the date changes is cleared.
  const memberId = editing ? ticket.org_membership_id : f.org_membership_id;
  useEffect(() => {
    if (!memberId) { setProjects([]); return undefined; }
    let live = true;
    apiClient
      .get('/timesheets/overtime-tickets/employee-projects', { params: { org_membership_id: memberId, date: f.date || undefined } })
      .then(({ data }) => {
        if (!live) return;
        setProjects(data.data || []);
        setF((cur) => (cur.account_id && !(data.data || []).some((x) => x.id === cur.account_id) ? { ...cur, account_id: '' } : cur));
      })
      .catch(() => { if (live) setProjects([]); });
    return () => { live = false; };
  }, [memberId, f.date]);
  const ok = Number(f.hours) > 0 && f.reason.trim().length >= 3 && (editing ? f.admin_reason.trim().length >= 3 : Boolean(f.org_membership_id));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await apiClient.patch(`/timesheets/overtime-tickets/${ticket.id}/admin`, {
          date: f.date,
          hours: Number(f.hours),
          account_id: f.account_id || null,
          status: f.status,
          ticket_reason: f.reason.trim(),
          reason: f.admin_reason.trim(),
        });
        pushSuccess('Overtime updated');
      } else {
        await apiClient.post('/timesheets/overtime-tickets/admin', {
          org_membership_id: f.org_membership_id,
          date: f.date,
          hours: Number(f.hours),
          account_id: f.account_id || null,
          status: f.status,
          reason: f.reason.trim(),
        });
        pushSuccess(f.status === 'approved' ? 'Overtime applied and approved' : 'Overtime ticket created');
      }
      onDone();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the overtime'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open wide title={editing ? `Edit overtime: ${ticket.employee}` : 'Apply overtime for an employee'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && (
            <div className="sm:col-span-2">
              <span className={labelCls}>Employee</span>
              <SearchableSelect value={f.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={members} placeholder="Choose the employee" />
            </div>
          )}
          <label className={labelCls}>Date<input required type="date" max={todayIso()} value={f.date} onChange={(e) => set('date', e.target.value)} className={inputCls} /></label>
          <label className={labelCls}>Hours<input required type="number" min="0.25" max="12" step="0.25" value={f.hours} onChange={(e) => set('hours', e.target.value)} className={inputCls} /></label>
          <label className={labelCls}>Project (billed to the client if it bills overtime)
            <select value={f.account_id} onChange={(e) => set('account_id', e.target.value)} disabled={!memberId} className={inputCls}>
              <option value="">{memberId ? 'No project / internal' : 'Choose the employee first'}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.name} · ${p.code}` : p.name}</option>)}
            </select>
            {memberId && projects.length === 0 && <span className="mt-0.5 block text-[11px] font-normal text-tertiary-400">No project is assigned to this employee on that date.</span>}
          </label>
          <label className={labelCls}>Status
            <select value={f.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
              <option value="approved">Approved (paid and billed)</option>
              <option value="pending">Pending (still to be decided)</option>
              {editing && <option value="manager_approved">Waiting for admin</option>}
              {editing && <option value="rejected">Rejected</option>}
              {editing && <option value="cancelled">Cancelled</option>}
            </select>
          </label>
          <label className={`${labelCls} sm:col-span-2`}>{editing ? 'Why overtime was needed' : 'Reason for the overtime'}
            <input required minLength={3} maxLength={500} value={f.reason} onChange={(e) => set('reason', e.target.value)} className={inputCls} />
          </label>
          {editing && (
            <label className={`${labelCls} sm:col-span-2`}>Reason for this change (kept in the history)
              <input required minLength={3} maxLength={500} value={f.admin_reason} onChange={(e) => set('admin_reason', e.target.value)} className={inputCls} />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || !ok}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Apply overtime'}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Overtime tickets. People paid from attendance raise a ticket (day, hours, project, reason); their
 * reporting manager (or an admin) approves it. Approved hours are paid as overtime and billed to the
 * client where the project bills overtime. Managers decide their reports' tickets here; admins see
 * every ticket and can edit or delete any of them (with a reason).
 */
export default function OvertimeTicketsTab({ isAdmin }) {
  const { pushError, pushSuccess } = useAlerts();
  const [mine, setMine] = useState({ tickets: [], uses_tickets: false });
  const [queue, setQueue] = useState([]);
  const [all, setAll] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ date: todayIso(), hours: '', account_id: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);
  const [adminModal, setAdminModal] = useState(null); // { mode: 'apply' } | { mode: 'edit', ticket }

  const fail = (err, text) => pushError(apiErrorMessage(err, text), 'Something went wrong');

  function load() {
    apiClient.get('/timesheets/overtime-tickets', { params: { scope: 'mine' } }).then(({ data }) => setMine(data.data)).catch((e) => fail(e, 'Failed to load your tickets'));
    apiClient.get('/timesheets/overtime-tickets', { params: { scope: 'to_decide' } }).then(({ data }) => setQueue(data.data.tickets)).catch(() => setQueue([]));
    if (isAdmin) apiClient.get('/timesheets/overtime-tickets', { params: { scope: 'all' } }).then(({ data }) => setAll(data.data.tickets)).catch(() => setAll([]));
  }
  useEffect(() => {
    load();
    apiClient.get('/timesheets/my-projects').then(({ data }) => setProjects(data.data || [])).catch(() => setProjects([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function raise(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/timesheets/overtime-tickets', { date: form.date, hours: Number(form.hours), account_id: form.account_id || null, reason: form.reason.trim() });
      pushSuccess('Overtime ticket sent to your manager');
      setForm({ date: todayIso(), hours: '', account_id: '', reason: '' });
      load();
    } catch (err) {
      fail(err, 'Failed to raise the ticket');
    } finally {
      setSaving(false);
    }
  }

  async function call(fn, done) {
    try { await fn(); pushSuccess(done); load(); } catch (err) { fail(err, 'That did not work'); }
  }
  const approve = (t) => call(() => apiClient.post(`/timesheets/overtime-tickets/${t.id}/decision`, { status: 'approved' }), isAdmin ? 'Ticket approved' : 'Approved - it now waits for the admin');
  const reject = (t) => {
    const reason = window.prompt(`Reject ${t.employee}'s ${t.hours}h on ${t.date}? Give the reason (required):`);
    if (reason === null) return undefined;
    if (reason.trim().length < 3) { pushError('A reason is required', 'Not rejected'); return undefined; }
    return call(() => apiClient.post(`/timesheets/overtime-tickets/${t.id}/decision`, { status: 'rejected', reason: reason.trim() }), 'Ticket rejected');
  };
  // The ticket's audit history: submission, each approval / rejection step, edits - who and when.
  const showHistory = (t) => apiClient.get(`/timesheets/overtime-tickets/${t.id}/history`).then(({ data }) => setHistory({ ticket: t, events: data.data.events })).catch((e) => fail(e, 'Failed to load the history'));
  const historyButton = (t) => <button type="button" className="btn-ghost text-xs" onClick={() => showHistory(t)}>History</button>;
  const cancel = (t) => call(() => apiClient.post(`/timesheets/overtime-tickets/${t.id}/cancel`), 'Ticket cancelled');
  const adminEdit = (t) => setAdminModal({ mode: 'edit', ticket: t });
  const adminDelete = (t) => {
    const reason = window.prompt(`Delete ${t.employee}'s ${t.hours}h ticket on ${t.date}? Give a reason (required):`);
    if (reason === null) return undefined;
    if (reason.trim().length < 3) { pushError('A reason is required', 'Not deleted'); return undefined; }
    return call(() => apiClient.delete(`/timesheets/overtime-tickets/${t.id}`, { data: { reason: reason.trim() } }), 'Ticket deleted');
  };

  const base = [
    { key: 'date', header: 'Date', render: (t) => t.date },
    { key: 'employee', header: 'Employee', render: (t) => <span className="font-medium text-tertiary-900">{t.employee}</span> },
    { key: 'hours', header: 'Hours', render: (t) => t.hours },
    { key: 'project', header: 'Project', render: (t) => t.project || '—' },
    { key: 'reason', header: 'Reason', render: (t) => <span className="text-xs text-tertiary-600">{t.reason}</span> },
    { key: 'status', header: 'Status', render: (t) => <span><Badge value={t.status === 'cancelled' ? 'rejected' : t.status} label={STATUS[t.status]} />{t.decision_reason && <span className="block text-xs text-tertiary-500">{t.decided_by?.name ? `${t.decided_by.name}: ` : ''}{t.decision_reason}</span>}</span> },
  ];
  const mineColumns = [...base.filter((c) => c.key !== 'employee'), { key: 'actions', header: '', render: (t) => <span className="flex gap-1">{t.status === 'pending' && <button type="button" className="btn-ghost text-xs" onClick={() => cancel(t)}>Cancel</button>}{historyButton(t)}</span> }];
  const queueColumns = [...base, { key: 'actions', header: '', render: (t) => <span className="flex gap-1"><button type="button" className="btn-secondary text-xs" onClick={() => approve(t)}>Approve</button><button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => reject(t)}>Reject</button>{historyButton(t)}</span> }];
  const allColumns = [...base, {
    key: 'actions',
    header: '',
    render: (t) => (
      <span className="flex flex-wrap gap-1">
        {t.status !== 'approved' && t.status !== 'cancelled' && <button type="button" className="btn-ghost text-xs" onClick={() => approve(t)}>Approve</button>}
        {t.status !== 'rejected' && t.status !== 'cancelled' && <button type="button" className="btn-ghost text-xs" onClick={() => reject(t)}>Reject</button>}
        {historyButton(t)}
        <button type="button" className="btn-ghost text-xs" onClick={() => adminEdit(t)}>Edit</button>
        <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => adminDelete(t)}>Delete</button>
      </span>
    ),
  }];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">My overtime tickets</h2>
        {mine.uses_tickets ? (
          <form onSubmit={raise} className="grid gap-2 rounded-xl border border-tertiary-100 bg-white p-3 sm:grid-cols-[8rem_6rem_1fr_2fr_auto]">
            <label className="text-xs font-medium text-tertiary-600">Date<input required type="date" max={todayIso()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="text-xs font-medium text-tertiary-600">Hours<input required type="number" min="0.25" max="12" step="0.25" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <label className="text-xs font-medium text-tertiary-600">Project (billed to the client if it bills overtime)
              <select value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
                <option value="">No project / internal</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-tertiary-600">Why was overtime needed?<input required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
            <div className="flex items-end"><button type="submit" className="btn-primary" disabled={saving || !(Number(form.hours) > 0) || form.reason.trim().length < 3}>{saving ? 'Sending…' : 'Raise ticket'}</button></div>
          </form>
        ) : (
          <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">Overtime tickets are for people paid from attendance. Your overtime comes from your timesheet hours, so there is nothing to raise here.</p>
        )}
        <DataTable columns={mineColumns} rows={mine.tickets} emptyLabel="You have not raised any overtime tickets" />
      </section>

      {queue.length > 0 && (
        <section className="space-y-3 border-t border-tertiary-100 pt-6">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Waiting for your approval <span className="font-normal text-tertiary-500">({queue.length})</span></h2>
          <DataTable columns={queueColumns} rows={queue} emptyLabel="Nothing waiting" />
        </section>
      )}

      {isAdmin && (
        <section className="space-y-3 border-t border-tertiary-100 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-semibold text-tertiary-900">All overtime tickets</h2>
            <button type="button" className="btn-primary" onClick={() => setAdminModal({ mode: 'apply' })}>Apply overtime for an employee</button>
          </div>
          <DataTable columns={allColumns} rows={all} emptyLabel="No overtime tickets yet" />
        </section>
      )}

      {adminModal && <AdminTicketModal mode={adminModal.mode} ticket={adminModal.ticket} onClose={() => setAdminModal(null)} onDone={load} />}

      <Modal open={Boolean(history)} title="Overtime ticket history" onClose={() => setHistory(null)} footer={<button type="button" className="btn-primary" onClick={() => setHistory(null)}>Close</button>}>
        {history && (
          <ul className="space-y-2 text-sm">
            {history.events.map((e) => (
              <li key={e.id} className="rounded-lg bg-tertiary-50 px-3 py-2">
                <span className="font-medium text-tertiary-900">{e.action.replace(/_/g, ' ')}</span>
                <span className="text-tertiary-500"> by {e.actor?.name || 'the employee'} · {new Date(e.created_at).toLocaleString()}</span>
                {e.reason && <p className="text-xs text-tertiary-600">{e.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
