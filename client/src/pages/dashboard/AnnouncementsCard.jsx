import { useCallback, useEffect, useState } from 'react';
import { Cake, ChevronDown, ChevronUp, Gift, PartyPopper, Send } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const when = (days) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);
const dayMonth = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * One birthday / anniversary row. Today's rows can be wished (colleagues only, once each) and show who wished when the row is opened;
 * wishes only exist for that day, so tomorrow the row has none.
 */
function Row({ icon: Icon, tone, item, text, kind, onWished }) {
  const { pushError, pushInfo } = useAlerts();
  const isToday = item.days_away === 0;
  const wishes = item.wishes || [];
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await apiClient.post('/orgs/announcements/wishes', { org_membership_id: item.org_membership_id, kind, message: message.trim() || undefined });
      pushInfo(`Wished ${item.name || 'your colleague'}`);
      setComposing(false);
      setMessage('');
      setOpen(true);
      onWished();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not send the wish'), 'Something went wrong');
      if (err?.response?.status === 409) onWished();
    } finally {
      setSending(false);
    }
  }

  return (
    <li className={item.days_away === 0 ? 'bg-amber-50/60' : ''}>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-tertiary-900">{item.name}{item.is_me && <span className="ml-1.5 text-xs font-normal text-tertiary-500">(you)</span>}</span>
          <span className="block truncate text-xs text-tertiary-500">{text}{item.department ? ` · ${item.department}` : ''}</span>
        </span>
        {isToday && (
          <span className="flex shrink-0 items-center gap-1">
            {wishes.length > 0 && (
              <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {wishes.length} wish{wishes.length === 1 ? '' : 'es'} {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
            {!item.is_me && !item.wished_by_me && (
              <button type="button" className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs" onClick={() => setComposing((v) => !v)}>
                <Gift className="h-3.5 w-3.5" /> Wish
              </button>
            )}
            {!item.is_me && item.wished_by_me && <span className="text-xs text-success-700">You wished</span>}
          </span>
        )}
        <span className="shrink-0 text-xs text-tertiary-500">{when(item.days_away)} · {dayMonth(item.date)}</span>
      </div>
      {composing && (
        <div className="flex items-center gap-2 px-4 pb-3 pl-[3.75rem]">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={300}
            placeholder={kind === 'birthday' ? 'Happy birthday! 🎂 (add your own message)' : 'Happy work anniversary! 🎉 (add your own message)'}
            className="min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-sm"
          />
          <button type="button" className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs" onClick={send} disabled={sending}>
            <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
      {open && wishes.length > 0 && (
        <ul className="space-y-1 px-4 pb-3 pl-[3.75rem] text-xs text-tertiary-700" aria-label="Wishes">
          {wishes.map((w, i) => (
            <li key={`${w.from_name}-${i}`} className="rounded-lg bg-tertiary-50 px-2.5 py-1.5">
              <span className="font-medium text-tertiary-900">{w.is_mine ? 'You' : w.from_name}</span>: {w.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Birthdays and work anniversaries in the next 14 days (day and month only; no birth year). Hidden when there are none. */
export default function AnnouncementsCard({ days = 14, showEmpty = false }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    apiClient.get('/orgs/announcements', { params: { days } }).then(({ data: body }) => setData(body.data)).catch(() => {});
  }, [days]);
  useEffect(() => { load(); }, [load]);
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
        {data.birthdays.map((b) => <Row key={`b-${b.org_membership_id}`} icon={Cake} tone="bg-pink-50 text-pink-600" item={b} text="Birthday" kind="birthday" onWished={load} />)}
        {data.anniversaries.map((a) => <Row key={`a-${a.org_membership_id}`} icon={PartyPopper} tone="bg-primary-50 text-primary-600" item={a} text={`${a.years} year${a.years === 1 ? '' : 's'} with the company`} kind="anniversary" onWished={load} />)}
      </ul>
    </section>
  );
}
