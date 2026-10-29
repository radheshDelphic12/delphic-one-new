import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Camera, Download, LogIn, LogOut, MapPin } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

// Location check-in (Delphic Global, full-time employees). Kept apart from Attendance: nothing here marks a day present or touches pay.
// My check-in (everyone), Report (HR / admin), Settings (admin).

const RESULT = {
  in_office: { label: 'In office', cls: 'bg-green-50 text-green-700' },
  outside_office: { label: 'Outside office', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  work_from_home: { label: 'Work from home', cls: 'bg-blue-50 text-blue-700' },
  location_unavailable: { label: 'Location unavailable', cls: 'bg-amber-50 text-amber-700' },
};
const COMPARISON = {
  as_planned: { label: 'As planned', cls: 'text-green-700' },
  office_day_outside: { label: 'Office day, checked in away from office', cls: 'font-semibold text-red-700' },
  home_day_at_office: { label: 'Home day, checked in at office', cls: 'text-amber-700' },
  no_location: { label: 'Office day, no location', cls: 'text-amber-700' },
  wfh_no_location: { label: 'Home day, no location', cls: 'text-tertiary-500' },
};
const PLACE = { office: 'Work from office', home: 'Work from home' };

const pad = (n) => String(n).padStart(2, '0');
const minutesToTime = (m) => (m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
const timeToMinutes = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};
// 211 -> "3h 31m", 45 -> "45m", 120 -> "2h"
const hoursMinutes = (m) => {
  const total = Math.round(Number(m) || 0);
  const h = Math.floor(total / 60);
  const r = total % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
};
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');
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

function MyCheckin({ showHistory = true }) {
  const { pushError, pushSuccess } = useAlerts();
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);

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

  async function send(path, selfie) {
    setBusy(true);
    try {
      const form = new FormData();
      const pos = await getPosition();
      if (pos) Object.entries(pos).forEach(([k, v]) => form.append(k, String(v)));
      if (selfie) form.append('selfie', selfie, 'selfie.jpg');
      const { data } = await apiClient.post(path, form);
      const r = data.data;
      pushSuccess(path.endsWith('check-in') ? `Checked in at ${clock(r.check_in_at)}` : `Checked out at ${clock(r.check_out_at)}`);
      if (!pos) pushError('Your location was not available, so this was saved without one.', 'No location');
      setCamera(false);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Not saved');
    } finally {
      setBusy(false);
    }
  }

  // Selfie mode (set by an admin): required opens the camera first; optional offers both ways; off checks in straight away.
  function startCheckIn() {
    if (today.selfie_mode === 'required') setCamera(true);
    else send('/location-checkin/check-in', null);
  }

  if (!today) return <p className="text-sm text-tertiary-500">Loading…</p>;
  if (!today.eligible) return <p className="rounded-xl bg-tertiary-50 px-4 py-3 text-sm text-tertiary-700">Workplace check-in is for full-time employees.</p>;
  const rec = today.record;
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
          {!rec && !camera && <button type="button" disabled={busy} className="btn-primary inline-flex items-center gap-2" onClick={startCheckIn}><LogIn className="h-4 w-4" /> Check in</button>}
          {!rec && !camera && today.selfie_mode === 'optional' && <button type="button" disabled={busy} className="btn-secondary inline-flex items-center gap-2" onClick={() => setCamera(true)}><Camera className="h-4 w-4" /> Check in with a selfie</button>}
          {rec && !rec.check_out_at && <button type="button" disabled={busy} className="btn-secondary inline-flex items-center gap-2" onClick={() => send('/location-checkin/check-out', null)}><LogOut className="h-4 w-4" /> Check out</button>}
          {busy && <span className="text-sm text-tertiary-500">Getting your location…</span>}
        </div>
        {rec && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>In <b>{clock(rec.check_in_at)}</b></span>
            <Pill result={rec.check_in_result} />
            {rec.late_minutes > 0 && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">{hoursMinutes(rec.late_minutes)} late</span>}
            {rec.check_out_at && <span>Out <b>{clock(rec.check_out_at)}</b></span>}
          </div>
        )}
      </div>
      {camera && <SelfieCapture onCancel={() => setCamera(false)} onCapture={(blob) => send('/location-checkin/check-in', blob)} />}
      {showHistory && <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Planned</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Late</th><th className="px-3 py-2">Where</th></tr>
          </thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-tertiary-500">No check-ins in the last 14 days</td></tr>}
            {history.map((r) => (
              <tr key={r.id} className="border-t border-tertiary-100">
                <td className="px-3 py-2">{r.date}</td><td className="px-3 py-2">{PLACE[r.planned_place]}</td><td className="px-3 py-2">{clock(r.check_in_at)}</td><td className="px-3 py-2">{clock(r.check_out_at)}</td>
                <td className="px-3 py-2">{r.late_minutes > 0 ? hoursMinutes(r.late_minutes) : '—'}</td><td className="px-3 py-2"><Pill result={r.check_in_result} /></td>
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

function Selfie({ id }) {
  const { pushError } = useAlerts();
  async function open() {
    try {
      const { data: blob } = await apiClient.get(`/location-checkin/records/${id}/selfie`, { responseType: 'blob' });
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

function Report() {
  const { pushError } = useAlerts();
  const [f, setF] = useState({ from: daysAgoIso(6), to: todayIso(), org_membership_id: '', planned_place: '', late_only: false, outside_only: false, mismatch_only: false });
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const params = () => ({ ...f, org_membership_id: f.org_membership_id || undefined, planned_place: f.planned_place || undefined, late_only: f.late_only || undefined, outside_only: f.outside_only || undefined, mismatch_only: f.mismatch_only || undefined });

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
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.late_only} onChange={set('late_only')} /> Late only</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.outside_only} onChange={set('outside_only')} /> Outside office only</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.mismatch_only} onChange={set('mismatch_only')} /> Not as planned</label>
        <button type="button" className="btn-secondary ml-auto inline-flex items-center gap-2" onClick={download}><Download className="h-4 w-4" /> CSV</button>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Check-ins" value={s.check_ins} />
          <Tile label="Late" value={s.late} tone={s.late ? 'text-red-700' : undefined} />
          <Tile label="Avg late" value={s.avg_late_minutes ? hoursMinutes(s.avg_late_minutes) : '—'} />
          <Tile label="Outside office" value={s.outside_office} tone={s.outside_office ? 'text-red-700' : undefined} />
          {s.location_unavailable > 0 && <Tile label="No location" value={s.location_unavailable} tone="text-amber-700" />}
          <Tile label="Office day, away" value={s.office_day_outside} tone={s.office_day_outside ? 'text-red-700' : undefined} />
          <Tile label="Home day, at office" value={s.home_day_at_office} />
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Planned</th><th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Late</th><th className="px-3 py-2">Checked in from</th><th className="px-3 py-2">Distance</th><th className="px-3 py-2">Planned vs actual</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {data && data.rows.length === 0 && <tr><td colSpan={10} className="px-3 py-4 text-center text-tertiary-500">No check-ins match</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.id} className={`border-t border-tertiary-100 ${r.check_in_result === 'outside_office' ? 'bg-red-50/60' : ''}`}>
                <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.name}</span>{r.employee_code && <span className="ml-1 text-xs text-tertiary-500">{r.employee_code}</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap">{PLACE[r.planned_place]}</td>
                <td className="px-3 py-2">{clock(r.check_in_at)}</td><td className="px-3 py-2">{clock(r.check_out_at)}</td>
                <td className="px-3 py-2">{r.late_minutes > 0 ? <span className="font-medium text-red-700">{hoursMinutes(r.late_minutes)}</span> : '—'}</td>
                <td className="px-3 py-2"><Pill result={r.check_in_result} /></td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.check_in_distance_m != null ? `${r.check_in_distance_m} m` : '—'}
                  {r.check_in_lat != null && <a className="ml-2 inline-flex text-primary-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.check_in_lat},${r.check_in_lng}`} title="Open on map"><MapPin className="h-4 w-4" /></a>}
                </td>
                <td className={`px-3 py-2 ${COMPARISON[r.comparison]?.cls || ''}`}>{COMPARISON[r.comparison]?.label || r.comparison}</td>
                <td className="px-3 py-2">{r.has_photo && <Selfie id={r.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.people?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <p className="px-3 pt-3 text-sm font-medium text-tertiary-900">Late arrivals by person</p>
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Check-in days</th><th className="px-3 py-2">Late days</th><th className="px-3 py-2">Avg late (min)</th><th className="px-3 py-2">Outside office days</th></tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.org_membership_id} className="border-t border-tertiary-100"><td className="px-3 py-2">{p.name}</td><td className="px-3 py-2">{p.days}</td><td className="px-3 py-2">{p.late_days}</td><td className="px-3 py-2">{p.avg_late_minutes ? hoursMinutes(p.avg_late_minutes) : '—'}</td><td className="px-3 py-2">{p.outside_days}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const views = [['mine', 'My check-in'], ...(canReport ? [['report', 'Report']] : []), ...(canSettings ? [['settings', 'Settings']] : [])];
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
      {view === 'report' && canReport && <Report />}
      {view === 'settings' && canSettings && <Settings />}
    </div>
  );
}
