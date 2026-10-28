import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LayoutGrid, Link2, List, Pencil, Plus, Star, Trash2, Unlink, UserMinus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { pmApi, pmError, PRIORITY_OPTIONS, PRIORITY_TONE, CATEGORY_TONE, PROJECT_STATUS_OPTIONS } from '../../lib/pm/api.js';
import { dateLabel, money } from '../../lib/format.js';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { ProgressBar } from './PmProjectsPage.jsx';
import TicketPanel from './TicketPanel.jsx';
import { FieldsTab, SharingTab } from './PmProjectSettingsTabs.jsx';

const INPUT = 'rounded-xl border px-3 py-2 text-sm';
const Empty = ({ children }) => <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-tertiary-500">{children}</p>;

function TicketsTab({ project, meta, reload, openTicket }) {
  const { pushError, pushSuccess } = useAlerts();
  const [rows, setRows] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('pm_ticket_view') === 'board' ? 'board' : 'list'; } catch { return 'list'; } });
  const [dragOver, setDragOver] = useState('');
  const switchView = (v) => { setView(v); try { localStorage.setItem('pm_ticket_view', v); } catch { /* storage unavailable */ } };
  const [f, setF] = useState({ category: '', assignee_membership_id: '', priority: '', overdue: '', q: '' });
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(f.q.trim()), 250); return () => clearTimeout(t); }, [f.q]);
  const load = useCallback(async () => {
    try { setRows(await pmApi.tickets(project.id, Object.fromEntries(Object.entries({ ...f, q: dq }).filter(([, v]) => v)))); } catch (e) { pushError(pmError(e, 'Could not load tickets'), 'Load failed'); setRows([]); }
  }, [project.id, f, dq, pushError]);
  useEffect(() => { load(); }, [load, project.progress.total, project.progress.done]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${INPUT} w-56`} placeholder="Search tickets..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className={INPUT} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Status group">
          <option value="">Any status</option><option value="todo">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
        </select>
        <select className={INPUT} value={f.assignee_membership_id} onChange={(e) => setF({ ...f, assignee_membership_id: e.target.value })} aria-label="Assignee">
          <option value="">Anyone</option>{project.members.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.name}</option>)}
        </select>
        <select className={INPUT} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority">
          <option value="">Any priority</option>{PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-tertiary-600"><input type="checkbox" checked={f.overdue === 'true'} onChange={(e) => setF({ ...f, overdue: e.target.checked ? 'true' : '' })} />Overdue only</label>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-xl border" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'list'} className={`inline-flex items-center gap-1 px-3 py-2 text-sm ${view === 'list' ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500'}`} onClick={() => switchView('list')}><List className="h-4 w-4" />List</button>
            <button type="button" aria-pressed={view === 'board'} className={`inline-flex items-center gap-1 border-l px-3 py-2 text-sm ${view === 'board' ? 'bg-primary-50 text-primary-700' : 'text-tertiary-500'}`} onClick={() => switchView('board')}><LayoutGrid className="h-4 w-4" />Board</button>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => openTicket(null)}><Plus className="h-4 w-4" />New ticket</button>
        </div>
      </div>
      {rows !== null && view === 'board' && (
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="pm-board">
          {meta.statuses.filter((s) => s.is_active).map((s) => {
            const cards = rows.filter((t) => t.status_key === s.key);
            return (
              <section key={s.key} data-testid={`pm-col-${s.key}`}
                className={`w-64 shrink-0 rounded-xl border p-2 ${dragOver === s.key ? 'border-primary-400 bg-primary-50/40' : 'bg-tertiary-50/60'}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }} onDragLeave={() => setDragOver('')}
                onDrop={async (e) => {
                  e.preventDefault(); setDragOver('');
                  const id = e.dataTransfer.getData('text/plain');
                  const t = rows.find((r) => r.id === id);
                  if (!t || t.status_key === s.key) return;
                  if (s.category === 'done') { openTicket(id, s.key); return; } // a done status needs its resolution written first
                  try { await pmApi.updateTicket(id, { status_key: s.key }); pushSuccess(`Moved to ${s.label}`); await load(); reload(); } catch (err) { pushError(pmError(err, 'Could not move the ticket'), 'Failed'); }
                }}>
                <h4 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-tertiary-700">{s.label}<span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-tertiary-500">{cards.length}</span></h4>
                <div className="space-y-2">
                  {cards.map((t) => (
                    <article key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} onClick={() => openTicket(t.id)} data-testid={`pm-card-${t.number}`}
                      className="cursor-grab rounded-lg border bg-white p-2 text-sm shadow-sm hover:border-primary-300">
                      <div className="flex items-center justify-between text-[11px] text-tertiary-400"><span>#{t.number} · {t.type}</span><Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill></div>
                      <div className="mt-1 font-medium text-tertiary-900">{t.title}</div>
                      <div className="mt-1 flex items-center justify-between text-xs text-tertiary-500"><span>{t.assignee?.name || 'Unassigned'}</span><span className={t.overdue ? 'font-medium text-danger-600' : ''}>{t.due_date ? dateLabel(t.due_date) : ''}</span></div>
                    </article>
                  ))}
                  {cards.length === 0 && <p className="px-1 py-3 text-center text-xs text-tertiary-400">Drop a ticket here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {view === 'list' && (rows === null ? <Skeleton className="h-40" /> : rows.length === 0 ? <Empty>No tickets match.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[48rem] text-sm" data-testid="pm-tickets-table">
            <thead className="bg-primary-50/60 text-xs text-tertiary-500"><tr><th className="px-3 py-2 text-left font-medium">#</th><th className="px-3 py-2 text-left font-medium">Title</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Priority</th><th className="px-3 py-2 text-left font-medium">Assignee</th><th className="px-3 py-2 text-left font-medium">Due</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t hover:bg-primary-50/30" onClick={() => openTicket(t.id)}>
                  <td className="px-3 py-2 text-xs text-tertiary-500">{t.number}</td>
                  <td className="px-3 py-2 font-medium">{t.title}<span className="ml-2 text-xs font-normal text-tertiary-400">{t.type}</span></td>
                  <td className="px-3 py-2"><Pill tone={CATEGORY_TONE[t.category]}>{t.status_label}</Pill></td>
                  <td className="px-3 py-2"><Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill></td>
                  <td className="px-3 py-2">{t.assignee?.name || <span className="text-tertiary-400">Unassigned</span>}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-xs ${t.overdue ? 'font-medium text-danger-600' : ''}`}>{t.due_date ? dateLabel(t.due_date) : '-'}{t.overdue ? ' (overdue)' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {view === 'board' && rows === null && <Skeleton className="h-40" />}
    </div>
  );
}

function MembersTab({ project, people, reload }) {
  const { pushError, pushSuccess } = useAlerts();
  const [pick, setPick] = useState('');
  const memberIds = new Set(project.members.map((m) => m.membership_id));
  async function act(body, ok) {
    try { await pmApi.members(project.id, body); pushSuccess(ok); setPick(''); await reload(); } catch (e) { pushError(pmError(e, 'Could not update the team'), 'Failed'); }
  }
  return (
    <div className="space-y-3">
      {project.can_manage && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={INPUT} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a person">
            <option value="">Add a person...</option>{people.filter((p) => !memberIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="btn-primary" disabled={!pick} onClick={() => act({ add: [pick] }, 'Added to the project')}>Add</button>
        </div>
      )}
      <ul className="divide-y rounded-xl border bg-white" data-testid="pm-members">
        {project.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>{m.name} {m.membership_id === project.owner?.id && <Pill tone="purple">Owner</Pill>} {m.role === 'lead' && m.membership_id !== project.owner?.id && <Pill tone="blue">Lead</Pill>}</span>
            {project.can_manage && m.membership_id !== project.owner?.id && (
              <span className="flex gap-1">
                {m.role !== 'lead' && <button type="button" className="rounded p-1 text-xs text-tertiary-500 hover:bg-primary-50" onClick={() => act({ add: [m.membership_id], leads: [m.membership_id] }, 'Made lead')}>Make lead</button>}
                <button type="button" title="Remove" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => act({ remove: [m.membership_id] }, 'Removed')}><UserMinus className="h-4 w-4" /></button>
              </span>
            )}
          </li>
        ))}
        {project.members.length === 0 && <li className="px-3 py-6 text-center text-sm text-tertiary-500">No members yet.</li>}
      </ul>
    </div>
  );
}

function ContractsTab({ project, isManager, reload }) {
  const { pushError, pushSuccess } = useAlerts();
  const [open, setOpen] = useState(false);
  const [linkable, setLinkable] = useState([]);
  const [pick, setPick] = useState('');
  useEffect(() => { if (open) pmApi.linkableContracts().then(setLinkable).catch(() => setLinkable([])); }, [open]);
  async function act(fn, ok) { try { await fn(); pushSuccess(ok); await reload(); } catch (e) { pushError(pmError(e, 'Could not update'), 'Failed'); } }
  return (
    <div className="space-y-3">
      <p className="text-sm text-tertiary-600">Tickets work without a contract. Link one (or several) whenever the project is tied to actual work, and its progress shows next to the contract&apos;s own figure.</p>
      {project.can_manage && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setOpen(true)}><Link2 className="h-4 w-4" />Link a contract</button>}
      {project.contracts.length === 0 ? <Empty>No contract linked yet.</Empty> : (
        <div className="space-y-3" data-testid="pm-contracts">
          {project.contracts.map((c) => (
            <section key={c.contract_id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-medium text-tertiary-900">{c.title} {c.is_primary && <Pill tone="purple">Primary</Pill>}</h4>
                  <p className="text-xs text-tertiary-500">{c.counterparty_name} · {c.status} · {c.currency ? money(c.value, c.currency) : '-'} · billed {c.currency ? money(c.billed_to_date, c.currency) : '-'}</p>
                </div>
                {project.can_manage && (
                  <div className="flex gap-1">
                    {!c.is_primary && <button type="button" title="Make primary" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => act(() => pmApi.makePrimary(project.id, c.contract_id), 'Primary contract changed')}><Star className="h-4 w-4" /></button>}
                    <button type="button" title="Unlink" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => window.confirm('Unlink this contract? Its tickets stay, just untagged.') && act(() => pmApi.unlinkContract(project.id, c.contract_id), 'Contract unlinked')}><Unlink className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div><div className="mb-1 text-xs text-tertiary-500">Contract&apos;s own progress (manual)</div><ProgressBar percent={c.manual_progress_percent ?? 0} /><div className="mt-1 text-xs">{c.manual_progress_percent ?? 0}%</div></div>
                <div><div className="mb-1 text-xs text-tertiary-500">From tickets ({c.ticket_progress.done} of {c.ticket_progress.total} done{c.ticket_progress.overdue ? `, ${c.ticket_progress.overdue} overdue` : ''})</div><ProgressBar percent={c.ticket_progress.percent} /><div className="mt-1 text-xs">{c.ticket_progress.percent}%</div></div>
              </div>
              {isManager && c.ticket_progress.percent !== c.manual_progress_percent && (
                <button type="button" className="mt-3 text-xs text-primary-700 hover:underline" onClick={() => window.confirm(`Set the contract's own progress to ${c.ticket_progress.percent}%?`) && act(() => pmApi.copyProgress(project.id, c.contract_id), 'Contract progress updated')}>Use the ticket figure ({c.ticket_progress.percent}%) as the contract&apos;s progress</button>
              )}
            </section>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Link a contract">
        <div className="space-y-3">
          <select className={`${INPUT} w-full`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Contract">
            <option value="">Choose a contract...</option>{linkable.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.counterparty_name}</option>)}
          </select>
          {linkable.length === 0 && <p className="text-xs text-tertiary-500">No unlinked draft or active contract is available.</p>}
          <div className="flex justify-end gap-2"><button type="button" className="rounded-xl border px-3 py-2 text-sm" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn-primary" disabled={!pick} onClick={() => act(async () => { await pmApi.linkContract(project.id, { contract_id: pick }); setOpen(false); setPick(''); }, 'Contract linked')}>Link</button></div>
        </div>
      </Modal>
    </div>
  );
}

function ActivityTab({ project }) {
  if (!project.activity.length) return <Empty>No project-level changes yet.</Empty>;
  return <ul className="space-y-1 rounded-xl border bg-white p-4 text-sm">{project.activity.map((a) => <li key={a.id}>{a.action.replace(/_/g, ' ')}{a.to_value ? `: ${a.to_value}` : ''} <span className="text-xs text-tertiary-400">({dateLabel(a.created_at)})</span></li>)}</ul>;
}

export default function PmProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { pushError, pushSuccess } = useAlerts();
  const [project, setProject] = useState(null);
  const [meta, setMeta] = useState(null);
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState('tickets');
  const [panel, setPanel] = useState({ open: false, ticketId: null, presetStatus: null });
  const [edit, setEdit] = useState(false);
  const [missing, setMissing] = useState(false);
  const [bump, setBump] = useState(0);

  const reload = useCallback(async () => {
    try { setProject(await pmApi.project(id)); } catch (e) { if (e?.response?.status === 404) setMissing(true); else pushError(pmError(e, 'Could not load the project'), 'Load failed'); }
  }, [id, pushError]);
  useEffect(() => { reload(); pmApi.meta().then(setMeta).catch(() => {}); pmApi.people().then(setPeople).catch(() => setPeople([])); }, [reload]);
  useEffect(() => { const t = sp.get('ticket'); if (t) setPanel({ open: true, ticketId: t }); }, [sp]);

  if (missing) return <Empty>This project does not exist, or you are not a member of it. <Link to="/pm" className="text-primary-700 underline">Back to projects</Link></Empty>;
  if (!project || !meta) return <Skeleton className="h-64" />;

  const tabs = [{ key: 'tickets', label: `Tickets (${project.progress.total})` }, { key: 'members', label: `Team (${project.members.length})` }, { key: 'contracts', label: `Contracts (${project.contracts.length})` }, { key: 'fields', label: `Fields (${project.fields.filter((f) => f.is_active).length})` }, ...(project.can_manage ? [{ key: 'sharing', label: 'Sharing' }] : []), { key: 'activity', label: 'Activity' }];
  const closePanel = () => { setPanel({ open: false, ticketId: null, presetStatus: null }); if (sp.get('ticket')) setSp({}, { replace: true }); };

  return (
    <div className="space-y-4">
      <Link to="/pm" className="inline-flex items-center gap-1 text-sm text-tertiary-500 hover:text-tertiary-700"><ArrowLeft className="h-4 w-4" />All projects</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-tertiary-900">{project.name} <span className="text-sm font-normal text-tertiary-400">{project.code}</span></h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tertiary-600"><Pill value={project.status} />{project.owner && <span>Owner: {project.owner.name}</span>}{project.start_date && <span>{dateLabel(project.start_date)}{project.end_date ? ` → ${dateLabel(project.end_date)}` : ''}</span>}</p>
          {project.description && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-tertiary-600">{project.description}</p>}
        </div>
        <div className="flex gap-2">
          {project.can_manage && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit project</button>}
          {meta.is_manager && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm text-danger-600 hover:bg-danger-50" onClick={async () => { if (!window.confirm('Delete this project with all its tickets? This cannot be undone.')) return; try { await pmApi.deleteProject(id); pushSuccess('Project deleted'); navigate('/pm'); } catch (e) { pushError(pmError(e, 'Could not delete'), 'Failed'); } }}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[['Progress', `${project.progress.percent}%`], ['Open', project.progress.open], ['Blocked', project.progress.blocked], ['Overdue', project.progress.overdue]].map(([l, v]) => (
          <div key={l} className="rounded-xl border bg-white p-3"><div className="text-xs text-tertiary-500">{l}</div><div className="text-lg font-semibold text-tertiary-900">{v}</div>{l === 'Progress' && <ProgressBar percent={project.progress.percent} className="mt-2" />}</div>
        ))}
      </div>
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'tickets' && <TicketsTab key={bump} project={project} meta={meta} reload={reload} openTicket={(tid, presetStatus) => setPanel({ open: true, ticketId: tid, presetStatus })} />}
      {tab === 'members' && <MembersTab project={project} people={people} reload={reload} />}
      {tab === 'contracts' && <ContractsTab project={project} isManager={meta.is_manager} reload={reload} />}
      {tab === 'fields' && <FieldsTab project={project} reload={reload} />}
      {tab === 'sharing' && project.can_manage && <SharingTab project={project} />}
      {tab === 'activity' && <ActivityTab project={project} />}
      <TicketPanel open={panel.open} ticketId={panel.ticketId} presetStatus={panel.presetStatus} project={project} meta={meta} canManage={project.can_manage} onClose={closePanel} onChanged={() => { reload(); setBump((b) => b + 1); }} />
      <FormDrawer
        open={edit}
        title="Edit project"
        tone="edit"
        size="lg"
        initial={{ name: project.name, code: project.code, status: project.status, owner_membership_id: project.owner?.id || '', start_date: project.start_date || '', end_date: project.end_date || '', description: project.description || '' }}
        onClose={() => setEdit(false)}
        fields={[
          { name: 'name', label: 'Project name', required: true },
          { name: 'code', label: 'Code' },
          { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS_OPTIONS, half: true },
          { name: 'owner_membership_id', label: 'Owner', type: 'search', options: people.map((p) => ({ value: p.id, label: p.name })), half: true },
          { name: 'start_date', label: 'Start date', type: 'date', half: true },
          { name: 'end_date', label: 'End date', type: 'date', half: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ]}
        onSubmit={async (v) => {
          // FormDrawer drops empty fields; for these an empty box means "clear it"
          const body = { ...v };
          for (const k of ['owner_membership_id', 'start_date', 'end_date', 'description']) if (!(k in body)) body[k] = null;
          try { await pmApi.updateProject(id, body); pushSuccess('Project saved'); setEdit(false); await reload(); } catch (e) { pushError(pmError(e, 'Could not save the project'), 'Could not save'); throw e; }
        }}
      />
    </div>
  );
}
