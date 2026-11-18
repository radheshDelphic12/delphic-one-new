import { useCallback, useEffect, useState } from 'react';
import { Cake, MessageSquare, PartyPopper, Send, Sparkles, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const when = (days) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);
const dayMonth = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// One neutral, professional label for the action so any kind of announcement (birthday, anniversary, an official notice) can reuse the card.
const ACTION = 'Comment';

const EMOJI = ['🎂', '🎉', '🥳', '👏', '❤️', '🙌', '😊', '😍', '🔥', '👍', '🎁', '🍰', '🎈', '✨', '💐', '🤝', '😄', '🌟', '💯', '🙏', '😎', '🥂', '💪', '🌈'];
const EMOJI_FIRST = 8;
const AVATAR_TONES = ['bg-pink-100 text-pink-700', 'bg-primary-100 text-primary-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-sky-100 text-sky-700'];
const avatarIndex = (name) => [...String(name || '?')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length;
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// The words being typed, without emoji, used to look up matching GIFs.
const gifQuery = (text) => text.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(-6).join(' ');

/**
 * One birthday / anniversary row. Today's rows can be commented on (colleagues only, once each) and show who commented when the avatars are clicked;
 * the comments only exist for that day, so tomorrow the row has none. While writing, emoji can be added and GIFs matching the words typed
 * are suggested (only when the server has a GIF key; otherwise the GIF strip simply does not appear).
 */
function Row({ icon: Icon, tone, item, text, kind, onWished }) {
  const { pushError, pushInfo } = useAlerts();
  const isToday = item.days_away === 0;
  const wishes = item.wishes || [];
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [moreEmoji, setMoreEmoji] = useState(false);
  const [gifs, setGifs] = useState([]);
  const [gifsOn, setGifsOn] = useState(true); // flips to false once the server says there is no GIF key
  const [gif, setGif] = useState(null);

  const query = gifQuery(message);
  useEffect(() => {
    if (!composing || !gifsOn || query.length < 3) { setGifs([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      apiClient.get('/orgs/announcements/gifs', { params: { q: query } })
        .then(({ data: body }) => { if (!live) return; if (body.data?.enabled === false) setGifsOn(false); setGifs(body.data?.results || []); })
        .catch(() => { if (live) setGifs([]); });
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [composing, gifsOn, query]);

  function close() {
    setComposing(false);
    setMessage('');
    setGif(null);
    setGifs([]);
    setMoreEmoji(false);
  }

  async function send() {
    setSending(true);
    try {
      await apiClient.post('/orgs/announcements/wishes', { org_membership_id: item.org_membership_id, kind, message: message.trim() || undefined, gif_url: gif?.url });
      pushInfo(`Your comment was posted for ${item.name || 'your colleague'}`);
      close();
      setOpen(true);
      onWished();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not post your comment'), 'Something went wrong');
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
              <button
                type="button"
                className={`group flex items-center rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-tertiary-100 ${open ? 'bg-tertiary-100' : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                title={open ? 'Hide the comments' : 'See the comments'}
              >
                <span className="flex -space-x-2">
                  {wishes.slice(0, 3).map((w, i) => (
                    <span key={`${w.from_name}-${i}`} className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white ${AVATAR_TONES[avatarIndex(w.from_name)]}`}>{initials(w.from_name)}</span>
                  ))}
                </span>
                <span className="ml-1.5 text-xs font-medium text-tertiary-600">{wishes.length === 1 ? '1 comment' : `${wishes.length} comments`}</span>
              </button>
            )}
            {item.is_me && wishes.length === 0 && <span className="text-xs text-tertiary-500">No comments yet</span>}
            {!item.is_me && !item.wished_by_me && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                onClick={() => (composing ? close() : setComposing(true))}
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> {ACTION}
              </button>
            )}
            {!item.is_me && item.wished_by_me && <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700">You commented ✓</span>}
          </span>
        )}
        <span className="shrink-0 text-xs text-tertiary-500">{when(item.days_away)} · {dayMonth(item.date)}</span>
      </div>
      {composing && (
        <div className="mx-4 mb-3 ml-[3.75rem] space-y-2.5 rounded-2xl border border-primary-100 bg-primary-50/40 p-3">
          <div className="flex items-center gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={300}
              placeholder={kind === 'birthday' ? 'Happy birthday! 🎂 (or write your own comment)' : 'Happy work anniversary! 🎉 (or write your own comment)'}
              className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-1.5 text-sm"
              aria-label="Your comment"
            />
            <button type="button" className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs" onClick={send} disabled={sending}>
              <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" aria-label="Add an emoji">
            {(moreEmoji ? EMOJI : EMOJI.slice(0, EMOJI_FIRST)).map((e) => (
              <button key={e} type="button" className="rounded-full bg-white px-2 py-0.5 text-base shadow-sm ring-1 ring-tertiary-100 hover:bg-tertiary-50" onClick={() => setMessage((m) => `${m}${e}`.slice(0, 300))}>{e}</button>
            ))}
            <button type="button" className="rounded-full px-2 py-0.5 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => setMoreEmoji((v) => !v)}>{moreEmoji ? 'Fewer' : 'More emoji'}</button>
          </div>

          {gif && (
            <div className="relative inline-block">
              <img src={gif.url} alt={gif.title || 'Selected GIF'} className="max-h-32 rounded-xl ring-1 ring-tertiary-100" />
              <button type="button" aria-label="Remove the GIF" className="absolute -right-2 -top-2 rounded-full bg-white p-1 shadow ring-1 ring-tertiary-200 hover:bg-tertiary-50" onClick={() => setGif(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          {gifsOn && gifs.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-tertiary-500">GIFs for “{query}” — tap one to add it</p>
              <div className="flex gap-2 overflow-x-auto pb-1" aria-label="GIF suggestions">
                {gifs.map((g) => (
                  <button key={g.id} type="button" onClick={() => setGif(g)} className={`shrink-0 overflow-hidden rounded-xl ring-2 ${gif?.id === g.id ? 'ring-primary-500' : 'ring-transparent hover:ring-tertiary-200'}`}>
                    <img src={g.preview} alt={g.title || 'GIF suggestion'} loading="lazy" className="h-20 w-auto" />
                  </button>
                ))}
              </div>
              <p className="mt-0.5 text-[10px] text-tertiary-400">Powered by GIPHY</p>
            </div>
          )}
        </div>
      )}
      {open && wishes.length > 0 && (
        <div className="mx-4 mb-3 ml-[3.75rem] overflow-hidden rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50 via-white to-amber-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-tertiary-700">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" /> {wishes.length === 1 ? '1 comment' : `${wishes.length} comments`} for {String(item.name || 'them').split(' ')[0]}
          </p>
          <ul className="space-y-2" aria-label="Comments">
            {wishes.map((w, i) => (
              <li key={`${w.from_name}-${i}`} className="flex items-start gap-2.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${AVATAR_TONES[avatarIndex(w.from_name)]}`} aria-hidden="true">
                  {initials(w.from_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-xs">
                    <span className="font-semibold text-tertiary-900">{w.is_mine ? 'You' : w.from_name}</span>
                    {w.at && <span className="text-[11px] text-tertiary-400">{new Date(w.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>}
                  </p>
                  {w.message && <p className="mt-0.5 inline-block max-w-full break-words rounded-2xl rounded-tl-sm bg-white px-3 py-1.5 text-sm text-tertiary-800 shadow-sm ring-1 ring-tertiary-100">{w.message}</p>}
                  {w.gif_url && <img src={w.gif_url} alt="GIF" loading="lazy" className="mt-1.5 block max-h-40 rounded-xl ring-1 ring-tertiary-100" />}
                </div>
              </li>
            ))}
          </ul>
        </div>
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
