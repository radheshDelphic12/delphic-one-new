import { useEffect, useState } from 'react';
import { Cake, PartyPopper } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';

const when = (days) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);
const dayMonth = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Row({ icon: Icon, tone, item, text }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 text-sm ${item.days_away === 0 ? 'bg-amber-50/60' : ''}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-tertiary-900">{item.name}</span>
        <span className="block truncate text-xs text-tertiary-500">{text}{item.department ? ` · ${item.department}` : ''}</span>
      </span>
      <span className="shrink-0 text-xs text-tertiary-500">{when(item.days_away)} · {dayMonth(item.date)}</span>
    </li>
  );
}

/** Birthdays and work anniversaries in the next 14 days (day and month only; no birth year). Hidden when there are none. */
export default function AnnouncementsCard({ days = 14, showEmpty = false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    apiClient.get('/orgs/announcements', { params: { days } }).then(({ data: body }) => { if (live) setData(body.data); }).catch(() => {});
    return () => { live = false; };
  }, [days]);
  if (!data) return null;
  if (data.birthdays.length === 0 && data.anniversaries.length === 0) {
    return showEmpty ? <p className="rounded-2xl border border-tertiary-100 bg-white px-4 py-6 text-center text-sm text-tertiary-500 shadow-card">No birthdays or work anniversaries in the next {data.days} days.</p> : null;
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <h2 className="border-b border-tertiary-100 px-4 py-3 font-heading text-sm font-semibold text-tertiary-900">
        Announcements <span className="ml-2 font-normal text-tertiary-400">next {data.days} days</span>
      </h2>
      <ul className="divide-y divide-tertiary-100">
        {data.birthdays.map((b) => <Row key={`b-${b.org_membership_id}`} icon={Cake} tone="bg-pink-50 text-pink-600" item={b} text="Birthday" />)}
        {data.anniversaries.map((a) => <Row key={`a-${a.org_membership_id}`} icon={PartyPopper} tone="bg-primary-50 text-primary-600" item={a} text={`${a.years} year${a.years === 1 ? '' : 's'} with the company`} />)}
      </ul>
    </section>
  );
}
