import { useEffect, useState } from 'react';
import axios from 'axios';
import { ShieldCheck } from 'lucide-react';
import Pill from '../../components/ui/Pill.jsx';
import { dateLabel } from '../../lib/format.js';

const CATEGORY_TONE = { todo: 'blue', in_progress: 'purple', blocked: 'red', done: 'green' };
const PRIORITY_TONE = { low: 'gray', medium: 'blue', high: 'amber', urgent: 'red' };

/**
 * Read-only project page for a client or vendor. Opened from a shared link (/guest-project#token=...): no login, the token in the
 * URL fragment (never sent to a server, not kept in history requests) is the only credential. A bare axios instance on purpose,
 * so it never touches the app's login / refresh machinery.
 */
export default function GuestProjectPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const client = () => axios.create({ baseURL: '/api/v1/pm-guest', headers: { Authorization: `Bearer ${token}` } });
  async function load() {
    try { setData((await client().get('/')).data.data); setError(''); } catch (e) { setData(null); setError(e.response?.status === 401 ? 'This link is invalid, expired or has been withdrawn.' : 'This project is not available.'); }
  }
  useEffect(
    () => { if (token) load(); else setError('This link is incomplete.'); },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the page opens
    [],
  );

  async function send(ticketId) {
    if (!text.trim()) return;
    setBusy(true);
    try { await client().post(`/tickets/${ticketId}/comments`, { body: text.trim() }); setText(''); await load(); } catch (e) { setError(e.response?.data?.message || 'Could not send your comment.'); } finally { setBusy(false); }
  }

  if (error && !data) return <main className="mx-auto max-w-xl p-8"><p className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700" role="alert">{error}</p></main>;
  if (!data) return <main className="mx-auto max-w-xl p-8 text-sm text-tertiary-500">Loading...</main>;
  const { project, progress, tickets, fields, share } = data;
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8" data-testid="guest-project">
      <header className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-xs text-tertiary-500"><ShieldCheck className="h-4 w-4" />Shared with {share.label} · view {share.can_comment ? 'and comment' : 'only'} · link valid until {dateLabel(share.expires_at)}</p>
        <h1 className="font-heading text-2xl font-semibold text-tertiary-900">{project.name} <span className="text-sm font-normal text-tertiary-400">{project.code}</span></h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-tertiary-600"><Pill value={project.status} />{project.start_date && <span>{dateLabel(project.start_date)}{project.end_date ? ` → ${dateLabel(project.end_date)}` : ''}</span>}</p>
        {project.description && <p className="whitespace-pre-wrap text-sm text-tertiary-600">{project.description}</p>}
      </header>
      <section className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between text-sm"><span className="font-medium">Progress</span><span>{progress.done} of {progress.total} done · {progress.percent}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-tertiary-100"><div className="h-full rounded-full bg-primary-600" style={{ width: `${progress.percent}%` }} /></div>
        <p className="mt-2 text-xs text-tertiary-500">{progress.open} open{progress.blocked ? ` · ${progress.blocked} blocked` : ''}{progress.overdue ? ` · ${progress.overdue} overdue` : ''}</p>
      </section>
      {error && <p className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700" role="alert">{error}</p>}
      <ul className="space-y-2" data-testid="guest-tickets">
        {tickets.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-tertiary-500">No tickets to show yet.</li>}
        {tickets.map((t) => (
          <li key={t.id} className="rounded-xl border bg-white">
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => { setOpen(open === t.id ? null : t.id); setText(''); }}>
              <span className="text-sm font-medium text-tertiary-900">#{t.number} {t.title}</span>
              <span className="flex items-center gap-2"><Pill tone={CATEGORY_TONE[t.category]}>{t.status_label}</Pill><Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>{t.due_date && <span className={`text-xs ${t.overdue ? 'font-medium text-danger-600' : 'text-tertiary-500'}`}>due {dateLabel(t.due_date)}</span>}</span>
            </button>
            {open === t.id && (
              <div className="space-y-3 border-t px-4 py-3 text-sm">
                {t.description && <p className="whitespace-pre-wrap text-tertiary-700">{t.description}</p>}
                {fields.filter((f) => t.custom_values[f.key] !== undefined).length > 0 && (
                  <dl className="grid grid-cols-2 gap-2 text-xs">{fields.filter((f) => t.custom_values[f.key] !== undefined).map((f) => <div key={f.key}><dt className="text-tertiary-500">{f.label}</dt><dd className="text-tertiary-900">{String(t.custom_values[f.key])}</dd></div>)}</dl>
                )}
                {t.resolution && <p className="rounded-lg bg-green-50 p-2 text-green-800"><span className="font-medium">Resolution:</span> {t.resolution}</p>}
                <div className="space-y-1">
                  {t.comments.map((c) => <p key={c.id} className={`rounded-lg px-3 py-2 ${c.mine ? 'bg-primary-50' : 'bg-tertiary-50'}`}><span className="text-xs text-tertiary-500">{c.author} · {dateLabel(c.created_at)}</span><br />{c.body}</p>)}
                </div>
                {share.can_comment && (
                  <div className="flex gap-2">
                    <input className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Write a comment..." value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(t.id)} data-testid="guest-comment-input" />
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => send(t.id)} data-testid="guest-comment-send">Send</button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
