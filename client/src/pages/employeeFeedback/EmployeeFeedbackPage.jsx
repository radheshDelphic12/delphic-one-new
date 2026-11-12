import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ListChecks, MessageSquareHeart, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const dateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS_TONE = { new: 'bg-primary-50 text-primary-700', read: 'bg-tertiary-100 text-tertiary-700', actioned: 'bg-success-50 text-success-700', closed: 'bg-tertiary-100 text-tertiary-500' };
function StatusPill({ status, label }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] || STATUS_TONE.read}`}>{label || status}</span>;
}

/**
 * Employee Feedback. Any employee gives feedback (a suggestion, appreciation, a concern), by name or anonymously; ONLY the board - the people an
 * admin names - reads it. The person who gave it sees their own feedback and its status, never the board's note. Delphic Global.
 */
export default function EmployeeFeedbackPage() {
  const { pushError } = useAlerts();
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);

  const loadMeta = useCallback(() => {
    apiClient.get('/employee-feedback/meta').then(({ data }) => setMeta(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not open Employee Feedback'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const tabs = useMemo(() => {
    if (!meta) return [];
    const list = [{ key: 'give', label: 'Give feedback', icon: MessageSquareHeart }, { key: 'mine', label: 'My feedback', icon: ListChecks }];
    if (meta.is_board) list.push({ key: 'inbox', label: 'Board inbox', icon: Inbox });
    if (meta.can_manage) list.push({ key: 'board', label: 'Board members', icon: Users });
    return list;
  }, [meta]);

  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested : tabs[0]?.key;
  const go = (key) => setParams({ tab: key });

  if (!meta) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">Employee Feedback</h1>
        <p className="mt-1 text-sm text-tertiary-500">Tell the board what is working and what is not. Only the board reads it - no manager and no other admin.</p>
      </div>
      <SectionTabs tabs={tabs} value={tab} onChange={go} />
      {tab === 'give' && <GiveFeedback meta={meta} onSent={() => go('mine')} />}
      {tab === 'mine' && <MyFeedback meta={meta} onGive={() => go('give')} />}
      {tab === 'inbox' && <BoardInbox meta={meta} />}
      {tab === 'board' && <BoardMembers onChanged={loadMeta} />}
    </div>
  );
}

function GiveFeedback({ meta, onSent }) {
  const { pushError, pushSuccess } = useAlerts();
  const [form, setForm] = useState({ category: 'suggestion', subject: '', message: '', anonymous: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient.post('/employee-feedback', form);
      pushSuccess(form.anonymous ? 'Sent anonymously to the board.' : 'Sent to the board.', 'Thank you');
      setForm({ category: 'suggestion', subject: '', message: '', anonymous: false });
      onSent();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not send the feedback'), 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="max-w-2xl space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4" data-testid="feedback-form">
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="fb-category">What is it about?</label>
        <select id="fb-category" className={FIELD_INPUT} value={form.category} onChange={set('category')}>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="fb-subject">Title</label>
        <input id="fb-subject" className={FIELD_INPUT} value={form.subject} onChange={set('subject')} maxLength={150} placeholder="A few words" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="fb-message">Your feedback</label>
        <textarea id="fb-message" className={`${FIELD_INPUT} min-h-[140px]`} value={form.message} onChange={set('message')} maxLength={5000} placeholder="What happened, what you would change, or who deserves thanks" required />
      </div>
      <label className="flex items-start gap-2 text-sm text-tertiary-700">
        <input type="checkbox" className="mt-1" checked={form.anonymous} onChange={(e) => setForm((p) => ({ ...p, anonymous: e.target.checked }))} />
        <span>Send anonymously<span className="block text-xs text-tertiary-500">Your name is not stored. You will not be able to see this feedback later or get a reply.</span></span>
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send to the board'}</button>
    </form>
  );
}

function MyFeedback({ meta, onGive }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    apiClient.get('/employee-feedback/mine').then(({ data }) => setRows(data.data || [])).catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Could not load your feedback'), 'Something went wrong'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (list, id) => list.find((x) => x.id === id)?.label || id;
  if (!rows) return <Skeleton className="h-40" />;
  if (!rows.length) return <EmptyState icon={MessageSquareHeart} title="You have not given feedback yet" description="Feedback you send by name is listed here with its status. Anonymous feedback cannot be listed." action={<button type="button" className="btn-primary" onClick={onGive}>Give feedback</button>} />;
  return (
    <div className="space-y-2" data-testid="my-feedback">
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-tertiary-100 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-tertiary-900">{r.subject}</span>
            <StatusPill status={r.status} label={label(meta.statuses, r.status)} />
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-tertiary-700">{r.message}</p>
          <p className="mt-1 text-xs text-tertiary-500">{label(meta.categories, r.category)} · {dateTime(r.created_at)}</p>
        </div>
      ))}
    </div>
  );
}

function BoardInbox({ meta }) {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ status: '', category: '' });
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    apiClient.get('/employee-feedback', { params }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ counts: {}, items: [] }); pushError(apiErrorMessage(err, 'Could not load the feedback'), 'Something went wrong'); });
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function save(item, patch) {
    try {
      await apiClient.patch(`/employee-feedback/${item.id}`, patch);
      pushSuccess('Saved.', 'Saved');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Could not save');
    }
  }

  const label = (list, id) => list.find((x) => x.id === id)?.label || id;
  return (
    <div className="space-y-3" data-testid="board-inbox">
      <div className="flex flex-wrap items-center gap-2">
        {meta.statuses.map((s) => (
          <button key={s.id} type="button" onClick={() => setFilters((p) => ({ ...p, status: p.status === s.id ? '' : s.id }))} className={`rounded-full border px-3 py-1 text-xs ${filters.status === s.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-tertiary-200 text-tertiary-700'}`}>
            {s.label} {data ? `(${data.counts[s.id] || 0})` : ''}
          </button>
        ))}
        <select aria-label="Category" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" value={filters.category} onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value }))}>
          <option value="">All categories</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      {!data ? <Skeleton className="h-40" /> : data.items.length === 0 ? (
        <EmptyState icon={Inbox} title="No feedback here" description="Nothing matches this filter yet." />
      ) : data.items.map((it) => (
        <div key={it.id} className="rounded-2xl border border-tertiary-100 bg-white p-3" data-testid="feedback-item">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-tertiary-900">{it.subject}</span>
            <StatusPill status={it.status} label={label(meta.statuses, it.status)} />
          </div>
          <p className="text-xs text-tertiary-500">{it.from} · {label(meta.categories, it.category)} · {dateTime(it.created_at)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-tertiary-800">{it.message}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <textarea aria-label="Board note" className={`${FIELD_INPUT} min-h-[60px]`} placeholder="Board note (only the board sees it)" value={notes[it.id] ?? it.board_note ?? ''} onChange={(e) => setNotes((p) => ({ ...p, [it.id]: e.target.value }))} maxLength={3000} />
            <div className="flex flex-col gap-2">
              <select aria-label="Status" className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" value={it.status} onChange={(e) => save(it, { status: e.target.value })}>
                {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button type="button" className="btn-secondary text-xs" onClick={() => save(it, { board_note: notes[it.id] ?? it.board_note ?? '' })}>Save note</button>
            </div>
          </div>
          {it.handled_by && <p className="mt-1 text-xs text-tertiary-500">Last handled by {it.handled_by} · {dateTime(it.handled_at)}</p>}
        </div>
      ))}
    </div>
  );
}

function BoardMembers({ onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get('/employee-feedback/board').then(({ data: res }) => { setData(res.data); setPicked(new Set(res.data.members.map((m) => m.org_membership_id))); }).catch((err) => pushError(apiErrorMessage(err, 'Could not load the board'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => (data?.people || []).filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())), [data, query]);
  const toggle = (id) => setPicked((p) => { const next = new Set(p); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function save() {
    setBusy(true);
    try {
      await apiClient.put('/employee-feedback/board', { membership_ids: [...picked] });
      pushSuccess('The board is updated.', 'Saved');
      onChanged();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the board'), 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Skeleton className="h-40" />;
  return (
    <div className="max-w-2xl space-y-3 rounded-2xl border border-tertiary-100 bg-white p-4" data-testid="board-members">
      <p className="text-sm text-tertiary-600">Pick the people who make up the board. Only they can read the feedback. Nobody is on the board until you pick them - not even admins.</p>
      <input className={FIELD_INPUT} placeholder="Search a person" aria-label="Search a person" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-tertiary-50">
            <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} /> {p.name}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-tertiary-500">{picked.size} on the board</span>
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save board'}</button>
      </div>
    </div>
  );
}
