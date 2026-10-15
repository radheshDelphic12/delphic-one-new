import { useState } from 'react';
import { CalendarDays, PartyPopper } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { useAuth } from '../../lib/authContext.jsx';
import HolidayCalendarAdmin from './HolidayCalendarAdmin.jsx';

const KIND_LABEL = { internal: 'Standard', client: 'Client calendar', custom: 'Custom' };

function holidayDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
}

const chip = (value) => {
  const d = new Date(value);
  return { month: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), day: d.getUTCDate(), weekday: d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) };
};
const dayKey = (value) => String(value).slice(0, 10);
const todayKey = () => new Date().toLocaleDateString('en-CA');

/** The refreshed list: each holiday as a dated row, past ones muted, the next one highlighted. */
function HolidayList({ calendar }) {
  const today = todayKey();
  const next = calendar.holidays.find((h) => dayKey(h.date) >= today);
  const days = next ? Math.round((new Date(`${dayKey(next.date)}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null;
  return (
    <div className="space-y-3">
      {next && (
        <div className="flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-primary-700 shadow-sm"><PartyPopper className="h-5 w-5" /></span>
          <div>
            <p className="text-xs font-medium text-primary-700">Next holiday</p>
            <p className="text-sm font-semibold text-tertiary-900">{next.label} <span className="font-normal text-tertiary-500">· {holidayDate(next.date)} · {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}</span></p>
          </div>
        </div>
      )}
      <ul className="divide-y divide-tertiary-100 overflow-hidden rounded-xl border border-tertiary-100">
        {calendar.holidays.map((h) => {
          const c = chip(h.date);
          const past = dayKey(h.date) < today;
          const isNext = next && h === next;
          return (
            <li key={`${h.date}-${h.label}`} className={`flex items-center gap-4 px-4 py-3 ${isNext ? 'bg-primary-50/40' : ''} ${past ? 'opacity-60' : ''}`}>
              <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border ${isNext ? 'border-primary-200 bg-primary-50' : 'border-tertiary-200 bg-tertiary-50'}`}>
                <span className="text-[10px] font-semibold uppercase leading-none text-tertiary-500">{c.month}</span>
                <span className="font-heading text-lg font-semibold leading-tight text-tertiary-900">{c.day}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-tertiary-900">{h.label}{h.is_working_day && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Client working day</span>}</p>
                <p className="text-xs text-tertiary-500">{c.weekday}</p>
              </div>
              {past && <span className="shrink-0 text-xs text-tertiary-400">Past</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CalendarCard({ title, subtitle, calendar, modern }) {
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
          {subtitle && <p className="text-xs text-tertiary-500">{subtitle}</p>}
        </div>
        {calendar && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${calendar.kind === 'client' ? 'bg-primary-50 text-primary-700' : 'bg-tertiary-100 text-tertiary-600'}`}>
            {calendar.name} · {KIND_LABEL[calendar.kind] || calendar.kind}
          </span>
        )}
      </div>
      {!calendar ? (
        <p className="text-sm text-tertiary-500">No holiday calendar is set up yet.</p>
      ) : calendar.holidays.length === 0 ? (
        <p className="text-sm text-tertiary-500">No holidays in this year.</p>
      ) : modern ? (
        <HolidayList calendar={calendar} />
      ) : (
        <ul className="divide-y divide-tertiary-100">
          {calendar.holidays.map((h) => (
            <li key={`${h.date}-${h.label}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-tertiary-900">
                {h.label}
                {h.is_working_day && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Client working day</span>}
              </span>
              <span className="shrink-0 tabular-nums text-tertiary-500">{holidayDate(h.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The signed-in person's ONE official company calendar (their mapping →
 * department → office location → company default) — the source of their
 * working days, expected hours and pay. The Project Calendar is not shown in
 * Time & Attendance any more.
 */
export default function MyHolidaysTab() {
  const { user, isGroupSuperadmin } = useAuth();
  const isAdmin = user?.role === 'admin';
  const modern = !isGroupSuperadmin;
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, loading, refresh } = useLiveData(
    () => apiClient.get('/calendars/me', { params: { year } }).then((r) => r.data.data),
    { deps: [year] }
  );

  return (
    <div className="space-y-4">
      {isAdmin && <HolidayCalendarAdmin onChanged={refresh} />}
      {modern ? (
        <div className="ta-head flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Time &amp; Attendance</p>
            <h2 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Holiday calendar</h2>
            <p className="mt-1 text-sm text-tertiary-500">Your office&apos;s official holidays. Your working days, expected hours and salary follow this calendar.</p>
          </div>
          <label className="text-xs font-medium text-tertiary-600">Year
            <select id="holiday-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
      ) : (
      <div className="flex items-center justify-end gap-2">
        <label htmlFor="holiday-year" className="text-xs font-medium text-tertiary-500">Year</label>
        <select id="holiday-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-xl border px-3 py-1.5 text-sm">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      )}
      {loading && !data ? (
        <div className="rounded-2xl border border-tertiary-100 bg-white p-6 text-sm text-tertiary-500">Loading holiday calendars…</div>
      ) : !data ? (
        <EmptyState icon={CalendarDays} title="Holiday calendar unavailable" description="Your holiday calendar could not be loaded." />
      ) : (
        <div className="space-y-4">
          <CalendarCard
            title="Your company calendar"
            subtitle="Official calendar for your office — your working days, expected hours and salary follow this one"
            calendar={data.standard_calendar}
            modern={modern}
          />
        </div>
      )}
    </div>
  );
}
