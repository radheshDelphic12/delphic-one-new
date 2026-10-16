import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CalendarCheck, ChevronLeft, ChevronRight, Home, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_LABEL = { present: 'Present', absent: 'Absent', half_day: 'Half day', holiday: 'Holiday', wfh: 'WFH', leave: 'Leave' };
const STATUS_TONE = {
  present: 'bg-green-50 text-green-700',
  wfh: 'bg-green-50 text-green-700',
  half_day: 'bg-amber-50 text-amber-700',
  absent: 'bg-red-50 text-red-700',
  leave: 'bg-blue-50 text-blue-700',
  holiday: 'bg-tertiary-100 text-tertiary-600',
};
const PLACE_LABEL = { office: 'Work from office', home: 'Work from home' };

const num = (n) => (n === null || n === undefined ? '∞' : Number(n));
const dayStatus = (day) => {
  if (day.attendance_status === 'leave') return day.leaves?.length ? day.leaves.map((l) => `${l.name}${l.is_half_day ? ' (half)' : ''}`).join(', ') : 'Leave';
  if (day.attendance_status) return STATUS_LABEL[day.attendance_status] || day.attendance_status;
  if (day.leaves?.length) return day.leaves.map((l) => l.name).join(', ');
  if (day.day_type !== 'working') return day.day_label || 'Off';
  return null;
};

function PlaceBadge({ day }) {
  const Icon = day.work_place === 'home' ? Home : Building2;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-tertiary-600" title={PLACE_LABEL[day.work_place]}>
      <Icon className="h-3 w-3" /> {day.work_place === 'home' ? 'WFH' : 'WFO'}
      {day.requested_place && <span className="rounded bg-amber-50 px-1 text-amber-700">{day.requested_place === 'home' ? 'WFH' : 'WFO'} {day.place_status}</span>}
    </span>
  );
}

function DayCell({ day, selected, onSelect }) {
  const label = dayStatus(day);
  const off = day.day_type !== 'working';
  return (
    <button type="button" onClick={() => onSelect(day)} className={`flex min-h-[96px] flex-col gap-1 rounded-xl border p-2 text-left text-xs transition ${selected ? 'border-primary-500 ring-1 ring-primary-300' : 'border-tertiary-100 hover:border-primary-300'} ${off ? 'bg-tertiary-50/60' : 'bg-white'}`}>
      <span className="font-semibold text-tertiary-800">{Number(day.date.slice(8))}</span>
      {label && <span className={`rounded-md px-1.5 py-0.5 font-medium ${STATUS_TONE[day.attendance_status] || (day.leaves?.length ? STATUS_TONE.leave : STATUS_TONE.holiday)}`}>{label}</span>}
      {day.pending_leaves?.map((l) => <span key={l.request_id} className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700">{l.name} (pending)</span>)}
      {day.attendance_status && day.attendance_status !== 'holiday' && day.attendance_status !== 'absent' && (
        <>
          <PlaceBadge day={day} />
          {day.reporting_office && <span className="truncate text-[11px] text-tertiary-500">{day.reporting_office.name}</span>}
        </>
      )}
    </button>
  );
}

function LeaveBalance({ rows }) {
  const shown = rows.filter((r) => !r.unlimited || r.taken > 0 || r.pending > 0);
  if (!shown.length) return <p className="text-xs text-tertiary-400">No capped leave types.</p>;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-tertiary-500"><th className="py-1">Leave</th><th className="text-right">Start</th><th className="text-right">Applied</th><th className="text-right">End</th></tr></thead>
      <tbody className="divide-y divide-tertiary-100">
        {shown.map((r) => (
          <tr key={r.leave_type_id}>
            <td className="py-1">{r.leave_type_name}</td>
            <td className="text-right tabular-nums">{num(r.opening)}</td>
            <td className="text-right tabular-nums">{r.taken}{r.pending ? ` (+${r.pending} pending)` : ''}</td>
            <td className="text-right tabular-nums">{num(r.closing)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayPanel({ day, member, canAct, onApply }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [day?.date]);
  if (!day) return <p className="rounded-2xl border border-dashed border-tertiary-200 p-4 text-sm text-tertiary-500">Select a day to see its details.</p>;
  const remote = day.work_type === 'remote';
  const other = day.work_place === 'home' ? 'office' : 'home';
  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-heading font-semibold text-tertiary-900">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-tertiary-600">
        <dt>Present</dt><dd className="text-tertiary-900">{dayStatus(day) || 'Not marked'}{day.attendance_conflict ? ' · approved leave also exists - needs review' : ''}</dd>
        <dt>Reporting office</dt><dd className="text-tertiary-900">{day.reporting_office?.name || 'Not set'}</dd>
        <dt>Work type</dt><dd className="text-tertiary-900">{remote ? 'Remote' : 'Onsite'}</dd>
        <dt>Today at</dt><dd className="text-tertiary-900">{PLACE_LABEL[day.work_place]}{day.place_is_default && !day.requested_place ? ' (default)' : ''}</dd>
        {day.requested_place && <><dt>Request</dt><dd className="text-tertiary-900">{PLACE_LABEL[day.requested_place]} · {day.place_status}{day.place_decision_reason ? ` · ${day.place_decision_reason}` : ''}</dd></>}
        {day.attendance_note && <><dt>Note</dt><dd className="text-tertiary-900">{day.attendance_note}</dd></>}
      </dl>
      {canAct && !remote && day.day_type === 'working' && (
        <div className="space-y-1 rounded-xl bg-tertiary-50 p-2">
          <input className="w-full rounded-lg border px-2 py-1 text-xs" placeholder="Reason (optional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn-secondary w-full text-xs" onClick={() => onApply(day.date, other, reason, member.org_membership_id)}>
            {other === 'home' ? 'Apply work from home' : 'Switch to work from office'} for this day
          </button>
        </div>
      )}
      {remote && <p className="text-xs text-tertiary-500">Remote employees work from home by default.</p>}
    </div>
  );
}

function PendingPlaces({ onDecided }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState([]);
  const load = useCallback(() => apiClient.get('/attendance-dashboard/place/pending').then(({ data }) => setRows(data.data || [])).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (!rows.length) return null;
  const decide = async (row, approve) => {
    try {
      await apiClient.post(`/attendance-dashboard/place/${row.id}/decide`, { approve });
      pushSuccess(approve ? 'Approved' : 'Rejected');
      load();
      onDecided();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not save the decision'), 'Something went wrong'); }
  };
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3">
      <h4 className="text-sm font-semibold text-tertiary-900">Work from home / office requests to approve ({rows.length})</h4>
      <ul className="mt-2 space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2 py-1">
            <span><b>{r.name}</b> · {r.date} · {PLACE_LABEL[r.work_place]}{r.reason ? ` · ${r.reason}` : ''}</span>
            <span className="flex gap-1"><button type="button" className="btn-primary text-xs" onClick={() => decide(r, true)}>Approve</button><button type="button" className="btn-secondary text-xs" onClick={() => decide(r, false)}>Reject</button></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OfficeChanger({ member, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [offices, setOffices] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [from, setFrom] = useState('');
  useEffect(() => { apiClient.get('/orgs/locations').then(({ data }) => setOffices(data.data || [])).catch(() => setOffices([])); }, []);
  const save = async () => {
    try {
      await apiClient.post('/attendance-dashboard/offices', { org_membership_id: member.org_membership_id, location_id: locationId, effective_from: from });
      pushSuccess(`Reporting office changed from ${from}`);
      onSaved();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not change the reporting office'), 'Something went wrong'); }
  };
  return (
    <div className="space-y-1 rounded-xl bg-tertiary-50 p-2 text-xs">
      <p className="font-medium text-tertiary-700">Change reporting office (admin)</p>
      <select className="w-full rounded-lg border px-2 py-1" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        <option value="">Choose office</option>
        {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <label className="block text-tertiary-600">From<input type="date" className="mt-0.5 w-full rounded-lg border px-2 py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <button type="button" className="btn-secondary w-full" disabled={!locationId || !from} onClick={save}>Save office</button>
    </div>
  );
}

/**
 * Attendance Dashboard: attendance only, for every IT and non-IT employee (no contractors). One person's month as a
 * calendar with the day's status, reporting office and office / home; switch person and month without going back.
 */
export default function AttendanceDashboard() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const isAdmin = user?.role === 'admin';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [view, setView] = useState('person');
  const [list, setList] = useState(null);
  const [memberId, setMemberId] = useState(user?.org_membership_id || '');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    apiClient.get('/attendance-dashboard/people', { params: { year, month } })
      .then(({ data: res }) => {
        if (!alive) return;
        setList(res.data.people);
        if (!res.data.people.some((p) => p.org_membership_id === memberId) && res.data.people.length) setMemberId(res.data.people[0].org_membership_id);
      })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load employees'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, reloadKey]);

  useEffect(() => {
    if (!memberId) return undefined;
    let alive = true;
    setData(null);
    apiClient.get('/attendance-dashboard/calendar', { params: { year, month, org_membership_id: memberId } })
      .then(({ data: res }) => { if (alive) { setData(res.data); setSelected(null); } })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load attendance'), 'Something went wrong'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, memberId, reloadKey]);

  const step = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };
  const cells = useMemo(() => (data ? [...Array(data.days[0]?.weekday || 0).fill(null), ...data.days] : []), [data]);
  const canAct = Boolean(data) && (isAdmin || data.member.org_membership_id === user?.org_membership_id);

  async function apply(date, workPlace, reason, orgMembershipId) {
    try {
      const { data: res } = await apiClient.post('/attendance-dashboard/place', { org_membership_id: orgMembershipId, date, work_place: workPlace, ...(reason ? { reason } : {}) });
      pushSuccess(res.data.row?.status === 'approved' ? 'Saved' : res.data.reverted_to_default ? 'Back to the default' : 'Request sent for approval');
      refresh();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Something went wrong'); }
  }

  return (
    <div className="space-y-4">
      <div className="ta-head flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Attendance</p>
          <h2 className="mt-1 flex items-center gap-2 font-heading text-xl font-semibold text-tertiary-900"><CalendarCheck className="h-5 w-5" /> Attendance Dashboard</h2>
          <p className="mt-1 text-sm text-tertiary-500">Present, leave, reporting office and office / home for every employee. Contractors are not included.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" className="btn-ghost" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></button>
          <label className="text-xs font-medium text-tertiary-600">Month
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <button type="button" className="btn-ghost" aria-label="Next month" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></button>
          {list && list.length > 1 && (
            <label className="text-xs font-medium text-tertiary-600">Employee
              <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setView('person'); }} className="mt-1 block rounded-xl border px-3 py-2 text-sm">{list.map((p) => <option key={p.org_membership_id} value={p.org_membership_id}>{p.name}</option>)}</select>
            </label>
          )}
          {list && list.length > 1 && (
            <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => setView(view === 'all' ? 'person' : 'all')}><Users className="h-4 w-4" /> {view === 'all' ? 'One employee' : 'All employees'}</button>
          )}
        </div>
      </div>

      <PendingPlaces onDecided={refresh} />

      {view === 'all' ? (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-tertiary-500"><th className="p-3">Employee</th><th>Department</th><th>Reporting office</th><th>Work type</th><th className="text-right">Present</th><th className="text-right">WFH</th><th className="text-right">Half</th><th className="text-right">Leave</th><th className="pr-3 text-right">Absent</th></tr></thead>
            <tbody className="divide-y divide-tertiary-100">
              {(list || []).map((p) => (
                <tr key={p.org_membership_id} className="cursor-pointer hover:bg-tertiary-50" onClick={() => { setMemberId(p.org_membership_id); setView('person'); }}>
                  <td className="p-3 font-medium">{p.name}</td><td>{p.department || '—'}</td><td>{p.reporting_office || '—'}</td><td className="capitalize">{p.work_type}</td>
                  <td className="text-right tabular-nums">{p.counts.present || 0}</td><td className="text-right tabular-nums">{p.counts.wfh || 0}</td><td className="text-right tabular-nums">{p.counts.half_day || 0}</td><td className="text-right tabular-nums">{p.counts.leave || 0}</td><td className="pr-3 text-right tabular-nums">{p.counts.absent || 0}</td>
                </tr>
              ))}
              {list && !list.length && <tr><td className="p-4 text-tertiary-500" colSpan={9}>No employees</td></tr>}
            </tbody>
          </table>
        </div>
      ) : !data ? <p className="text-sm text-tertiary-500">Loading...</p> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_21rem]">
          <div>
            <h3 className="mb-2 font-heading text-base font-semibold text-tertiary-900">{data.member.name} · {MONTHS[month - 1]} {year}</h3>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-tertiary-500">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => (day ? <DayCell key={day.date} day={day} selected={selected?.date === day.date} onSelect={setSelected} /> : <span key={`pad-${i}`} />))}
            </div>
          </div>
          <aside className="space-y-4 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
            <DayPanel day={selected} member={data.member} canAct={canAct} onApply={apply} />
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Leave balance · {MONTHS[month - 1]}</h4>
              <LeaveBalance rows={data.leave_balances} />
            </div>
            {isAdmin && <OfficeChanger member={data.member} onSaved={refresh} />}
          </aside>
        </div>
      )}
    </div>
  );
}
