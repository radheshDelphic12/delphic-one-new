import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../../components/ui/Pill.jsx';
import NoteText from '../../components/NoteText.jsx';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = {
  approved: ['Approved', 'green'],
  pending: ['Pending', 'amber'],
  rejected: ['Rejected', 'red'],
  empty: ['—', 'gray'],
};
const OT_STATUS = {
  pending: ['OT pending', 'amber'],
  approved: ['OT approved', 'purple'],
  rejected: ['OT rejected', 'red'],
  comp_off: ['Comp off', 'blue'],
};
const DAY_TYPE = {
  weekend: 'Weekend',
  company_holiday: 'Company holiday',
};

// Leave on a day: type + Paid/Unpaid + Full/Half day. Only approved leave has hours.
const leaveText = (l) => `${l.paid ? 'Paid' : 'Unpaid'} leave - ${l.name} - ${l.is_half_day ? 'Half day' : 'Full day'}`;
const leaveTone = (d) => {
  if (!d.leave) return '';
  if (!d.leave.paid) return 'bg-tertiary-100';
  return d.leave.is_half_day ? 'bg-sky-50' : 'bg-blue-50';
};

const h = (n) => (n ? `${Number(n)}h` : '0h');
const shift = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Sunday → Saturday week of one employee: expected / logged / approved /
 * pending / OT per day, all computed on the server (GET /timesheets/week).
 * Orange = fewer hours than expected; a locked week is read-only for the
 * employee. `canDeleteOwn` shows Delete on the caller's own pending entries in
 * an open week.
 */
export default function WeekHoursView({ orgMembershipId, initialDate, canDeleteOwn = false, reloadKey = 0, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [date, setDate] = useState(initialDate || null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get('/timesheets/week', { params: { ...(date ? { date } : {}), ...(orgMembershipId ? { org_membership_id: orgMembershipId } : {}) } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the week'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [date, orgMembershipId, pushError]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function removeEntry(entry) {
    if (!window.confirm(`Delete ${entry.hours}h${entry.project ? ` on ${entry.project}` : ''}?`)) return;
    try {
      await apiClient.delete(`/timesheets/entries/${entry.id}`);
      pushSuccess('Entry deleted');
      load();
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the entry'), 'Not deleted');
    }
  }

  const t = data?.totals;
  return (
    <section className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost p-1.5" aria-label="Previous week" onClick={() => data && setDate(shift(data.week_start, -7))}><ChevronLeft className="h-4 w-4" /></button>
          <h3 className="font-heading text-sm font-semibold text-tertiary-900">
            {data ? `Week: Sun ${dayLabel(data.week_start)} → Sat ${dayLabel(data.week_end)}` : 'Week'}
          </h3>
          <button type="button" className="btn-ghost p-1.5" aria-label="Next week" onClick={() => data && setDate(shift(data.week_start, 7))}><ChevronRight className="h-4 w-4" /></button>
          {date && <button type="button" className="btn-ghost text-xs" onClick={() => setDate(null)}>This week</button>}
          {data?.locked && <Pill tone="gray"><Lock className="mr-1 inline h-3 w-3" />Locked</Pill>}
        </div>
        {data && (
          <p className="text-xs text-tertiary-500">
            Shift {data.shift_hours}h/day{data.calendar ? ` · ${data.calendar.name} calendar` : ''} · Paid hours this week: {h(t?.paid_hours)}
          </p>
        )}
      </div>

      {data?.locked && canDeleteOwn && (
        <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">
          This week is locked — you can view it but not add, edit or delete. Need a correction? Raise a Timesheet Regularisation below.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-tertiary-100 text-left text-xs uppercase tracking-wide text-tertiary-500">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Day</th>
              <th className="py-2 pr-3 text-right">Expected</th>
              <th className="py-2 pr-3 text-right">Logged</th>
              <th className="py-2 pr-3 text-right">Approved</th>
              <th className="py-2 pr-3 text-right">Pending</th>
              <th className="py-2 pr-3 text-right">Rejected</th>
              <th className="py-2 pr-3 text-right">OT</th>
              <th className="py-2 pr-3">Leave</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={10} className="py-6 text-center text-tertiary-400">Loading…</td></tr>}
            {data?.days.map((d) => {
              const short = d.deficit > 0;
              const [statusLabel, statusTone] = STATUS[d.status] || STATUS.empty;
              const ot = d.ot_status ? OT_STATUS[d.ot_status] : null;
              return (
                <tr key={d.date} className={`border-b border-tertiary-50 align-top ${short ? 'bg-orange-50' : leaveTone(d)}`}>
                  <td className="py-2 pr-3 whitespace-nowrap text-tertiary-900">{DAY_NAMES[d.weekday]} {dayLabel(d.date)}</td>
                  <td className="py-2 pr-3">
                    <span className="block text-xs text-tertiary-600">
                      {d.leave ? leaveText(d.leave) : DAY_TYPE[d.day_type] ? `${DAY_TYPE[d.day_type]}${d.day_label && d.day_type === 'company_holiday' ? ` · ${d.day_label}` : ''}` : d.day_label ? `Working · ${d.day_label}` : 'Working day'}
                    </span>
                    {d.client_flags.map((f) => (
                      <span key={`${f.type}-${f.project}`} className={`block text-xs ${f.type === 'client_working' ? 'text-primary-700' : 'text-purple-700'}`}>
                        {f.type === 'client_working' ? 'Client working' : 'Client holiday'} · {f.project}{f.label ? ` (${f.label})` : ''}
                      </span>
                    ))}
                    {d.comp_off_eligible && !d.client_flags.length && <span className="block text-xs text-primary-700">Worked on a day off</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-tertiary-500">{h(d.expected)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${short ? 'font-semibold text-orange-700' : 'text-tertiary-900'}`}>
                    {h(d.logged)}
                    {short && <span className="block text-xs font-normal">−{d.deficit}h short</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-success-700">{h(d.approved)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-warning-700">{h(d.pending)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-danger-600">{d.rejected ? h(d.rejected) : '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{d.ot_hours ? <span className="font-semibold text-purple-700">{h(d.ot_hours)}</span> : '—'}</td>
                  <td className="py-2 pr-3 text-xs">
                    {d.leaves?.length > 0 && d.leaves.map((l) => (
                      <span key={l.request_id} className="block whitespace-nowrap">
                        <span className="font-semibold tabular-nums text-blue-700">{h(l.hours)}</span>
                        {' '}<Pill tone={l.paid ? 'blue' : 'gray'}>{l.paid ? 'Paid' : 'Unpaid'}</Pill>
                        {' '}<Pill tone="green">Approved</Pill>
                        {l.is_half_day && <span className="block text-tertiary-500">{l.half_day_session === 'SECOND_HALF' ? 'Second half' : 'First half'} + working</span>}
                      </span>
                    ))}
                    {d.pending_leaves?.map((l) => (
                      <span key={l.request_id} className="block whitespace-nowrap text-tertiary-500">
                        <Pill tone="amber">Leave pending</Pill> {l.name} - {l.is_half_day ? 'Half' : 'Full'} day (no effect yet)
                      </span>
                    ))}
                    {!d.leaves?.length && !d.pending_leaves?.length && <span className="text-tertiary-400">-</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap gap-1">
                      <Pill tone={statusTone}>{statusLabel}</Pill>
                      {ot && <Pill tone={ot[1]}>{ot[0]}</Pill>}
                      {d.admin_review && <Pill tone="red">Admin review</Pill>}
                    </span>
                    {d.entries.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-tertiary-500">
                        {d.entries.map((e) => (
                          <li key={e.id}>
                            <span className="flex items-center gap-1">
                              <span>{e.hours}h{e.overtime_hours ? ` +${e.overtime_hours}h OT` : ''} · {e.project || 'General'} · {STATUS[e.status === 'submitted' ? 'pending' : e.status]?.[0]}</span>
                              {canDeleteOwn && !d.locked && e.status === 'submitted' && (
                                <button type="button" className="text-danger-600 hover:text-danger-700" aria-label="Delete entry" onClick={() => removeEntry(e)}><Trash2 className="h-3 w-3" /></button>
                              )}
                            </span>
                            {e.notes && <NoteText text={e.notes} className="pl-2 text-tertiary-500" />}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {t && (
            <tfoot>
              <tr className="font-semibold text-tertiary-900">
                <td className="pt-2 pr-3" colSpan={2}>Week total</td>
                <td className="pt-2 pr-3 text-right tabular-nums">{h(t.expected)}</td>
                <td className="pt-2 pr-3 text-right tabular-nums">{h(t.logged)}</td>
                <td className="pt-2 pr-3 text-right tabular-nums text-success-700">{h(t.approved)}</td>
                <td className="pt-2 pr-3 text-right tabular-nums text-warning-700">{h(t.pending)}</td>
                <td className="pt-2 pr-3 text-right tabular-nums text-danger-600">{t.rejected ? h(t.rejected) : '—'}</td>
                <td className="pt-2 pr-3 text-right tabular-nums text-purple-700">{t.ot_hours ? h(t.ot_hours) : '—'}</td>
                <td className="pt-2 pr-3 text-xs font-normal text-tertiary-600">{t.leave_hours ? `${h(t.paid_leave_hours)} paid${t.unpaid_leave_hours ? ` / ${h(t.unpaid_leave_hours)} unpaid` : ''}` : '-'}</td>
                <td className="pt-2 pr-3 text-xs font-normal text-tertiary-500">{t.deficit ? `${t.deficit}h short` : ''}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-tertiary-500">
        Salary uses <b>approved</b> hours up to your shift each day, <b>approved paid leave</b> (full day = shift, half day = half) and <b>approved</b> overtime. Unpaid and pending leave add no paid hours. Pending hours are only a projection.
        {' '}<span className="rounded bg-orange-50 px-1 text-orange-800">Orange</span> = fewer hours than expected.
      </p>
    </section>
  );
}
