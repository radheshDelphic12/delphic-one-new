import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { pmApi, pmError, PROJECT_STATUS_OPTIONS, PRIORITY_TONE, CATEGORY_TONE } from '../../lib/pm/api.js';
import { dateLabel } from '../../lib/format.js';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

export function ProgressBar({ percent = 0, className = '' }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-tertiary-100 ${className}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary-600" style={{ width: `${percent}%` }} />
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-tertiary-500">{children}</p>;
}

const INPUT = 'rounded-xl border px-3 py-2 text-sm';

function ProjectsList({ reloadRef }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ status: '', linked: '', q: '' });
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(f.q.trim()), 250); return () => clearTimeout(t); }, [f.q]);
  const load = useCallback(async () => {
    try {
      setRows(await pmApi.projects(Object.fromEntries(Object.entries({ status: f.status, linked: f.linked, q: dq }).filter(([, v]) => v))));
    } catch (e) { pushError(pmError(e, 'Could not load projects'), 'Load failed'); setRows([]); }
  }, [f.status, f.linked, dq, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { reloadRef.current = load; }, [reloadRef, load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" />
          <input className={`${INPUT} w-64 pl-9`} placeholder="Search name or code..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </div>
        <select className={INPUT} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {PROJECT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={INPUT} value={f.linked} onChange={(e) => setF({ ...f, linked: e.target.value })} aria-label="Contract">
          <option value="">With or without contract</option>
          <option value="true">Linked to a contract</option>
          <option value="false">No contract yet</option>
        </select>
      </div>
      {rows === null ? <Skeleton className="h-40" /> : rows.length === 0 ? <Empty>No projects yet.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[52rem] text-sm" data-testid="pm-projects-table">
            <thead className="bg-primary-50/60 text-xs text-tertiary-500">
              <tr><th className="px-3 py-2 text-left font-medium">Project</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Owner</th><th className="px-3 py-2 text-left font-medium">Dates</th><th className="px-3 py-2 text-left font-medium">Tickets</th><th className="px-3 py-2 text-left font-medium">Progress</th><th className="px-3 py-2 text-left font-medium">Contract</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t hover:bg-primary-50/30">
                  <td className="px-3 py-2"><Link to={`/pm/projects/${p.id}`} className="font-medium text-primary-700 hover:underline">{p.name}</Link><div className="text-xs text-tertiary-400">{p.code}</div></td>
                  <td className="px-3 py-2"><Pill value={p.status} /></td>
                  <td className="px-3 py-2">{p.owner?.name || '-'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-tertiary-600">{p.start_date ? dateLabel(p.start_date) : '-'}{p.end_date ? ` → ${dateLabel(p.end_date)}` : ''}</td>
                  <td className="px-3 py-2 text-xs">{p.progress.total} total · {p.progress.open} open{p.progress.overdue ? <span className="text-danger-600"> · {p.progress.overdue} overdue</span> : null}{p.progress.blocked ? <span className="text-amber-700"> · {p.progress.blocked} blocked</span> : null}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><ProgressBar percent={p.progress.percent} className="w-24" /><span className="text-xs text-tertiary-600">{p.progress.percent}%</span></div></td>
                  <td className="px-3 py-2 text-xs">{p.contracts_linked ? <Pill tone="green">{p.contracts_linked} linked</Pill> : <span className="text-tertiary-400">Not linked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MyTickets() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  useEffect(() => { pmApi.myTickets().then(setRows).catch((e) => { pushError(pmError(e, 'Could not load your tickets'), 'Load failed'); setRows([]); }); }, [pushError]);
  if (rows === null) return <Skeleton className="h-40" />;
  if (!rows.length) return <Empty>Nothing assigned to you right now.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[40rem] text-sm" data-testid="pm-my-tickets">
        <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><th className="px-3 py-2 text-left font-medium">Ticket</th><th className="px-3 py-2 text-left font-medium">Project</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Priority</th><th className="px-3 py-2 text-left font-medium">Due</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t">
              <td className="px-3 py-2"><Link to={`/pm/projects/${t.project.id}?ticket=${t.id}`} className="font-medium text-primary-700 hover:underline">#{t.number} {t.title}</Link></td>
              <td className="px-3 py-2 text-xs">{t.project.code} · {t.project.name}</td>
              <td className="px-3 py-2"><Pill tone={CATEGORY_TONE[t.category]}>{t.status_label}</Pill></td>
              <td className="px-3 py-2"><Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill></td>
              <td className={`px-3 py-2 text-xs ${t.overdue ? 'font-medium text-danger-600' : ''}`}>{t.due_date ? dateLabel(t.due_date) : '-'}{t.overdue ? ' (overdue)' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CATEGORY_LABEL = { todo: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Done (counts as finished)' };

function StatusSettings({ meta, reload }) {
  const { pushError, pushSuccess } = useAlerts();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ key: '', label: '', category: 'in_progress' });
  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); pushSuccess(ok); await reload(); } catch (e) { pushError(pmError(e, 'Could not save'), 'Save failed'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-tertiary-600">Ticket statuses used by every project. &ldquo;Done&rdquo; statuses count as finished work in the progress bars and need a resolution note. Rename, reorder or switch statuses off here.</p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[36rem] text-sm" data-testid="pm-statuses">
          <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><th className="px-3 py-2 text-left font-medium">Name</th><th className="px-3 py-2 text-left font-medium">Key</th><th className="px-3 py-2 text-left font-medium">Meaning</th><th className="px-3 py-2 text-left font-medium">Order</th><th className="px-3 py-2 text-left font-medium">Active</th></tr></thead>
          <tbody>
            {meta.statuses.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-2"><input className={`${INPUT} w-44`} defaultValue={s.label} onBlur={(e) => e.target.value.trim() && e.target.value !== s.label && run(() => pmApi.updateStatus(s.id, { label: e.target.value.trim() }), 'Renamed')} disabled={busy} /></td>
                <td className="px-3 py-2 text-xs text-tertiary-500">{s.key}</td>
                <td className="px-3 py-2">
                  <select className={INPUT} value={s.category} disabled={busy} onChange={(e) => run(() => pmApi.updateStatus(s.id, { category: e.target.value }), 'Updated')}>
                    {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2"><input type="number" min="0" className={`${INPUT} w-20`} defaultValue={s.position} onBlur={(e) => Number(e.target.value) !== s.position && run(() => pmApi.updateStatus(s.id, { position: Number(e.target.value) }), 'Reordered')} disabled={busy} /></td>
                <td className="px-3 py-2"><input type="checkbox" checked={s.is_active} disabled={busy} onChange={(e) => run(() => pmApi.updateStatus(s.id, { is_active: e.target.checked }), e.target.checked ? 'Switched on' : 'Switched off')} aria-label={`${s.label} active`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await pmApi.createStatus(draft); setDraft({ key: '', label: '', category: 'in_progress' }); }, 'Status added'); }}>
        <label className="text-xs text-tertiary-500">Name<input className={`${INPUT} mt-1 block w-44`} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value, key: draft.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })} required /></label>
        <label className="text-xs text-tertiary-500">Key<input className={`${INPUT} mt-1 block w-36`} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} required pattern="[a-z0-9_]{2,40}" /></label>
        <label className="text-xs text-tertiary-500">Meaning
          <select className={`${INPUT} mt-1 block`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Add status</button>
      </form>
    </div>
  );
}

export default function PmProjectsPage() {
  const { pushError, pushSuccess } = useAlerts();
  const [tab, setTab] = useState('projects');
  const [meta, setMeta] = useState(null);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const refreshRef = useRef(null);

  const loadMeta = useCallback(() => pmApi.meta().then(setMeta).catch((e) => pushError(pmError(e, 'Could not load'), 'Load failed')), [pushError]);
  useEffect(() => { loadMeta(); pmApi.people().then(setPeople).catch(() => setPeople([])); }, [loadMeta]);

  const personOptions = people.map((p) => ({ value: p.id, label: p.name }));
  const tabs = [{ key: 'projects', label: 'Projects' }, { key: 'mine', label: 'My tickets' }, ...(meta?.is_manager ? [{ key: 'statuses', label: 'Ticket statuses' }] : [])];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-tertiary-900">Project Management</h1>
          <p className="text-sm text-tertiary-500">Projects with their own tickets. A project can be linked to a contract any time later.</p>
        </div>
        {meta?.is_manager && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New project</button>}
      </div>
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />
      {!meta ? <Skeleton className="h-40" /> : (
        <>
          {tab === 'projects' && <ProjectsList reloadRef={refreshRef} />}
          {tab === 'mine' && <MyTickets />}
          {tab === 'statuses' && meta.is_manager && <StatusSettings meta={meta} reload={loadMeta} />}
        </>
      )}
      <FormDrawer
        open={open}
        title="New project"
        size="lg"
        onClose={() => setOpen(false)}
        fields={[
          { name: 'name', label: 'Project name', required: true },
          { name: 'code', label: 'Code (optional, e.g. WEB-1)', hint: 'Left empty, the next PRJ number is used.' },
          { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS_OPTIONS, default: 'planning', half: true },
          { name: 'owner_membership_id', label: 'Owner', type: 'search', options: personOptions, half: true },
          { name: 'start_date', label: 'Start date', type: 'date', half: true },
          { name: 'end_date', label: 'End date', type: 'date', half: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ]}
        onSubmit={async (v) => {
          try {
            await pmApi.createProject(v);
            pushSuccess('Project created');
            setOpen(false);
            refreshRef.current?.();
          } catch (e) { pushError(pmError(e, 'Could not create the project'), 'Could not save'); throw e; }
        }}
      />
    </div>
  );
}
