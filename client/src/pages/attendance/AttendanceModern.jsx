import { CalendarCheck, CalendarClock, CalendarOff, CheckCircle2, Clock3, Home, PartyPopper, XCircle } from 'lucide-react';
import Skeleton from '../../components/ui/Skeleton.jsx';

// The employee's own Attendance screen: a greeting with today's status, a summary of the chosen period and the days as a
// clean list. Same colours and cards as the rest of the app. (The group superadmin keeps the original screen.)

const STATUS = {
  present: { label: 'Present', icon: CheckCircle2, pill: 'bg-green-50 text-green-700', tile: 'border-t-[#10B981]', iconBg: 'bg-[#ECFDF5] text-[#059669]' },
  absent: { label: 'Absent', icon: XCircle, pill: 'bg-red-50 text-red-700', tile: 'border-t-[#EF4444]', iconBg: 'bg-[#FEF2F2] text-[#DC2626]' },
  half_day: { label: 'Half day', icon: Clock3, pill: 'bg-amber-50 text-amber-700', tile: 'border-t-[#F59E0B]', iconBg: 'bg-[#FFFBEB] text-[#D97706]' },
  leave: { label: 'On leave', icon: CalendarOff, pill: 'bg-purple-50 text-purple-700', tile: 'border-t-[#8B5CF6]', iconBg: 'bg-[#F5F3FF] text-[#7C3AED]' },
  holiday: { label: 'Holiday', icon: PartyPopper, pill: 'bg-cyan-50 text-cyan-700', tile: 'border-t-[#06B6D4]', iconBg: 'bg-[#ECFEFF] text-[#0891B2]' },
  wfh: { label: 'Work from home', icon: Home, pill: 'bg-blue-50 text-blue-700', tile: 'border-t-[#3B82F6]', iconBg: 'bg-[#EFF6FF] text-[#2563EB]' },
};
const FALLBACK = { label: '', icon: CalendarClock, pill: 'bg-tertiary-100 text-tertiary-700', tile: 'border-t-tertiary-300', iconBg: 'bg-tertiary-100 text-tertiary-600' };
const metaOf = (status) => ({ ...FALLBACK, label: String(status || '').replace(/_/g, ' '), ...(STATUS[status] || {}) });
const SUMMARY = ['present', 'absent', 'leave', 'holiday', 'half_day', 'wfh'];

const dayKey = (row) => String(row.work_date || row.date || row.created_at || '').slice(0, 10);
const partsOf = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : { weekday: d.toLocaleDateString(undefined, { weekday: 'short' }), day: d.getDate(), month: d.toLocaleDateString(undefined, { month: 'short' }), year: d.getFullYear(), weekend: [0, 6].includes(d.getDay()) };
};
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** Counts per status and an attendance rate (present, work from home and half days count; leave and holidays do not hurt it). */
export function summarize(rows) {
  const counts = Object.fromEntries(SUMMARY.map((s) => [s, 0]));
  for (const r of rows) if (counts[r.status] !== undefined) counts[r.status] += 1;
  const worked = counts.present + counts.wfh + counts.half_day * 0.5;
  const expected = counts.present + counts.wfh + counts.half_day + counts.absent;
  return { counts, rate: expected ? Math.round((worked / expected) * 100) : null };
}

const RANGES = [
  ['This month', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; }],
  ['Last month', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; }],
  ['Last 30 days', () => { const n = new Date(); return [iso(new Date(n.getTime() - 30 * 86400000)), iso(n)]; }],
];

export function AttendanceHeader({ user, rows, from, to, status, setFrom, setTo, setStatus, statusOptions, tab, setTab, isAdmin }) {
  const today = iso(new Date());
  const todayRow = rows.find((r) => dayKey(r) === today);
  const todayMeta = todayRow ? metaOf(todayRow.status) : null;
  const first = String(user?.name || '').split(' ')[0];
  const activeRange = RANGES.find(([, get]) => { const [a, b] = get(); return a === from && b === to; })?.[0];
  const input = 'mt-1 block rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
  return (
    <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <div className="flex flex-col gap-4 bg-gradient-to-r from-primary-50 via-white to-white p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Time &amp; Attendance</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-tertiary-900">{greeting()}{first ? `, ${first}` : ''}</h2>
          <p className="mt-1 text-sm text-tertiary-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-tertiary-100 bg-white px-3 py-1.5 text-sm shadow-sm">
            <span className="text-tertiary-500">Today</span>
            {todayMeta ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${todayMeta.pill}`}><todayMeta.icon className="h-3.5 w-3.5" />{todayMeta.label}</span>
              : <span className="rounded-full bg-tertiary-100 px-2 py-0.5 text-xs font-semibold text-tertiary-600">Not marked yet</span>}
          </div>
        </div>
        <div className="max-w-md rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-3 text-xs leading-relaxed text-primary-900">
          <p className="font-semibold">Attendance is separate from project timesheets</p>
          <p className="mt-0.5 text-primary-800">It is marked automatically at your working-hour start time and records whether you were present, absent or on leave. Project hours are logged in the Timesheet.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-tertiary-100 px-5 py-3">
        <div className="inline-flex rounded-xl bg-tertiary-100 p-1" role="tablist" aria-label="Attendance view">
          <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === 'mine' ? 'bg-white text-primary-700 shadow-sm' : 'text-tertiary-600 hover:text-tertiary-800'}`}>My attendance</button>
          {isAdmin && <button type="button" role="tab" aria-selected={tab === 'team'} onClick={() => setTab('team')} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === 'team' ? 'bg-white text-primary-700 shadow-sm' : 'text-tertiary-600 hover:text-tertiary-800'}`}>Team attendance</button>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1 pb-0.5" aria-label="Quick ranges">
            {RANGES.map(([label, get]) => (
              <button key={label} type="button" onClick={() => { const [a, b] = get(); setFrom(a); setTo(b); }} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activeRange === label ? 'border-primary-600 bg-primary-600 text-white' : 'border-tertiary-200 bg-white text-tertiary-600 hover:border-primary-300 hover:text-primary-700'}`}>{label}</button>
            ))}
          </div>
          <label className="text-xs font-medium text-tertiary-600">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
          <label className="text-xs font-medium text-tertiary-600">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
          <label className="text-xs font-medium text-tertiary-600">Status<select value={status} onChange={(e) => setStatus(e.target.value)} className={input}><option value="">All statuses</option>{statusOptions.filter(Boolean).map((v) => <option key={v} value={v}>{metaOf(v).label}</option>)}</select></label>
        </div>
      </div>
    </div>
  );
}

export function AttendanceSummary({ rows }) {
  const { counts, rate } = summarize(rows);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <div className="rounded-2xl border border-tertiary-100 border-t-4 border-t-primary-500 bg-white p-4 shadow-card sm:col-span-2 lg:col-span-4 xl:col-span-1">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><CalendarCheck className="h-5 w-5" /></span>
          <div>
            <p className="text-xs font-medium text-tertiary-500">Attendance rate</p>
            <p className="font-heading text-2xl font-semibold text-tertiary-900">{rate === null ? '—' : `${rate}%`}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-tertiary-100"><div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${rate ?? 0}%` }} /></div>
      </div>
      {SUMMARY.map((key) => {
        const m = metaOf(key);
        return (
          <div key={key} className={`rounded-2xl border border-tertiary-100 border-t-4 bg-white p-4 shadow-card ${m.tile}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${m.iconBg}`}><m.icon className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-medium text-tertiary-500">{m.label}</p>
                <p className="font-heading text-2xl font-semibold text-tertiary-900">{counts[key]}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AttendanceDays({ rows, loading }) {
  if (loading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  return (
    <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-tertiary-100 bg-tertiary-50/60 px-5 py-3">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Daily record</h3>
        <span className="text-xs text-tertiary-500">{rows.length} day{rows.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="max-h-[calc(100dvh-26rem)] min-h-[12rem] divide-y divide-tertiary-100 overflow-y-auto">
        {rows.map((row) => {
          const key = dayKey(row);
          const p = partsOf(key);
          const m = metaOf(row.status);
          return (
            <li key={row.id || key} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-tertiary-50/60">
              <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border ${p?.weekend ? 'border-tertiary-200 bg-tertiary-50' : 'border-primary-100 bg-primary-50'}`}>
                <span className="text-[10px] font-semibold uppercase leading-none text-tertiary-500">{p?.month || ''}</span>
                <span className="font-heading text-lg font-semibold leading-tight text-tertiary-900">{p?.day ?? ''}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-tertiary-900">{p ? `${p.weekday}, ${p.day} ${p.month} ${p.year}` : 'Date not set'}</p>
                {row.from_calendar && <p className="mt-0.5 truncate text-xs text-tertiary-500">{row.calendar_label}{row.status === 'holiday' ? ' · holiday calendar' : ' · approved leave'}</p>}
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${m.pill}`}><m.icon className="h-3.5 w-3.5" />{m.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
