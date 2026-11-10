import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, GitCommit, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { pmApi, pmError } from '../../lib/pm/api.js';
import { dateLabel } from '../../lib/format.js';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';

const INPUT = 'rounded-xl border px-3 py-2 text-sm';
const Empty = ({ children }) => <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-tertiary-500">{children}</p>;
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress', released: 'Released', cancelled: 'Cancelled' };
const STATUS_TONE = { planned: 'blue', in_progress: 'purple', released: 'green', cancelled: 'gray' };
const when = (iso) => (iso ? dateLabel(iso.slice(0, 10)) : '');

function CommitRow({ c, project }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid="pm-commit">
      {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary-700 underline">{c.short}</a> : <span className="font-mono text-xs text-tertiary-500">{c.short}</span>}
      <span className="min-w-0 flex-1 break-words text-tertiary-900">{c.subject}</span>
      {c.tickets.map((t) => <Pill key={t.id} tone="blue">{project.code}#{t.number}</Pill>)}
      <span className="text-xs text-tertiary-500">{c.author_name || 'Unknown'} · {when(c.committed_at)}</span>
    </li>
  );
}

/** One release opened: its tickets, its commits, the status buttons, and the release notes. */
function ReleaseDetail({ project, releaseId, canManage, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [r, setR] = useState(null);
  const [allTickets, setAllTickets] = useState([]);
  const [freeCommits, setFreeCommits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ git_tag: '', commit_sha: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const rel = await pmApi.release(releaseId);
      setR(rel);
      setForm({ git_tag: rel.git_tag || '', commit_sha: rel.commit_sha || '', notes: rel.notes || '' });
      if (rel.can_manage && rel.status !== 'released' && rel.status !== 'cancelled') {
        setAllTickets(await pmApi.tickets(project.id, {}));
        setFreeCommits((await pmApi.commits(project.id, { release: 'none', limit: 200 })).commits);
      }
    } catch (e) { pushError(pmError(e, 'Could not load the release'), 'Load failed'); }
  }, [releaseId, project.id, pushError]);
  useEffect(() => { load(); }, [load]);

  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); if (ok) pushSuccess(ok); await load(); onChanged(); } catch (e) { pushError(pmError(e, 'That did not work'), 'Failed'); } finally { setBusy(false); }
  }
  if (!r) return <p className="px-3 py-4 text-sm text-tertiary-500">Loading…</p>;
  const open = canManage && r.status !== 'released' && r.status !== 'cancelled';
  const inRelease = new Set(r.tickets.map((t) => t.id));
  const addable = allTickets.filter((t) => !inRelease.has(t.id) && !t.release_id);
  const copyNotes = async () => {
    try { const { markdown } = await pmApi.releaseNotes(r.id); await navigator.clipboard.writeText(markdown); pushSuccess('Release notes copied'); } catch (e) { pushError(pmError(e, 'Could not copy the notes'), 'Failed'); }
  };
  const setStatus = (status) => {
    if (status === 'released' && !window.confirm(`Release ${r.version}? It closes the version: tickets and commits cannot be changed afterwards and the status cannot go back.`)) return;
    run(() => pmApi.updateRelease(r.id, { status, ...(status === 'released' ? { git_tag: form.git_tag || null, commit_sha: form.commit_sha || null } : {}) }), `Marked ${STATUS_LABEL[status].toLowerCase()}`);
  };

  return (
    <div className="space-y-4 border-t bg-tertiary-50/40 p-3" data-testid="pm-release-detail">
      <div className="flex flex-wrap items-center gap-2">
        {open && r.status === 'planned' && <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => setStatus('in_progress')}>Start work</button>}
        {open && <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy} data-testid="pm-release-publish" onClick={() => setStatus('released')}>Mark released</button>}
        {open && <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => setStatus('cancelled')}>Cancel release</button>}
        <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-1 text-xs" onClick={copyNotes}><Copy className="h-3 w-3" />Copy release notes</button>
        {open && <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-danger-200 px-3 py-1 text-xs text-danger-600" disabled={busy} onClick={() => window.confirm(`Delete release ${r.version}?`) && run(() => pmApi.deleteRelease(r.id), 'Release deleted')}><Trash2 className="h-3 w-3" />Delete</button>}
        {r.released_at && <span className="text-xs text-tertiary-500">Released {when(r.released_at)}</span>}
      </div>

      {open && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-tertiary-600">Git tag<input className={`${INPUT} mt-1 w-full`} value={form.git_tag} maxLength={100} placeholder="v1.4.0" onChange={(e) => setForm((f) => ({ ...f, git_tag: e.target.value }))} /></label>
          <label className="text-xs text-tertiary-600">Release commit<input className={`${INPUT} mt-1 w-full font-mono`} value={form.commit_sha} maxLength={40} placeholder="3f9c2ab (optional)" onChange={(e) => setForm((f) => ({ ...f, commit_sha: e.target.value }))} /></label>
          <label className="text-xs text-tertiary-600 sm:col-span-3">Notes<textarea className={`${INPUT} mt-1 w-full`} rows={3} value={form.notes} maxLength={10000} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
          <div className="sm:col-span-3"><button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => run(() => pmApi.updateRelease(r.id, { git_tag: form.git_tag || null, commit_sha: form.commit_sha || null, notes: form.notes || null }), 'Saved')}>Save details</button></div>
        </div>
      )}
      {!open && r.notes && <p className="whitespace-pre-wrap text-sm text-tertiary-700">{r.notes}</p>}

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Tickets in this release ({r.tickets.length})</h4>
        {r.tickets.length === 0 ? <p className="text-xs text-tertiary-400">No tickets yet.</p> : (
          <ul className="divide-y rounded-xl border bg-white">
            {r.tickets.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-xs text-tertiary-500">{project.code}#{t.number}</span>
                <span className="flex-1">{t.title}</span>
                <Pill tone={t.done ? 'green' : 'amber'}>{t.done ? 'Done' : 'Not done'}</Pill>
                {open && <button type="button" className="text-xs text-danger-600 underline" disabled={busy} onClick={() => run(() => pmApi.setReleaseTickets(r.id, { remove: [t.id] }))}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
        {open && addable.length > 0 && (
          <select className={`${INPUT} mt-2`} value="" data-testid="pm-release-add-ticket" onChange={(e) => e.target.value && run(() => pmApi.setReleaseTickets(r.id, { add: [e.target.value] }))}>
            <option value="">Add a ticket…</option>
            {addable.map((t) => <option key={t.id} value={t.id}>{project.code}#{t.number} {t.title}</option>)}
          </select>
        )}
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Commits in this release ({r.commits.length})</h4>
        {r.commits.length === 0 ? <p className="text-xs text-tertiary-400">No commits yet. Releasing takes in every commit no release has.</p> : (
          <ul className="divide-y rounded-xl border bg-white">
            {r.commits.map((c) => (
              <div key={c.id} className="flex items-center">
                <div className="flex-1"><CommitRow c={c} project={project} /></div>
                {open && <button type="button" className="px-3 text-xs text-danger-600 underline" disabled={busy} onClick={() => run(() => pmApi.setReleaseCommits(r.id, { remove: [c.id] }))}>Remove</button>}
              </div>
            ))}
          </ul>
        )}
        {open && freeCommits.length > 0 && (
          <select className={`${INPUT} mt-2 max-w-full`} value="" onChange={(e) => e.target.value && run(() => pmApi.setReleaseCommits(r.id, { add: [e.target.value] }))}>
            <option value="">Add a commit that has no release…</option>
            {freeCommits.map((c) => <option key={c.id} value={c.id}>{c.short} {c.subject.slice(0, 70)}</option>)}
          </select>
        )}
      </section>
    </div>
  );
}

function ReleasesList({ project, canManage }) {
  const { pushError, pushSuccess } = useAlerts();
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({ version: '', name: '', planned_date: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => pmApi.releases(project.id).then(setData).catch((e) => pushError(pmError(e, 'Could not load releases'), 'Load failed')), [project.id, pushError]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p className="text-sm text-tertiary-500">Loading…</p>;

  async function create() {
    setBusy(true);
    try {
      const rel = await pmApi.createRelease(project.id, { version: draft.version.trim(), ...(draft.name.trim() ? { name: draft.name.trim() } : {}), ...(draft.planned_date ? { planned_date: draft.planned_date } : {}) });
      setDraft({ version: '', name: '', planned_date: '' });
      pushSuccess(`Release ${rel.version} created`);
      await load();
      setOpenId(rel.id);
    } catch (e) { pushError(pmError(e, 'Could not create the release'), 'Failed'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-tertiary-500">Commits waiting for a release</div><div className="text-lg font-semibold text-tertiary-900" data-testid="pm-waiting-commits">{data.waiting.commits}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-tertiary-500">Finished tickets not in a release</div><div className="text-lg font-semibold text-tertiary-900">{data.waiting.finished_tickets}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-tertiary-500">Releases</div><div className="text-lg font-semibold text-tertiary-900">{data.releases.length}</div></div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
          <label className="text-xs text-tertiary-600">Version<input className={`${INPUT} mt-1 w-32`} data-testid="pm-release-version" placeholder="1.4.0" maxLength={40} value={draft.version} onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))} /></label>
          <label className="text-xs text-tertiary-600">Name (optional)<input className={`${INPUT} mt-1 w-56`} maxLength={120} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></label>
          <label className="text-xs text-tertiary-600">Planned date<input type="date" className={`${INPUT} mt-1`} value={draft.planned_date} onChange={(e) => setDraft((d) => ({ ...d, planned_date: e.target.value }))} /></label>
          <button type="button" className="btn-primary inline-flex items-center gap-1" data-testid="pm-release-create" disabled={busy || !draft.version.trim()} onClick={create}><Plus className="h-4 w-4" />New release</button>
        </div>
      )}

      {data.releases.length === 0 ? <Empty>No releases yet. Create the first version above.</Empty> : (
        <ul className="space-y-2" data-testid="pm-releases">
          {data.releases.map((x) => (
            <li key={x.id} className="overflow-hidden rounded-xl border bg-white">
              <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left" onClick={() => setOpenId(openId === x.id ? null : x.id)}>
                {openId === x.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-semibold text-tertiary-900">{x.version}</span>
                {x.name && <span className="text-sm text-tertiary-600">{x.name}</span>}
                <Pill tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Pill>
                {x.git_tag && <span className="font-mono text-xs text-tertiary-500">{x.git_tag}</span>}
                <span className="ml-auto text-xs text-tertiary-500">{x.tickets_done}/{x.tickets} tickets done · {x.commits} commits · {x.released_at ? `released ${when(x.released_at)}` : x.planned_date ? `planned ${dateLabel(x.planned_date)}` : 'no date'}</span>
              </button>
              {openId === x.id && <ReleaseDetail project={project} releaseId={x.id} canManage={canManage} onChanged={load} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommitsList({ project, canManage }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => pmApi.commits(project.id, { limit: 300, ...(q.trim() ? { q: q.trim() } : {}), ...(only === 'free' ? { release: 'none' } : {}) }).then((r) => setRows(r.commits)).catch((e) => pushError(pmError(e, 'Could not load commits'), 'Load failed')), [project.id, q, only, pushError]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function sync() {
    setBusy(true);
    try {
      const r = await pmApi.syncCommits(project.id, {});
      pushSuccess(`${r.added} new commit(s) recorded, ${r.ticket_links} ticket link(s)`);
      await load();
    } catch (e) { pushError(pmError(e, 'Could not read the git history'), 'Sync failed'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-tertiary-600">Write <b>{project.code}#12</b> in a commit message and the commit links to ticket 12 of this project. Commits are read from git with the button, or pushed by a build step (<span className="font-mono text-xs">POST /pm/projects/{'{id}'}/commits</span>).</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${INPUT} w-64`} placeholder="Search message, author or commit id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={INPUT} value={only} onChange={(e) => setOnly(e.target.value)}><option value="all">All commits</option><option value="free">Not in a release</option></select>
        {canManage && <button type="button" className="btn-secondary inline-flex items-center gap-1" disabled={busy} data-testid="pm-commit-sync" onClick={sync}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Reading…' : 'Read from git'}</button>}
      </div>
      {!rows ? <p className="text-sm text-tertiary-500">Loading…</p> : rows.length === 0 ? <Empty>No commits recorded yet.</Empty> : (
        <ul className="divide-y rounded-xl border bg-white" data-testid="pm-commits">{rows.map((c) => <CommitRow key={c.id} c={c} project={project} />)}</ul>
      )}
    </div>
  );
}

/** Project > Releases: versions with their tickets and commits, and the commit record. */
export default function PmReleasesTab({ project }) {
  const [view, setView] = useState('releases');
  return (
    <div className="space-y-4">
      <SectionTabs tabs={[{ key: 'releases', label: 'Releases' }, { key: 'commits', label: 'Commits' }]} value={view} onChange={setView} />
      {view === 'releases' ? <ReleasesList project={project} canManage={project.can_manage} /> : <CommitsList project={project} canManage={project.can_manage} />}
      <p className="flex items-center gap-1 text-[11px] text-tertiary-400"><GitCommit className="h-3 w-3" />A released version is closed: its tickets and commits stay as they were.</p>
    </div>
  );
}
