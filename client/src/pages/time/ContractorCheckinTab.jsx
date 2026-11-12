import { useCallback, useEffect, useState } from 'react';
import { Download, LogIn, LogOut, Pencil, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../../components/ui/Modal.jsx';
import { hoursMinutes, clock } from './checkinLabels.js';

// Contractor check-in (Delphic Global): a plain in / out clock. No location, no selfie, no late rule; never feeds attendance or pay.

// An instant <-> the value of a datetime-local input, in India time.
const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v) => new Date(`${v}:00+05:30`).toISOString();
const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const daysAgoIso = (n) => new Date(Date.now() + 330 * 60000 - n * 86400000).toISOString().slice(0, 10);
const field = 'mt-1 block w-full rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm text-tertiary-900';

function SessionsLine({ sessions }) {
  if (!sessions?.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-xs text-tertiary-600">
      {sessions.map((s) => (
        <li key={s.id}>
          In <b className="text-tertiary-900">{clock(s.in_at)}</b>{' '}
          {s.out_at ? <>Out <b className="text-tertiary-900">{clock(s.out_at)}</b></> : <b className="text-green-700">at work now</b>}
        </li>
      ))}
    </ul>
  );
}

function MyCheckin() {
  const { pushError, pushSuccess } = useAlerts();
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'in' | 'out'

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([apiClient.get('/contractor-checkin/today'), apiClient.get('/contractor-checkin/mine', { params: { from: daysAgoIso(14), to: todayIso() } })]);
      setToday(t.data.data);
      setHistory(h.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load your check-in'), 'Something went wrong');
    }
  }, [pushError]);
  useEffect(() => { load(); }, [load]);

  async function send(type) {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/contractor-checkin/check-${type}`);
      const last = data.data.sessions[data.data.sessions.length - 1];
      pushSuccess(type === 'in' ? `Checked in at ${clock(last.in_at)}` : `Checked out at ${clock(last.out_at)}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Not saved');
    } finally {
      setBusy(false);
    }
  }
  function confirmed() {
    const type = confirm;
    setConfirm(null);
    send(type);
  }

  if (!today) return <p className="text-sm text-tertiary-500">Loading…</p>;
  if (!today.eligible) return null;
  const at = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          {!today.currently_in && <button type="button" disabled={busy} className="btn-primary inline-flex items-center gap-2" onClick={() => setConfirm('in')}><LogIn className="h-4 w-4" /> {today.sessions.length ? 'Check in again' : 'Check in'}</button>}
          {today.currently_in && <button type="button" disabled={busy} className="btn-secondary inline-flex items-center gap-2" onClick={() => setConfirm('out')}><LogOut className="h-4 w-4" /> Check out</button>}
          {today.worked_minutes > 0 && <span className="text-sm text-tertiary-600">At work today: <b className="text-tertiary-900">{hoursMinutes(today.worked_minutes)}</b></span>}
        </div>
        <SessionsLine sessions={today.sessions} />
      </div>
      <Modal
        open={Boolean(confirm)}
        title={confirm === 'out' ? 'Check out now?' : 'Check in now?'}
        onClose={() => setConfirm(null)}
        footer={<><button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={confirmed}>{confirm === 'out' ? 'Yes, check out' : 'Yes, check in'}</button></>}
      >
        <p className="text-tertiary-700">You will be {confirm === 'out' ? 'checked out' : 'checked in'} at <b>{at}</b>.</p>
      </Modal>
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">First in</th><th className="px-3 py-2">Last out</th><th className="px-3 py-2">At work</th></tr>
          </thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-tertiary-500">No check-ins in the last 14 days</td></tr>}
            {history.map((r) => (
              <tr key={r.date} className="border-t border-tertiary-100">
                <td className="px-3 py-2">{r.date}</td><td className="px-3 py-2">{clock(r.first_in)}</td><td className="px-3 py-2">{r.currently_in ? 'at work' : clock(r.last_out)}</td><td className="px-3 py-2">{hoursMinutes(r.worked_minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Shown in the contractor portal; renders nothing for anyone who is not a contractor. */
export function ContractorCheckinPortalCard() {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-tertiary-900">Check in / out</h2>
      <MyCheckin />
    </section>
  );
}

// Admin: change the in / out time of one session (clear the out time to re-open it). A reason is required and goes to the audit log.
function EditSession({ session, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [v, setV] = useState({ in_at: toLocalInput(session.in_at), out_at: toLocalInput(session.out_at), reason: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await apiClient.patch(`/contractor-checkin/sessions/${session.id}`, { in_at: fromLocalInput(v.in_at), out_at: v.out_at ? fromLocalInput(v.out_at) : null, reason: v.reason });
      pushSuccess('Check-in updated');
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Not saved');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Edit check-in" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || v.reason.trim().length < 3 || !v.in_at} onClick={save}>Save</button></>}>
      <div className="space-y-3">
        <label className="block text-xs text-tertiary-500">Check-in<input type="datetime-local" className={field} value={v.in_at} onChange={(e) => setV({ ...v, in_at: e.target.value })} /></label>
        <label className="block text-xs text-tertiary-500">Check-out (clear to re-open)<input type="datetime-local" className={field} value={v.out_at} onChange={(e) => setV({ ...v, out_at: e.target.value })} /></label>
        <label className="block text-xs text-tertiary-500">Why are you changing it? *<textarea rows={2} className={field} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. Forgot to check out" /></label>
      </div>
    </Modal>
  );
}

function RemoveSession({ session, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await apiClient.delete(`/contractor-checkin/sessions/${session.id}`, { data: { reason } });
      pushSuccess('Check-in removed');
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not remove'), 'Not removed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Remove this check-in?" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={remove}>Remove</button></>}>
      <p className="text-tertiary-700">In {clock(session.in_at)}{session.out_at ? `, out ${clock(session.out_at)}` : ', still in'}.</p>
      <label className="mt-3 block text-xs text-tertiary-500">Why are you removing it? *<textarea rows={2} className={field} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </Modal>
  );
}

function Report({ canEdit }) {
  const { pushError } = useAlerts();
  const [f, setF] = useState({ from: daysAgoIso(6), to: todayIso(), org_membership_id: '' });
  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [remove, setRemove] = useState(null);

  const params = useCallback(() => ({ from: f.from, to: f.to, ...(f.org_membership_id ? { org_membership_id: f.org_membership_id } : {}) }), [f]);
  const load = useCallback(async () => {
    try {
      const { data: res } = await apiClient.get('/contractor-checkin/report', { params: params() });
      setData(res.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load the report'), 'Something went wrong');
    }
  }, [params, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiClient.get('/contractor-checkin/people').then(({ data: r }) => setPeople(r.data || [])).catch(() => setPeople([])); }, []);

  async function download() {
    try {
      const { data: blob } = await apiClient.get('/contractor-checkin/report.csv', { params: params(), responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `contractor-checkin-${f.from}-to-${f.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not download'), 'Not downloaded');
    }
  }
  const saved = () => { setEdit(null); setRemove(null); load(); };
  const s = data?.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <label className="text-xs text-tertiary-500">From<input type="date" className={field} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-xs text-tertiary-500">To<input type="date" className={field} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="text-xs text-tertiary-500">Contractor
          <select className={field} value={f.org_membership_id} onChange={(e) => setF({ ...f, org_membership_id: e.target.value })}>
            <option value="">All contractors</option>
            {people.map((p) => <option key={p.org_membership_id} value={p.org_membership_id}>{p.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={download}><Download className="h-4 w-4" /> CSV</button>
      </div>
      {s && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-tertiary-600">
          <span>Contractors: <b className="text-tertiary-900">{s.contractors}</b></span>
          <span>Days: <b className="text-tertiary-900">{s.days}</b></span>
          <span>Time at work: <b className="text-tertiary-900">{hoursMinutes(s.worked_minutes)}</b></span>
          <span>Still checked in: <b className="text-tertiary-900">{s.still_in}</b></span>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Contractor</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">First in</th><th className="px-3 py-2">Last out</th><th className="px-3 py-2">At work</th><th className="px-3 py-2">Check-ins</th></tr>
          </thead>
          <tbody>
            {data && data.rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-tertiary-500">No contractor check-ins in this range</td></tr>}
            {(data?.rows || []).map((r) => (
              <tr key={`${r.org_membership_id}|${r.date}`} className="border-t border-tertiary-100 align-top">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.name}{r.employee_code ? <span className="ml-1 text-xs text-tertiary-400">{r.employee_code}</span> : null}</td>
                <td className="px-3 py-2">{r.vendor || '—'}</td>
                <td className="px-3 py-2">{clock(r.first_in)}</td>
                <td className="px-3 py-2">{r.currently_in ? <span className="text-green-700">at work</span> : clock(r.last_out)}</td>
                <td className="px-3 py-2">{hoursMinutes(r.worked_minutes)}</td>
                <td className="px-3 py-2">
                  <ul className="space-y-1 text-xs">
                    {r.sessions.map((x) => (
                      <li key={x.id} className="flex items-center gap-2">
                        <span>{clock(x.in_at)} – {x.out_at ? clock(x.out_at) : 'now'}{x.edited ? ' (edited)' : ''}</span>
                        {canEdit && <>
                          <button type="button" aria-label="Edit check-in" className="text-tertiary-500 hover:text-primary-700" onClick={() => setEdit(x)}><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" aria-label="Remove check-in" className="text-tertiary-500 hover:text-red-700" onClick={() => setRemove(x)}><Trash2 className="h-3.5 w-3.5" /></button>
                        </>}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <EditSession session={edit} onClose={() => setEdit(null)} onSaved={saved} />}
      {remove && <RemoveSession session={remove} onClose={() => setRemove(null)} onSaved={saved} />}
    </div>
  );
}

/** Time & Attendance tab for HR / admins: every contractor's check-ins and time at work. */
export default function ContractorCheckinTab({ canEdit = false }) {
  return <Report canEdit={canEdit} />;
}
