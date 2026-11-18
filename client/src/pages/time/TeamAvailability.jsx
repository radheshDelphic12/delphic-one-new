import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Avatar from '../../components/ui/Avatar.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

// Time & Attendance > Team availability: whether your manager, your reports and your teammates are in, working remotely or on leave, today
// or any other day, with the week around it. A status only: hours and check-in places are never shown, and the leave type (Sick, Casual ...)
// appears on hover only for the person's own manager, the person themselves and an admin.

const STATUS = {
  present: { label: 'Present', badge: 'bg-green-50 text-green-700 ring-green-200', dot: 'bg-green-500' },
  remote: { label: 'Working remotely', badge: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500' },
  site: { label: 'At a work site', badge: 'bg-violet-50 text-violet-800 ring-violet-200', dot: 'bg-violet-500' },
  half_day: { label: 'Half day', badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  leave: { label: 'On leave', badge: 'bg-blue-50 text-blue-800 ring-blue-200', dot: 'bg-blue-500' },
  unavailable: { label: 'Unavailable', badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
  pending: { label: 'Not in yet', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-400' },
  off: { label: 'Day off', badge: 'bg-tertiary-100 text-tertiary-600 ring-tertiary-200', dot: 'bg-tertiary-400' },
  none: { label: '-', badge: 'bg-tertiary-50 text-tertiary-400 ring-tertiary-100', dot: 'bg-tertiary-200' },
};
const SUMMARY_ORDER = ['present', 'remote', 'site', 'half_day', 'leave', 'unavailable', 'pending', 'off'];
const RELATION = { you: 'You', manager: 'Manager', report: 'Reports to you', peer: 'Teammate', team: 'Teammate', colleague: 'Colleague' };
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const shiftDay = (ymd, delta) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + delta * 86400000).toISOString().slice(0, 10);
const longDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function TeamAvailability() {
  const { pushError } = useAlerts();
  const [date, setDate] = useState(null); // null = today (the server says which day that is)
  const [scope, setScope] = useState('team');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [only, setOnly] = useState(null); // a status key chosen from the summary chips

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get('/attendance-dashboard/team-status', { params: { ...(date ? { date } : {}), scope } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the team availability'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [date, scope, pushError]);
  useEffect(() => { load(); }, [load]);

  const selected = data?.date || date;
  const people = useMemo(() => {
    const all = data?.people || [];
    if (!only) return all;
    return all.filter((p) => (p.days.find((d) => d.date === selected)?.key || 'none') === only);
  }, [data, only, selected]);
  const onlyMe = data && data.people.length === 1 && data.people[0].is_me;

  return (
    <div className="space-y-4" data-testid="team-availability">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-tertiary-900"><Users className="h-5 w-5 text-primary-600" /> Team availability</h2>
          <p className="mt-0.5 text-sm text-tertiary-500">
            {data?.scope === 'all' ? 'Everyone in the company' : 'You, your manager, your teammates and the people who report to you'}
            {' '}- {selected ? longDate(selected) : 'today'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.can_see_all && (
            <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5 text-sm" role="group" aria-label="Who to show">
              {[['team', 'My team'], ['all', 'Everyone']].map(([key, label]) => (
                <button key={key} type="button" aria-pressed={scope === key} onClick={() => setScope(key)} className={`rounded-lg px-3 py-1.5 font-medium ${scope === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
              ))}
            </div>
          )}
          <div className="inline-flex items-center gap-1 rounded-xl border border-tertiary-200 bg-white p-0.5">
            <button type="button" aria-label="Previous day" className="rounded-lg p-1.5 text-tertiary-600 hover:bg-tertiary-50" disabled={!selected} onClick={() => setDate(shiftDay(selected, -1))}><ChevronLeft className="h-4 w-4" /></button>
            <input type="date" aria-label="Date" value={selected || ''} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border-0 px-1 py-1 text-sm text-tertiary-800 outline-none" />
            <button type="button" aria-label="Next day" className="rounded-lg p-1.5 text-tertiary-600 hover:bg-tertiary-50" disabled={!selected} onClick={() => setDate(shiftDay(selected, 1))}><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={() => setDate(null)} disabled={!date}>Today</button>
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap gap-2" aria-label="Summary for the day">
          {SUMMARY_ORDER.filter((k) => data.summary[k]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={only === k}
              data-testid={`summary-${k}`}
              onClick={() => setOnly(only === k ? null : k)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${STATUS[k].badge} ${only === k ? 'ring-2' : ''}`}
            >
              <span className={`h-2 w-2 rounded-full ${STATUS[k].dot}`} />
              {STATUS[k].label} <span className="font-semibold">{data.summary[k]}</span>
            </button>
          ))}
          {only && <button type="button" className="text-sm font-medium text-primary-700 hover:underline" onClick={() => setOnly(null)}>Show everyone</button>}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        {loading && !data ? (
          <p className="p-6 text-sm text-tertiary-500">Loading...</p>
        ) : !people.length ? (
          <EmptyState title="Nobody to show" description={only ? 'Nobody has that status on this day.' : 'No team members found.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-canvas-muted text-left text-xs uppercase tracking-wide text-tertiary-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-4 py-2.5 font-semibold">Role in your team</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">This week</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const today = p.days.find((d) => d.date === selected) || { key: 'none', label: '-' };
                  const tone = STATUS[today.key] || STATUS.none;
                  return (
                    <tr key={p.org_membership_id} className="border-t border-tertiary-100" data-testid="team-person">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={p.name} />
                          <div className="min-w-0">
                            <div className="font-medium text-tertiary-900">{p.name}{p.is_me && <span className="ml-1.5 text-xs font-normal text-tertiary-400">(you)</span>}</div>
                            <div className="truncate text-xs text-tertiary-500">{[p.designation, p.team || p.department].filter(Boolean).join(' - ') || ' '}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-tertiary-700">{RELATION[p.relation] || ''}{p.on_notice && <span className="ml-1.5 text-xs text-amber-700">Serving notice</span>}</td>
                      <td className="px-4 py-3">
                        <span title={today.detail ? `${today.label} - ${today.detail}` : today.label} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tone.badge}`} data-testid="team-status">
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />{today.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {p.days.map((d) => {
                            const t = STATUS[d.key] || STATUS.none;
                            const dt = new Date(`${d.date}T00:00:00Z`);
                            return (
                              <button
                                key={d.date}
                                type="button"
                                title={`${longDate(d.date)}: ${d.label}${d.detail ? ` - ${d.detail}` : ''}`}
                                aria-label={`${p.name}, ${longDate(d.date)}: ${d.label}${d.detail ? ` - ${d.detail}` : ''}`}
                                onClick={() => setDate(d.date === data?.today ? null : d.date)}
                                className={`flex w-9 flex-col items-center rounded-md border px-1 py-1 text-[10px] leading-tight ${d.date === selected ? 'border-primary-400 bg-primary-50' : 'border-tertiary-100 hover:bg-tertiary-50'}`}
                              >
                                <span className="text-tertiary-500">{WEEKDAY[dt.getUTCDay()]}</span>
                                <span className={`mt-0.5 h-2 w-2 rounded-full ${t.dot}`} />
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {onlyMe && <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800">No manager is set for you yet and nobody reports to you. Once HR sets your manager (People &gt; HR Settings), your team shows up here.</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tertiary-500" aria-label="Legend">
        {['present', 'remote', 'site', 'half_day', 'leave', 'unavailable', 'pending', 'off'].map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS[k].dot}`} />{STATUS[k].label}</span>
        ))}
      </div>
    </div>
  );
}
