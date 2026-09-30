import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { useAuth } from '../../lib/authContext.jsx';
import HolidayCalendarAdmin from './HolidayCalendarAdmin.jsx';

const KIND_LABEL = { internal: 'Standard', client: 'Client calendar', custom: 'Custom' };

function holidayDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
}

function CalendarCard({ title, subtitle, calendar }) {
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
 * working days, expected hours and pay. Project / client calendars are shown
 * separately as client exceptions only (a client holiday, or a client working
 * weekend → overtime / comp off); they never replace the company calendar.
 */
export default function MyHolidaysTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, loading, refresh } = useLiveData(
    () => apiClient.get('/calendars/me', { params: { year } }).then((r) => r.data.data),
    { deps: [year] }
  );

  return (
    <div className="space-y-4">
      {isAdmin && <HolidayCalendarAdmin onChanged={refresh} />}
      <div className="flex items-center justify-end gap-2">
        <label htmlFor="holiday-year" className="text-xs font-medium text-tertiary-500">Year</label>
        <select id="holiday-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-xl border px-3 py-1.5 text-sm">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
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
          />
          {/* Client exceptions (IT staff / contractors): informational, never the employee's own calendar. */}
          {data.per_project && data.projects.some((p) => p.calendar && p.calendar.id !== data.standard_calendar?.id) && (
            <details className="rounded-2xl border border-tertiary-100 bg-tertiary-50/50 p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-tertiary-800">
                Client / project exceptions
                <span className="ml-2 text-xs font-normal text-tertiary-500">A client may be off on your working day, or work on your day off — hours on your day off go to overtime / comp off.</span>
              </summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {data.projects.filter((p) => p.calendar && p.calendar.id !== data.standard_calendar?.id).map((p) => (
                  <CalendarCard
                    key={p.id}
                    title={p.name}
                    subtitle={p.client_name ? `Client ${p.client_name} — exceptions only` : 'Project calendar — exceptions only'}
                    calendar={p.calendar}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
