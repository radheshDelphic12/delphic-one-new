import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Camera, Download, LogIn, LogOut, MapPin } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Modal from '../../components/ui/Modal.jsx';
import { CHECKIN_RESULT_LABEL, CHECKIN_COMPARISON_LABEL, CHECKIN_PLACE_LABEL, hoursMinutes, clock } from './checkinLabels.js';

// Location check-in (Delphic Global, full-time employees). Kept apart from Attendance: nothing here marks a day present or touches pay.
// My check-in (everyone), Report (HR / admin), Settings (admin).

const RESULT = {
  in_office: { label: CHECKIN_RESULT_LABEL.in_office, cls: 'bg-green-50 text-green-700' },
  outside_office: { label: CHECKIN_RESULT_LABEL.outside_office, cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  work_from_home: { label: CHECKIN_RESULT_LABEL.work_from_home, cls: 'bg-blue-50 text-blue-700' },
  location_unavailable: { label: CHECKIN_RESULT_LABEL.location_unavailable, cls: 'bg-amber-50 text-amber-700' },
};
const COMPARISON = {
  as_planned: { label: CHECKIN_COMPARISON_LABEL.as_planned, cls: 'text-green-700' },
  office_day_outside: { label: CHECKIN_COMPARISON_LABEL.office_day_outside, cls: 'font-semibold text-red-700' },
  home_day_at_office: { label: CHECKIN_COMPARISON_LABEL.home_day_at_office, cls: 'text-amber-700' },
  no_location: { label: CHECKIN_COMPARISON_LABEL.no_location, cls: 'text-amber-700' },
  wfh_no_location: { label: CHECKIN_COMPARISON_LABEL.wfh_no_location, cls: 'text-tertiary-500' },
  no_checkin: { label: CHECKIN_COMPARISON_LABEL.no_checkin, cls: 'font-medium text-amber-700' },
  on_leave: { label: CHECKIN_COMPARISON_LABEL.on_leave, cls: 'text-tertiary-500' },
};
const REASON = { lunch: 'Lunch', break: 'Break', meeting: 'Meeting', other: 'Other' };
const ATTENDANCE = { present: 'Present', absent: 'Absent', half_day: 'Half day', leave: 'On leave', holiday: 'Holiday', wfh: 'Work from home' };
const PLACE = CHECKIN_PLACE_LABEL;

const pad = (n) => String(n).padStart(2, '0');
const minutesToTime = (m) => (m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
const timeToMinutes = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};
// An instant <-> the value of a datetime-local input, in India time.
const toLocalInput = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v) => new Date(`${v}:00+05:30`).toISOString();
const todayIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const daysAgoIso = (n) => new Date(Date.now() + 330 * 60000 - n * 86400000).toISOString().slice(0, 10);

function Pill({ result }) {
  const r = RESULT[result];
  if (!r) return <span className="text-tertiary-400">—</span>;
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${r.cls}`}>{r.label}</span>;
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// Live camera preview that returns one JPEG on "Capture".
function SelfieCapture({ onCapture, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        return null;
      })
      .catch(() => setError('The camera could not be opened. Allow camera access in the browser and try again.'));
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.8);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-tertiary-200 bg-white p-4">
      <p className="text-sm font-medium text-tertiary-900">Take a selfie to check in</p>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-sm rounded-xl bg-black" />}
      <div className="flex gap-2">
        {!error && <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={capture}><Camera className="h-4 w-4" /> Capture and check in</button>}
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SessionsLine({ rec }) {
  if (!rec?.sessions?.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-xs text-tertiary-600">
      {rec.sessions.map((s, i) => (
        <li key={s.id} className="flex flex-wrap items-center gap-x-2">
          <span>In <b className="text-tertiary-900">{clock(s.in_at)}</b></span>
          <span>{s.out_at ? <>Out <b className="text-tertiary-900">{clock(s.out_at)}</b>{s.out_reason ? ` (${REASON[s.out_reason]})` : ''}</> : <b className="text-green-700">at work now</b>}</span>
          {s.out_at && rec.sessions[i + 1] && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">away {hoursMinutes(Math.round((new Date(rec.sessions[i + 1].in_at) - new Date(s.out_at)) / 60000))}</span>}
        </li>
      ))}
    </ul>
  );
}

function MyCheckin({ showHistory = true }) {
  const { pushError, pushSuccess } = useAlerts();
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  // The confirmation dialog: { type: 'in' | 'out', selfie }
  const [confirm, setConfirm] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([apiClient.get('/location-checkin/today'), apiClient.get('/location-checkin/mine', { params: { from: daysAgoIso(14), to: todayIso() } })]);
      setToday(t.data.data);
      setHistory(h.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load your check-in'), 'Something went wrong');
    }
  }, [pushError]);
  useEffect(() => { load(); }, [load]);

  async function send(path, selfie, extra = {}) {
    setBusy(true);
    try {
      const form = new FormData();
      const pos = await getPosition();
      if (pos) Object.entries(pos).forEach(([k, v]) => form.append(k, String(v)));
      Object.entries(extra).forEach(([k, v]) => v && form.append(k, v));
      if (selfie) form.append('selfie', selfie, 'selfie.jpg');
      const { data } = await apiClient.post(path, form);
      const r = data.data;
      const last = r.sessions[r.sessions.length - 1];
      pushSuccess(path.endsWith('check-in') ? `Checked in at ${clock(last.in_at)}` : `Checked out at ${clock(last.out_at)}`);
      if (!pos) pushError('Your location was not available, so this was saved without one.', 'No location');
      setCamera(false);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Not saved');
    } finally {
      setBusy(false);
    }
  }

  // Selfie mode (set by an admin): required opens the camera after the confirmation; optional offers both ways; off checks in straight away.
  function confirmed() {
    const c = confirm;
    setConfirm(null);
    if (c.type === 'out') return send('/location-checkin/check-out', null, { reason });
    if (c.selfie || today.selfie_mode === 'required') return setCamera(true);
    return send('/location-checkin/check-in', null);
  }
  const ask = (type, selfie = false) => { setReason(''); setConfirm({ type, selfie }); };

  if (!today) return <p className="text-sm text-tertiary-500">Loading…</p>;
  if (!today.eligible) return <p className="rounded-xl bg-tertiary-50 px-4 py-3 text-sm text-tertiary-700">Workplace check-in is for full-time employees.</p>;
  const rec = today.record;
  const at = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-tertiary-600">
          <span>Today: <b className="text-tertiary-900">{PLACE[today.planned_place]}</b></span>
          <span>Office: <b className="text-tertiary-900">{today.office_name || 'Not set'}</b></span>
          <span>Late after: <b className="text-tertiary-900">{minutesToTime(today.late_after_minutes)}</b>{today.shift ? <span className="ml-1 text-xs">({today.shift.name})</span> : null}</span>
        </div>
        {today.planned_place === 'office' && !today.office_configured && <p className="mt-2 text-xs text-amber-700">Your office has no map point yet, so your location cannot be compared. Ask an admin to set it.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {(!rec || !rec.currently_in) && !camera && <button type="button" disabled={busy} className="btn-primary inline-flex items-center gap-2" onClick={() => ask('in')}><LogIn className="h-4 w-4" /> {rec ? 'Check in again' : 'Check in'}</button>}
          {(!rec || !rec.currently_in) && !camera && today.selfie_mode === 'optional' && <button type="button" disabled={busy} className="btn-secondary inline-flex items-center gap-2" onClick={() => ask('in', true)}><Camera className="h-4 w-4" /> {rec ? 'Check in again with a selfie' : 'Check in with a selfie'}</button>}
          {rec?.currently_in && <button type="button" disabled={busy} className="btn-secondary inline-flex items-center gap-2" onClick={() => ask('out')}><LogOut className="h-4 w-4" /> Check out</button>}
          {busy && <span className="text-sm text-tertiary-500">Getting your location…</span>}
        </div>
        {rec && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>First in <b>{clock(rec.check_in_at)}</b></span>
            <Pill result={rec.check_in_result} />
            {rec.late_minutes > 0 && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">{hoursMinutes(rec.late_minutes)} late</span>}
            {rec.out_of_desk_minutes > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">{hoursMinutes(rec.out_of_desk_minutes)} out of desk today</span>}
            {!rec.currently_in && <span className="text-tertiary-500">You are checked out. Tap “Check in again” if that was a mistake or you are back.</span>}
          </div>
        )}
        <SessionsLine rec={rec} />
      </div>
      {camera && <SelfieCapture onCancel={() => setCamera(false)} onCapture={(blob) => send('/location-checkin/check-in', blob)} />}
      <Modal
        open={Boolean(confirm)}
        title={confirm?.type === 'out' ? 'Check out now?' : rec ? 'Check in again?' : 'Check in now?'}
        onClose={() => setConfirm(null)}
        footer={<><button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={confirmed}>{confirm?.type === 'out' ? 'Yes, check out' : 'Yes, check in'}</button></>}
      >
        <p className="text-tertiary-700">
          {confirm?.type === 'out' ? <>You will be checked out at <b>{at}</b>. Time until you check in again counts as out of desk.</> : <>You will be checked in at <b>{at}</b>{today.selfie_mode === 'required' || confirm?.selfie ? ', after a selfie' : ''}. Your location is recorded with it.</>}
        </p>
        {confirm?.type === 'out' && (
          <label className="mt-3 block text-xs text-tertiary-500">Why are you stepping away? (optional)
            <select className="mt-1 block w-full rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm text-tertiary-900" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Done for the day / not specified</option>
              {Object.entries(REASON).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
      </Modal>
      {showHistory && <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Planned</th><th className="px-3 py-2">First in</th><th className="px-3 py-2">Last out</th><th className="px-3 py-2">Late</th><th className="px-3 py-2">Out of desk</th><th className="px-3 py-2">Where</th></tr>
          </thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-tertiary-500">No check-ins in the last 14 days</td></tr>}
            {history.map((r) => (
              <tr key={r.id} className="border-t border-tertiary-100">
                <td className="px-3 py-2">{r.date}</td><td className="px-3 py-2">{PLACE[r.planned_place]}</td><td className="px-3 py-2">{clock(r.check_in_at)}</td><td className="px-3 py-2">{clock(r.check_out_at)}</td>
                <td className="px-3 py-2">{r.late_minutes > 0 ? hoursMinutes(r.late_minutes) : '—'}</td>
                <td className="px-3 py-2">{r.out_of_desk_minutes > 0 ? `${hoursMinutes(r.out_of_desk_minutes)} (${r.break_count}×)` : '—'}</td>
                <td className="px-3 py-2"><Pill result={r.check_in_result} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

/** Highlighted check-in card for the dashboard (Delphic Global, full-time employees); hidden for everyone else. */
export function DashboardCheckinCard() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const [eligible, setEligible] = useState(false);
  const isMaster = Boolean(user?.active_org?.is_master_workspace);
  useEffect(() => {
    if (!isMaster) return;
    apiClient.get('/location-checkin/today').then(({ data }) => setEligible(Boolean(data.data?.eligible))).catch(() => setEligible(false));
  }, [isMaster, user?.active_org?.id]);
  // The header button links to /#workplace-checkin; bring the card into view once it has rendered.
  useEffect(() => {
    if (eligible && hash === '#workplace-checkin') document.getElementById('workplace-checkin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [eligible, hash]);
  if (!isMaster || !eligible) return null;
  return (
    <section id="workplace-checkin" className="rounded-2xl border border-primary-200 bg-primary-50/40 p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><MapPin className="h-4 w-4 text-primary-600" aria-hidden="true" />Workplace check-in</h2>
      <MyCheckin showHistory={false} />
    </section>
  );
}

// Shown in the contractor portal, only when an admin has opened check-in to contractors.
export function LocationCheckinPortalCard() {
  const [eligible, setEligible] = useState(false);
  useEffect(() => {
    apiClient.get('/location-checkin/today').then(({ data }) => setEligible(Boolean(data.data?.eligible))).catch(() => setEligible(false));
  }, []);
  if (!eligible) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-tertiary-900">Workplace check-in</h2>
      <MyCheckin />
    </section>
  );
}

function Selfie({ path }) {
  const { pushError } = useAlerts();
  async function open() {
    try {
      const { data: blob } = await apiClient.get(`/location-checkin/${path}/selfie`, { responseType: 'blob' });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not open the selfie'), 'Not available');
    }
  }
  return <button type="button" className="text-primary-700 underline" onClick={open}>Selfie</button>;
}

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-tertiary-100 bg-white px-4 py-3 shadow-card">
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className={`text-xl font-semibold ${tone || 'text-tertiary-900'}`}>{value}</p>
    </div>
  );
}

// Admin: correct the in / out time of one check-in, or re-open it. A reason is required and goes to the audit log.
function EditSession({ session, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [v, setV] = useState({ in_at: toLocalInput(session.in_at), out_at: toLocalInput(session.out_at), out_reason: session.out_reason || '', reason: '' });
  const [busy, setBusy] = useState(false);
  const field = 'mt-1 block w-full rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm text-tertiary-900';
  async function save() {
    setBusy(true);
    try {
      // Only what was changed is sent: the inputs show minutes, so an untouched time must not be rewritten without its seconds.
      const body = { reason: v.reason };
      if (v.in_at !== toLocalInput(session.in_at)) body.in_at = fromLocalInput(v.in_at);
      if (v.out_at !== toLocalInput(session.out_at)) body.out_at = v.out_at ? fromLocalInput(v.out_at) : null;
      if (v.out_at && v.out_reason !== (session.out_reason || '')) body.out_reason = v.out_reason || null;
      await apiClient.patch(`/location-checkin/sessions/${session.id}`, body);
      pushSuccess('Check-in updated');
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not update'), 'Not saved');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Edit check-in" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || v.reason.trim().length < 3 || !v.in_at} onClick={save}>Save</button></>}>
      <div className="space-y-3">
        <label className="block text-xs text-tertiary-500">Check-in time<input type="datetime-local" className={field} value={v.in_at} onChange={(e) => setV({ ...v, in_at: e.target.value })} /></label>
        <label className="block text-xs text-tertiary-500">Check-out time <span className="text-tertiary-400">(clear it to mark the person as still at work)</span><input type="datetime-local" className={field} value={v.out_at} onChange={(e) => setV({ ...v, out_at: e.target.value })} /></label>
        {v.out_at && (
          <label className="block text-xs text-tertiary-500">Reason for stepping away
            <select className={field} value={v.out_reason} onChange={(e) => setV({ ...v, out_reason: e.target.value })}>
              <option value="">Not specified</option>
              {Object.entries(REASON).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs text-tertiary-500">Why are you changing it? *<textarea rows={2} className={field} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. Forgot to check out" /></label>
        <p className="text-xs text-tertiary-500">Times are India time. This is recorded in the audit log. Attendance and salary are not changed.</p>
      </div>
    </Modal>
  );
}

// Admin: remove one check-in or the whole day, with a reason.
function RemoveDialog({ target, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await apiClient.delete(target.day ? `/location-checkin/records/${target.id}` : `/location-checkin/sessions/${target.id}`, { data: { reason } });
      pushSuccess(target.day ? 'Day removed' : 'Check-in removed');
      onDone();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not remove'), 'Not removed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={target.day ? 'Remove this whole day?' : 'Remove this check-in?'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={remove}>Remove</button></>}>
      <p className="text-tertiary-700">{target.day ? 'Every check-in and check-out of this day is deleted, along with the selfies.' : 'This check-in is deleted. If it is the last one, the day is removed.'}</p>
      <label className="mt-3 block text-xs text-tertiary-500">Why are you removing it? *<textarea rows={2} className="mt-1 block w-full rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm text-tertiary-900" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </Modal>
  );
}

function ReportDetail({ r, canEdit, onEdit, onRemove }) {
  return (
    <div className="space-y-2 bg-tertiary-50/60 px-4 py-3 text-xs">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-tertiary-600">
        <span>Worked: <b className="text-tertiary-900">{hoursMinutes(r.worked_minutes)}</b></span>
        <span>Out of desk: <b className="text-tertiary-900">{hoursMinutes(r.out_of_desk_minutes)}</b> ({r.break_count} {r.break_count === 1 ? 'break' : 'breaks'}{r.longest_break_minutes ? `, longest ${hoursMinutes(r.longest_break_minutes)}` : ''})</span>
        {r.office && <span>Office: <b className="text-tertiary-900">{r.office}</b></span>}
      </div>
      <table className="min-w-full">
        <thead className="text-left uppercase text-tertiary-400"><tr><th className="py-1 pr-4">In</th><th className="py-1 pr-4">From</th><th className="py-1 pr-4">Out</th><th className="py-1 pr-4">From</th><th className="py-1 pr-4">Break reason</th><th className="py-1 pr-4" /></tr></thead>
        <tbody>
          {r.sessions.map((s) => (
            <tr key={s.id} className="border-t border-tertiary-100">
              <td className="py-1.5 pr-4 font-medium text-tertiary-900">{clock(s.in_at)}{s.edited && <span className="ml-1 font-normal text-tertiary-400">(edited)</span>}</td>
              <td className="py-1.5 pr-4"><Pill result={s.in_result} /></td>
              <td className="py-1.5 pr-4 font-medium text-tertiary-900">{s.out_at ? clock(s.out_at) : <span className="font-normal text-green-700">at work</span>}</td>
              <td className="py-1.5 pr-4">{s.out_result ? <Pill result={s.out_result} /> : '—'}</td>
              <td className="py-1.5 pr-4">{s.out_reason ? REASON[s.out_reason] : '—'}</td>
              <td className="py-1.5 pr-4"><span className="flex gap-3">
                {s.has_photo && <Selfie path={`sessions/${s.id}`} />}
                {canEdit && <button type="button" className="text-primary-700 underline" onClick={() => onEdit(s)}>Edit</button>}
                {canEdit && <button type="button" className="text-red-700 underline" onClick={() => onRemove({ id: s.id })}>Delete</button>}
              </span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && <button type="button" className="text-red-700 underline" onClick={() => onRemove({ id: r.id, day: true })}>Delete the whole day</button>}
    </div>
  );
}

function Report() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const canEdit = allowed(user, 'hr_settings.update', isAdminUser(user));
  const [f, setF] = useState({ from: daysAgoIso(6), to: todayIso(), org_membership_id: '', planned_place: '', attendance_status: '', late_only: false, outside_only: false, mismatch_only: false, no_checkin_only: false });
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const params = () => ({ ...f, org_membership_id: f.org_membership_id || undefined, planned_place: f.planned_place || undefined, attendance_status: f.attendance_status || undefined, late_only: f.late_only || undefined, outside_only: f.outside_only || undefined, mismatch_only: f.mismatch_only || undefined, no_checkin_only: f.no_checkin_only || undefined });

  const load = useCallback(async () => {
    try {
      const { data: res } = await apiClient.get('/location-checkin/report', { params: params() });
      setData(res.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load the report'), 'Something went wrong');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiClient.get('/location-checkin/people').then(({ data: r }) => setPeople(r.data || [])).catch(() => setPeople([])); }, []);

  async function download() {
    try {
      const { data: blob } = await apiClient.get('/location-checkin/report.csv', { params: params(), responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `location-checkin-${f.from}-to-${f.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not export'), 'Export failed');
    }
  }

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const field = 'rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm';
  const s = data?.summary;
  const rowKey = (r) => r.id || `${r.org_membership_id}-${r.date}`;
  const refresh = () => { setEditing(null); setRemoving(null); setOpen(null); load(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <label className="text-xs text-tertiary-500">From<input type="date" className={`${field} block`} value={f.from} onChange={set('from')} /></label>
        <label className="text-xs text-tertiary-500">To<input type="date" className={`${field} block`} value={f.to} onChange={set('to')} /></label>
        <label className="text-xs text-tertiary-500">Employee
          <select className={`${field} block`} value={f.org_membership_id} onChange={set('org_membership_id')}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.org_membership_id} value={p.org_membership_id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-tertiary-500">Planned
          <select className={`${field} block`} value={f.planned_place} onChange={set('planned_place')}>
            <option value="">Office and home</option><option value="office">Work from office</option><option value="home">Work from home</option>
          </select>
        </label>
        <label className="text-xs text-tertiary-500">Attendance status
          <select className={`${field} block`} value={f.attendance_status} onChange={set('attendance_status')}>
            <option value="">All</option>
            {Object.entries(ATTENDANCE).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.late_only} onChange={set('late_only')} /> Late only</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.outside_only} onChange={set('outside_only')} /> Outside office only</label>
        <label className="flex items-center gap-1 text-sm" title="Away from the office on an office day, at the office on a home day, or location unavailable on an office day"><input type="checkbox" checked={f.mismatch_only} onChange={set('mismatch_only')} /> Not as planned</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.no_checkin_only} onChange={set('no_checkin_only')} /> No check-in only</label>
        <button type="button" className="btn-secondary ml-auto inline-flex items-center gap-2" onClick={download}><Download className="h-4 w-4" /> CSV</button>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <Tile label="Check-ins" value={s.check_ins} />
          <Tile label="Late" value={s.late} tone={s.late ? 'text-red-700' : undefined} />
          <Tile label="Avg late" value={s.avg_late_minutes ? hoursMinutes(s.avg_late_minutes) : '—'} />
          <Tile label="Outside office" value={s.outside_office} tone={s.outside_office ? 'text-red-700' : undefined} />
          <Tile label="Not as planned" value={s.not_as_planned} tone={s.not_as_planned ? 'text-red-700' : undefined} />
          <Tile label="No check-in" value={s.no_checkin} tone={s.no_checkin ? 'text-amber-700' : undefined} />
          {s.location_unavailable > 0 && <Tile label="No location" value={s.location_unavailable} tone="text-amber-700" />}
          <Tile label="Office day, away" value={s.office_day_outside} tone={s.office_day_outside ? 'text-red-700' : undefined} />
          <Tile label="Home day, at office" value={s.home_day_at_office} />
          <Tile label="Leave, but checked in" value={s.leave_but_checked_in} tone={s.leave_but_checked_in ? 'text-amber-700' : undefined} />
          <Tile label="Avg out of desk" value={s.avg_out_of_desk_minutes ? hoursMinutes(s.avg_out_of_desk_minutes) : '—'} />
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Attendance</th><th className="px-3 py-2">Planned</th><th className="px-3 py-2">First in</th><th className="px-3 py-2">Last out</th><th className="px-3 py-2">Late</th><th className="px-3 py-2">Out of desk</th><th className="px-3 py-2">Checked in from</th><th className="px-3 py-2">Distance</th><th className="px-3 py-2">Planned vs actual</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {data && data.rows.length === 0 && <tr><td colSpan={12} className="px-3 py-4 text-center text-tertiary-500">No records match</td></tr>}
            {data?.rows.map((r) => (
              <Fragment key={rowKey(r)}>
                <tr className={`border-t border-tertiary-100 ${r.check_in_result === 'outside_office' ? 'bg-red-50/60' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.name}</span>{r.employee_code && <span className="ml-1 text-xs text-tertiary-500">{r.employee_code}</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.attendance_label || <span className="text-tertiary-400">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{PLACE[r.planned_place]}</td>
                  <td className="px-3 py-2">{r.id ? clock(r.check_in_at) : <span className="text-amber-700">—</span>}</td>
                  <td className="px-3 py-2">{r.id ? (r.currently_in ? <span className="text-green-700">at work</span> : clock(r.check_out_at)) : '—'}</td>
                  <td className="px-3 py-2">{r.late_minutes > 0 ? <span className="font-medium text-red-700">{hoursMinutes(r.late_minutes)}</span> : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.out_of_desk_minutes > 0 ? `${hoursMinutes(r.out_of_desk_minutes)} (${r.break_count}×)` : '—'}</td>
                  <td className="px-3 py-2">{r.id ? <Pill result={r.check_in_result} /> : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.check_in_distance_m != null ? `${r.check_in_distance_m} m` : '—'}
                    {r.check_in_lat != null && <a className="ml-2 inline-flex text-primary-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.check_in_lat},${r.check_in_lng}`} title="Open on map"><MapPin className="h-4 w-4" /></a>}
                  </td>
                  <td className={`px-3 py-2 ${COMPARISON[r.comparison]?.cls || ''}`}>
                    {COMPARISON[r.comparison]?.label || r.comparison}
                    {r.flags?.includes('leave_but_checked_in') && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Leave, but checked in</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.id && <button type="button" className="text-primary-700 underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : `Details (${r.sessions.length})`}</button>}</td>
                </tr>
                {open === r.id && <tr><td colSpan={12} className="p-0"><ReportDetail r={r} canEdit={canEdit} onEdit={setEditing} onRemove={setRemoving} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {data?.people?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <p className="px-3 pt-3 text-sm font-medium text-tertiary-900">By person</p>
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Check-in days</th><th className="px-3 py-2">Late days</th><th className="px-3 py-2">Avg late</th><th className="px-3 py-2">Outside office days</th><th className="px-3 py-2">No check-in days</th><th className="px-3 py-2">Avg out of desk</th></tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.org_membership_id} className="border-t border-tertiary-100"><td className="px-3 py-2">{p.name}</td><td className="px-3 py-2">{p.days}</td><td className="px-3 py-2">{p.late_days}</td><td className="px-3 py-2">{p.avg_late_minutes ? hoursMinutes(p.avg_late_minutes) : '—'}</td><td className="px-3 py-2">{p.outside_days}</td><td className="px-3 py-2">{p.no_checkin_days || '—'}</td><td className="px-3 py-2">{p.avg_out_of_desk_minutes ? hoursMinutes(p.avg_out_of_desk_minutes) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EditSession session={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {removing && <RemoveDialog target={removing} onClose={() => setRemoving(null)} onDone={refresh} />}
    </div>
  );
}

// ---------------------------------------------------------------- register: everyone x every day
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// What a register cell shows: where the person checked in, or what attendance says on a day with no check-in.
function cellLook(c) {
  if (c.state === 'checked_in') {
    const look = {
      in_office: { text: 'O', cls: 'bg-green-100 text-green-800' },
      work_from_home: { text: 'WFH', cls: 'bg-blue-100 text-blue-800' },
      outside_office: { text: 'AW', cls: 'bg-red-100 text-red-800' },
      location_unavailable: { text: '?', cls: 'bg-amber-100 text-amber-800' },
    }[c.checkin.result] || { text: '•', cls: 'bg-tertiary-100 text-tertiary-700' };
    return { ...look, cls: `${look.cls} ${c.checkin.late_minutes > 0 ? 'ring-2 ring-inset ring-red-500' : ''}` };
  }
  if (c.state === 'missing') return { text: 'M', cls: 'bg-red-50 font-bold text-red-700 ring-1 ring-inset ring-red-300' };
  if (c.state === 'leave') return { text: c.attendance_code, cls: 'bg-blue-50 text-blue-700' };
  if (c.state === 'off') return { text: c.attendance_code, cls: 'bg-tertiary-100 text-tertiary-400' };
  return { text: '', cls: '' };
}

function dayTitle(p, c) {
  const head = `${p.name}, ${c.date}`;
  if (c.state === 'checked_in') return `${head}: in ${clock(c.checkin.first_in)}${c.checkin.currently_in ? ', at work' : `, out ${clock(c.checkin.last_out)}`}${c.checkin.late_minutes > 0 ? `, ${hoursMinutes(c.checkin.late_minutes)} late` : ''}${c.checkin.out_of_desk_minutes > 0 ? `, ${hoursMinutes(c.checkin.out_of_desk_minutes)} out of desk` : ''}`;
  if (c.state === 'missing') return `${head}: no check-in on a working day`;
  return `${head}: ${c.attendance_label || c.attendance_code || ''}`;
}

function DayDetail({ person, cell, onClose }) {
  const c = cell.checkin;
  return (
    <Modal open title={`${person.name} · ${cell.date}`} onClose={onClose} wide footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-tertiary-600">
          <span>Attendance: <b className="text-tertiary-900">{cell.attendance_label || ATTENDANCE_BY_CODE[cell.attendance_code] || cell.attendance_code || '—'}</b></span>
          {c && <span>Planned: <b className="text-tertiary-900">{PLACE[c.planned_place]}</b></span>}
          {c && <span>Worked: <b className="text-tertiary-900">{hoursMinutes(c.worked_minutes)}</b></span>}
          {c && <span>Out of desk: <b className="text-tertiary-900">{hoursMinutes(c.out_of_desk_minutes)}</b> ({c.break_count} {c.break_count === 1 ? 'break' : 'breaks'})</span>}
          {c?.late_minutes > 0 && <span className="font-medium text-red-700">{hoursMinutes(c.late_minutes)} late</span>}
        </div>
        {!c && <p className="rounded-lg bg-tertiary-50 px-3 py-2 text-tertiary-700">{cell.state === 'missing' ? 'No check-in on a working day.' : 'Nothing recorded for this day.'}</p>}
        {c && (
          <table className="min-w-full text-xs">
            <thead className="text-left uppercase text-tertiary-400"><tr><th className="py-1 pr-3">In</th><th className="py-1 pr-3">From</th><th className="py-1 pr-3">Out</th><th className="py-1 pr-3">From</th><th className="py-1 pr-3">Reason</th></tr></thead>
            <tbody>
              {c.sessions.map((s) => (
                <tr key={s.id} className="border-t border-tertiary-100">
                  <td className="py-1.5 pr-3 font-medium text-tertiary-900">{clock(s.in_at)}</td>
                  <td className="py-1.5 pr-3"><Pill result={s.in_result} /></td>
                  <td className="py-1.5 pr-3 font-medium text-tertiary-900">{s.out_at ? clock(s.out_at) : <span className="font-normal text-green-700">at work</span>}</td>
                  <td className="py-1.5 pr-3">{s.out_result ? <Pill result={s.out_result} /> : '—'}</td>
                  <td className="py-1.5 pr-3">{s.out_reason ? REASON[s.out_reason] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cell.flags.includes('leave_but_checked_in') && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">This person is on leave but checked in.</p>}
        <p className="text-xs text-tertiary-500">To correct or delete an entry, open this day in the Report tab.</p>
      </div>
    </Modal>
  );
}
const ATTENDANCE_BY_CODE = { P: 'Present', WFH: 'Work from home', HD: 'Half day', A: 'Absent', H: 'Holiday', WO: 'Weekly off' };

function RegisterView() {
  const { pushError } = useAlerts();
  const now = todayIso();
  const [ym, setYm] = useState({ year: Number(now.slice(0, 4)), month: Number(now.slice(5, 7)) });
  const [mode, setMode] = useState('grid');
  const [day, setDay] = useState(now);
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    setData(null);
    apiClient.get('/location-checkin/register', { params: ym })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Could not load the register'), 'Something went wrong'));
  }, [ym, pushError]);

  const shift = (delta) => setYm(({ year, month }) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });
  const inMonth = (date) => date.slice(0, 7) === `${ym.year}-${pad(ym.month)}`;
  const shownDay = inMonth(day) ? day : `${ym.year}-${pad(ym.month)}-01`;
  const q = search.trim().toLowerCase();
  const people = (data?.people || []).filter((p) => (!q || p.name.toLowerCase().includes(q) || (p.employee_code || '').toLowerCase().includes(q)) && (!missingOnly || (mode === 'grid' ? p.totals.missing > 0 : p.days.find((d) => d.date === shownDay)?.state === 'missing')));
  const field = 'rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm';
  const years = [ym.year - 1, ym.year, ym.year + 1];
  const dayCells = people.map((p) => ({ p, c: p.days.find((d) => d.date === shownDay) })).filter((x) => x.c);
  const count = (state) => dayCells.filter((x) => x.c.state === state).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <button type="button" className="btn-secondary px-3" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
        <label className="text-xs text-tertiary-500">Month
          <select className={`${field} block`} value={ym.month} onChange={(e) => setYm({ ...ym, month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </label>
        <label className="text-xs text-tertiary-500">Year
          <select className={`${field} block`} value={ym.year} onChange={(e) => setYm({ ...ym, year: Number(e.target.value) })}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
        <button type="button" className="btn-secondary px-3" aria-label="Next month" onClick={() => shift(1)}>›</button>
        <div className="flex gap-1">
          {[['grid', 'Month grid'], ['day', 'One day']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === k ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-100' : 'text-tertiary-500 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
        {mode === 'day' && <label className="text-xs text-tertiary-500">Date<input type="date" className={`${field} block`} value={shownDay} min={`${ym.year}-${pad(ym.month)}-01`} max={data?.days?.[data.days.length - 1]?.date} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>}
        <label className="text-xs text-tertiary-500">Search<input className={`${field} block`} placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only</label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tertiary-600">
        <span><b className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">O</b> in office</span>
        <span><b className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">WFH</b> home</span>
        <span><b className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">AW</b> away from office</span>
        <span><b className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">?</b> location unavailable</span>
        <span><b className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 ring-1 ring-red-300">M</b> missing (working day, no check-in)</span>
        <span><b className="rounded bg-green-100 px-1.5 py-0.5 text-green-800 ring-2 ring-red-500">O</b> red ring = late</span>
        <span><b className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">CL</b> leave</span>
        <span><b className="rounded bg-tertiary-100 px-1.5 py-0.5 text-tertiary-500">WO</b> weekly off / <b className="rounded bg-tertiary-100 px-1.5 py-0.5 text-tertiary-500">H</b> holiday</span>
      </div>
      {!data && <p className="text-sm text-tertiary-500">Loading…</p>}
      {data && mode === 'grid' && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-xs">
            <thead className="bg-tertiary-50 text-tertiary-500">
              <tr>
                <th className="sticky left-0 z-10 bg-tertiary-50 px-3 py-2 text-left">Employee · {MONTHS[ym.month - 1]} {ym.year}</th>
                {data.days.map((d) => <th key={d.date} className={`px-0.5 py-1 text-center font-medium ${d.date === data.today ? 'text-primary-700' : ''}`}><div>{Number(d.date.slice(8))}</div><div className="font-normal text-tertiary-400">{WEEKDAY[d.weekday]}</div></th>)}
                <th className="px-2 text-center">Checked in</th><th className="px-2 text-center">Late</th><th className="px-2 text-center text-red-700">Missing</th><th className="px-2 text-center">Away</th><th className="px-2 text-center">No location</th><th className="px-2 text-center">Avg out of desk</th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 && <tr><td colSpan={data.days.length + 7} className="px-3 py-4 text-center text-tertiary-500">No employees match</td></tr>}
              {people.map((p) => (
                <tr key={p.org_membership_id} className="border-t border-tertiary-100">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5"><span className="font-medium text-tertiary-900">{p.name}</span>{p.employee_code && <span className="block text-[10px] text-tertiary-400">{p.employee_code}</span>}</td>
                  {p.days.map((c) => {
                    const look = cellLook(c);
                    return (
                      <td key={c.date} className="p-0.5 text-center">
                        {look.text ? <button type="button" title={dayTitle(p, c)} onClick={() => setDetail({ p, c })} className={`block h-7 min-w-[26px] w-full rounded px-0.5 text-[11px] font-semibold ${look.cls}`}>{look.text}</button> : <span className="block h-7" />}
                      </td>
                    );
                  })}
                  <td className="px-2 text-center font-medium">{p.totals.checked_in}</td>
                  <td className={`px-2 text-center ${p.totals.late ? 'font-medium text-red-700' : ''}`}>{p.totals.late}</td>
                  <td className={`px-2 text-center ${p.totals.missing ? 'font-semibold text-red-700' : ''}`}>{p.totals.missing}</td>
                  <td className="px-2 text-center">{p.totals.away}</td>
                  <td className="px-2 text-center">{p.totals.no_location}</td>
                  <td className="whitespace-nowrap px-2 text-center">{p.totals.out_of_desk_minutes ? hoursMinutes(Math.round(p.totals.out_of_desk_minutes / Math.max(1, p.totals.checked_in))) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && mode === 'day' && (
        <div className="space-y-2">
          <p className="text-sm text-tertiary-600"><b className="text-tertiary-900">{count('checked_in')}</b> checked in · <b className={count('missing') ? 'text-red-700' : 'text-tertiary-900'}>{count('missing')}</b> missing · <b className="text-tertiary-900">{count('leave')}</b> on leave · <b className="text-tertiary-900">{count('off')}</b> weekly off / holiday</p>
          <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
            <table className="min-w-full text-sm">
              <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
                <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Attendance</th><th className="px-3 py-2">Planned</th><th className="px-3 py-2">First in</th><th className="px-3 py-2">Last out</th><th className="px-3 py-2">Late</th><th className="px-3 py-2">Out of desk</th><th className="px-3 py-2">Entries</th><th className="px-3 py-2">Checked in from</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {dayCells.length === 0 && <tr><td colSpan={10} className="px-3 py-4 text-center text-tertiary-500">No employees match</td></tr>}
                {dayCells.map(({ p, c }) => (
                  <tr key={p.org_membership_id} className={`border-t border-tertiary-100 ${c.state === 'missing' ? 'bg-red-50/60' : ''}`}>
                    <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{p.name}</span>{p.employee_code && <span className="ml-1 text-xs text-tertiary-500">{p.employee_code}</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.attendance_label || ATTENDANCE_BY_CODE[c.attendance_code] || c.attendance_code || <span className="text-tertiary-400">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.checkin ? PLACE[c.checkin.planned_place] : c.attendance_code === 'WFH' ? PLACE.home : '—'}</td>
                    <td className="px-3 py-2">{c.checkin ? clock(c.checkin.first_in) : '—'}</td>
                    <td className="px-3 py-2">{c.checkin ? (c.checkin.currently_in ? <span className="text-green-700">at work</span> : clock(c.checkin.last_out)) : '—'}</td>
                    <td className="px-3 py-2">{c.checkin?.late_minutes > 0 ? <span className="font-medium text-red-700">{hoursMinutes(c.checkin.late_minutes)}</span> : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.checkin?.out_of_desk_minutes > 0 ? `${hoursMinutes(c.checkin.out_of_desk_minutes)} (${c.checkin.break_count}×)` : '—'}</td>
                    <td className="px-3 py-2">{c.checkin ? c.checkin.sessions.length : '—'}</td>
                    <td className="px-3 py-2">{c.checkin ? <Pill result={c.checkin.result} /> : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.state === 'missing' && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Missing</span>}
                      {c.state === 'not_yet' && <span className="text-tertiary-500">Not yet (before late-after time)</span>}
                      {c.state === 'checked_in' && <button type="button" className="text-primary-700 underline" onClick={() => setDetail({ p, c })}>Entries</button>}
                      {c.state === 'leave' && <span className="text-blue-700">On leave</span>}
                      {c.state === 'off' && <span className="text-tertiary-500">{c.attendance_code === 'H' ? 'Holiday' : 'Weekly off'}</span>}
                      {c.flags.includes('leave_but_checked_in') && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Leave, but checked in</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {detail && <DayDetail person={detail.p} cell={detail.c} onClose={() => setDetail(null)} />}
    </div>
  );
}

function OfficeRow({ office, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [v, setV] = useState({ latitude: office.latitude ?? '', longitude: office.longitude ?? '', radius_m: office.radius_m });
  const field = 'w-28 rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm';

  function useHere() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setV((s) => ({ ...s, latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) })),
      () => pushError('Could not read your location', 'No location'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }
  async function save() {
    try {
      await apiClient.put(`/location-checkin/offices/${office.location_id}`, { latitude: Number(v.latitude), longitude: Number(v.longitude), radius_m: Number(v.radius_m) });
      pushSuccess(`${office.name} saved`);
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the office'), 'Not saved');
    }
  }
  return (
    <tr className="border-t border-tertiary-100">
      <td className="px-3 py-2 font-medium text-tertiary-900">{office.name}{office.city ? <span className="ml-1 text-xs text-tertiary-500">{office.city}</span> : null}<span className="ml-2 text-xs font-normal text-tertiary-500">{office.employees} {office.employees === 1 ? 'employee' : 'employees'}</span></td>
      <td className="px-3 py-2"><input className={field} value={v.latitude} onChange={(e) => setV({ ...v, latitude: e.target.value })} placeholder="22.7196" /></td>
      <td className="px-3 py-2"><input className={field} value={v.longitude} onChange={(e) => setV({ ...v, longitude: e.target.value })} placeholder="75.8577" /></td>
      <td className="px-3 py-2"><input type="number" className="w-20 rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm" value={v.radius_m} onChange={(e) => setV({ ...v, radius_m: e.target.value })} /></td>
      <td className="px-3 py-2"><span className="flex gap-2"><button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={useHere}>Use my location</button><button type="button" className="btn-primary px-3 py-1 text-xs" disabled={v.latitude === '' || v.longitude === ''} onClick={save}>Save</button></span></td>
    </tr>
  );
}

function Settings() {
  const { pushError, pushSuccess } = useAlerts();
  const [settings, setSettings] = useState(null);
  const [offices, setOffices] = useState([]);
  const [shifts, setShifts] = useState([]);
  const load = useCallback(async () => {
    try {
      const [s, o, sh] = await Promise.all([apiClient.get('/location-checkin/settings'), apiClient.get('/location-checkin/offices'), apiClient.get('/location-checkin/shifts')]);
      setSettings(s.data.data);
      setOffices(o.data.data || []);
      setShifts(sh.data.data || []);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not load the settings'), 'Something went wrong');
    }
  }, [pushError]);
  useEffect(() => { load(); }, [load]);

  async function save(patch) {
    try {
      const { data } = await apiClient.put('/location-checkin/settings', patch);
      setSettings(data.data);
      pushSuccess('Saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Not saved');
    }
  }
  async function saveShift(shift, minutes) {
    try {
      await apiClient.put(`/location-checkin/shifts/${shift.shift_id}`, { late_after_minutes: minutes });
      pushSuccess(minutes == null ? `${shift.name} follows its shift time again` : `${shift.name} saved`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the shift'), 'Not saved');
    }
  }
  if (!settings) return <p className="text-sm text-tertiary-500">Loading…</p>;
  const field = 'rounded-lg border border-tertiary-200 px-2 py-1.5 text-sm';
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <label className="block text-sm text-tertiary-700">Selfie at check-in
          <select className={`${field} ml-2`} value={settings.selfie_mode} onChange={(e) => save({ selfie_mode: e.target.value })}>
            <option value="required">Required (cannot check in without one)</option>
            <option value="optional">Optional (employee chooses)</option>
            <option value="off">Off (no selfie)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.full_time_only} onChange={(e) => save({ full_time_only: e.target.checked })} /> Full-time employees only <span className="text-xs text-tertiary-500">(untick to let contractors check in too)</span></label>
        <label className="block text-sm text-tertiary-700">Late time for people with no shift
          <input type="time" className={`${field} ml-2`} defaultValue={minutesToTime(settings.default_cutoff_minutes)} onBlur={(e) => e.target.value && save({ default_cutoff_minutes: timeToMinutes(e.target.value) })} />
        </label>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <p className="px-3 pt-3 text-sm font-medium text-tertiary-900">Late time by shift</p>
        <p className="px-3 text-xs text-tertiary-500">A person is late once they check in after this time. Leave it as the shift time, or set your own. This does not change the shift or attendance.</p>
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Shift</th><th className="px-3 py-2">Starts (+ grace)</th><th className="px-3 py-2">Late after</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {shifts.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center text-tertiary-500">No shifts yet. Add them in HR settings.</td></tr>}
            {shifts.map((s) => (
              <tr key={`${s.shift_id}-${s.late_after_minutes}`} className="border-t border-tertiary-100">
                <td className="px-3 py-2 font-medium text-tertiary-900">{s.name}</td>
                <td className="px-3 py-2">{minutesToTime(s.start_minutes)} (+{s.grace_minutes} min)</td>
                <td className="px-3 py-2"><input type="time" className={field} defaultValue={minutesToTime(s.late_after_minutes ?? s.default_late_after_minutes)} onBlur={(e) => e.target.value && timeToMinutes(e.target.value) !== (s.late_after_minutes ?? s.default_late_after_minutes) && saveShift(s, timeToMinutes(e.target.value))} /></td>
                <td className="px-3 py-2 text-xs">{s.late_after_minutes == null ? <span className="text-tertiary-500">Shift time</span> : <button type="button" className="text-primary-700 underline" onClick={() => saveShift(s, null)}>Use shift time</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {offices.some((o) => o.employees > 0 && !o.configured) && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Set a map point for {offices.filter((o) => o.employees > 0 && !o.configured).map((o) => o.name).join(', ')}. Until then, check-ins from these offices are saved as “Location unavailable” and nobody can be marked in or outside the office.
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <p className="px-3 pt-3 text-sm font-medium text-tertiary-900">Office map points</p>
        <p className="px-3 text-xs text-tertiary-500">Stand at the office and press “Use my location”, or type the coordinates. The radius is how far from that point still counts as in the office.</p>
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Office</th><th className="px-3 py-2">Latitude</th><th className="px-3 py-2">Longitude</th><th className="px-3 py-2">Radius (m)</th><th className="px-3 py-2" /></tr></thead>
          <tbody>{offices.map((o) => <OfficeRow key={`${o.location_id}-${o.latitude}-${o.longitude}-${o.radius_m}`} office={o} onSaved={load} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function LocationCheckinTab() {
  const { user } = useAuth();
  const isAdmin = isAdminUser(user);
  const canReport = allowed(user, 'location_checkin.view', isAdmin);
  const canSettings = allowed(user, 'hr_settings.update', isAdmin);
  const views = [['mine', 'My check-in'], ...(canReport ? [['register', 'Register'], ['report', 'Report']] : []), ...(canSettings ? [['settings', 'Settings']] : [])];
  const [view, setView] = useState('mine');
  return (
    <div className="space-y-4">
      <p className="text-xs text-tertiary-500">Workplace check-in is a separate record of where people check in from. It does not change attendance, leave or salary.</p>
      {views.length > 1 && (
        <div className="flex gap-1">
          {views.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === key ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-100' : 'text-tertiary-500 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
      )}
      {view === 'mine' && <MyCheckin />}
      {view === 'register' && canReport && <RegisterView />}
      {view === 'report' && canReport && <Report />}
      {view === 'settings' && canSettings && <Settings />}
    </div>
  );
}
