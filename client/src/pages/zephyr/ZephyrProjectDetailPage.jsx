import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, FileText, Landmark, Layers, Pencil, Plus, Trash2, Truck, Users } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { KIND_LABEL, PROJECT_STATUSES, STATUS_META, WO_META, WO_STATUSES, rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import ZephyrDocuments from '../../components/zephyr/ZephyrDocuments.jsx';
import ZephyrProjectMoney from '../../components/zephyr/ZephyrProjectMoney.jsx';
import { ProgressBar, ProjectForm, cleanProjectBody } from './ZephyrProjectsPage.jsx';

const TABS = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'milestones', label: 'Milestones', icon: ClipboardList },
  { key: 'work_orders', label: 'Work orders', icon: Truck },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'money', label: 'Money', icon: Landmark },
];
const inputCls = 'mt-1 w-full rounded-xl border px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);

function Detail({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt className="text-xs text-tertiary-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-tertiary-900">{children}</dd>
    </div>
  );
}

function MilestonesTab({ project, canEdit, closed, apply }) {
  const [form, setForm] = useState({ name: '', due_date: '', weight: 1, billing_amount: '' });

  async function add(e) {
    e.preventDefault();
    const ok = await apply(() => zephyrApi.addMilestone(project.id, {
      name: form.name.trim(),
      due_date: form.due_date || null,
      weight: Number(form.weight || 1),
      billing_amount: form.billing_amount === '' ? null : Number(form.billing_amount),
    }), 'Milestone added');
    if (ok) setForm({ name: '', due_date: '', weight: 1, billing_amount: '' });
  }

  const editable = canEdit && !closed;
  return (
    <div className="space-y-4">
      <div className={`${card} overflow-x-auto p-0 md:p-0`}>
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
            <tr><th className="px-4 py-2.5">Milestone</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Weight</th><th className="px-4 py-2.5">% done</th><th className="px-4 py-2.5 text-right">Billing</th><th className="px-4 py-2.5">Billed</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y">
            {project.milestones.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-tertiary-400">No milestones yet. Progress is the manual figure until you add some.</td></tr>}
            {project.milestones.map((m) => {
              const overdue = m.due_date && dayOf(m.due_date) < today() && m.percent_done < 100;
              return (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 font-medium text-tertiary-900">{m.name}</td>
                  <td className={`px-4 py-2.5 ${overdue ? 'font-medium text-red-600' : 'text-tertiary-600'}`}>{m.due_date ? dateLabel(m.due_date) : '—'}{overdue ? ' · overdue' : ''}</td>
                  <td className="px-4 py-2.5 text-tertiary-600">{m.weight}</td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number" min="0" max="100" defaultValue={m.percent_done} disabled={!editable} aria-label={`${m.name} percent done`}
                      className="w-20 rounded-lg border px-2 py-1 text-sm disabled:bg-transparent"
                      onBlur={(e) => Number(e.target.value) !== m.percent_done && apply(() => zephyrApi.updateMilestone(project.id, m.id, { percent_done: Number(e.target.value) }))}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.billing_amount ? rupees(m.billing_amount) : '—'}</td>
                  <td className="px-4 py-2.5">
                    {m.billing_amount ? (
                      <label className="inline-flex items-center gap-1.5 text-xs text-tertiary-600">
                        <input type="checkbox" checked={m.billed} disabled={!editable} onChange={(e) => apply(() => zephyrApi.updateMilestone(project.id, m.id, { billed: e.target.checked }))} />
                        {m.billed ? 'Billed' : 'Not billed'}
                      </label>
                    ) : '—'}
                  </td>
                  <td className="px-2">{editable && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${m.name}`} onClick={() => apply(() => zephyrApi.deleteMilestone(project.id, m.id))}><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <form onSubmit={add} className={`${card} grid gap-3 md:grid-cols-[1.6fr_1fr_6rem_1fr_auto] md:items-end`}>
          <label className={labelCls}>New milestone<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} /></label>
          <label className={labelCls}>Due date<input type="date" className={inputCls} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
          <label className={labelCls}>Weight<input type="number" min="1" max="100" className={inputCls} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></label>
          <label className={labelCls}>Billing (INR)<input type="number" min="0" className={inputCls} value={form.billing_amount} onChange={(e) => setForm({ ...form, billing_amount: e.target.value })} /></label>
          <button type="submit" className="btn-primary inline-flex items-center justify-center gap-1"><Plus className="h-4 w-4" />Add</button>
        </form>
      )}
      <p className="text-xs text-tertiary-400">Project progress is the weight-averaged % done of its milestones. A milestone can be marked billed only at 100%.</p>
    </div>
  );
}

const WO_EMPTY = { vendor_id: '', wo_number: '', scope: '', value: '', billed_to_date: 0, status: 'draft', issued_on: '', notes: '' };

function WorkOrderForm({ initial, vendors, saving, onSubmit, onCancel }) {
  const [v, setV] = useState(() => ({ ...WO_EMPTY, ...Object.fromEntries(Object.keys(WO_EMPTY).map((k) => [k, initial?.[k] ?? WO_EMPTY[k]])), issued_on: dayOf(initial?.issued_on) }));
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          vendor_id: v.vendor_id,
          wo_number: v.wo_number.trim() || null,
          scope: v.scope.trim(),
          value: Number(v.value),
          billed_to_date: Number(v.billed_to_date || 0),
          status: v.status,
          issued_on: v.issued_on || null,
          notes: v.notes?.trim() || null,
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Vendor / subcontractor<select className={inputCls} value={v.vendor_id} onChange={set('vendor_id')} required><option value="">Select…</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className={labelCls}>Work order no.<input className={inputCls} value={v.wo_number ?? ''} onChange={set('wo_number')} placeholder="Auto if blank" maxLength={60} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Scope of work<textarea className={inputCls} rows={3} value={v.scope} onChange={set('scope')} required maxLength={1000} /></label>
        <label className={labelCls}>Value (INR)<input type="number" min="1" className={inputCls} value={v.value} onChange={set('value')} required /></label>
        <label className={labelCls}>Billed to date (INR)<input type="number" min="0" className={inputCls} value={v.billed_to_date} onChange={set('billed_to_date')} /></label>
        <label className={labelCls}>Status<select className={inputCls} value={v.status} onChange={set('status')}>{WO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className={labelCls}>Issued on<input type="date" className={inputCls} value={v.issued_on} onChange={set('issued_on')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<input className={inputCls} value={v.notes ?? ''} onChange={set('notes')} maxLength={1000} /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function WorkOrdersTab({ project, canEdit, closed, vendors, apply }) {
  const [drawer, setDrawer] = useState(null); // { wo? }
  const [saving, setSaving] = useState(false);
  const editable = canEdit && !closed;

  async function save(body) {
    setSaving(true);
    const ok = await apply(() => (drawer.wo ? zephyrApi.updateWorkOrder(project.id, drawer.wo.id, body) : zephyrApi.addWorkOrder(project.id, body)), 'Work order saved');
    setSaving(false);
    if (ok) setDrawer(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-tertiary-500">Work given to vendors and subcontractors on this project.</p>
        {editable && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({})}><Plus className="h-4 w-4" />Work order</button>}
      </div>
      <div className={`${card} overflow-x-auto p-0 md:p-0`}>
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
            <tr><th className="px-4 py-2.5">No.</th><th className="px-4 py-2.5">Vendor</th><th className="px-4 py-2.5">Scope</th><th className="px-4 py-2.5 text-right">Value</th><th className="px-4 py-2.5 text-right">Billed</th><th className="px-4 py-2.5">Status</th><th className="w-20" /></tr>
          </thead>
          <tbody className="divide-y">
            {project.work_orders.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-tertiary-400">No work orders yet.</td></tr>}
            {project.work_orders.map((w) => (
              <tr key={w.id} className={w.status === 'cancelled' ? 'opacity-50' : ''}>
                <td className="px-4 py-2.5 font-mono text-xs text-tertiary-500">{w.wo_number}</td>
                <td className="px-4 py-2.5 font-medium text-tertiary-900">{w.vendor?.name}</td>
                <td className="max-w-xs truncate px-4 py-2.5 text-tertiary-600" title={w.scope}>{w.scope}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rupees(w.value)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{rupees(w.billed_to_date)}</td>
                <td className="px-4 py-2.5"><Pill tone={WO_META[w.status]?.tone}>{WO_META[w.status]?.label}</Pill></td>
                <td className="px-2 text-right">
                  {editable && (
                    <>
                      <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" aria-label={`Edit ${w.wo_number}`} onClick={() => setDrawer({ wo: w })}><Pencil className="h-4 w-4" /></button>
                      <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Delete ${w.wo_number}`} onClick={() => apply(() => zephyrApi.deleteWorkOrder(project.id, w.id))}><Trash2 className="h-4 w-4" /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {project.work_orders.length > 0 && (
            <tfoot className="border-t bg-primary-50/40 text-sm font-medium">
              <tr><td colSpan={3} className="px-4 py-2.5 text-right text-tertiary-500">Committed (excl. cancelled)</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(project.wo_value)}</td><td className="px-4 py-2.5 text-right tabular-nums">{rupees(project.wo_billed)}</td><td colSpan={2} /></tr>
            </tfoot>
          )}
        </table>
      </div>
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.wo ? 'edit' : 'create'} title={drawer?.wo ? `Edit ${drawer.wo.wo_number}` : 'New work order'}>
        {drawer && <WorkOrderForm key={drawer.wo?.id || 'new'} initial={drawer.wo} vendors={vendors} saving={saving} onSubmit={save} onCancel={() => setDrawer(null)} />}
      </Drawer>
    </div>
  );
}

export default function ZephyrProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const [project, setProject] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parties, setParties] = useState([]);
  const [managers, setManagers] = useState([]);

  const load = useCallback(
    () => zephyrApi.project(id).then(setProject, (e) => (e?.response?.status === 404 ? setMissing(true) : pushError(zephyrError(e), 'Could not load project'))),
    [id, pushError]
  );
  useEffect(() => {
    setProject(null);
    load();
  }, [load]);
  useEffect(() => {
    zephyrApi.parties({ status: 'active', limit: 200 }).then((r) => setParties(r.data), () => setParties([]));
    zephyrApi.leadOwners().then(setManagers, () => setManagers([]));
  }, []);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'projects') || missing) return <Navigate to="/zephyr/projects" replace />;
  if (!project) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;

  const canEdit = zxCan(me, 'projectsEdit');
  const canDelete = zxCan(me, 'delete');
  const closed = project.status === 'completed' || project.status === 'cancelled';
  const vendors = parties.filter((p) => p.kind !== 'client');

  // Runs a mutation that returns the refreshed project; shows the server's reason on failure.
  async function apply(action, success) {
    try {
      const next = await action();
      if (next?.id) setProject(next);
      else await load();
      if (success) pushSuccess(success);
      return true;
    } catch (e) {
      pushError(zephyrError(e, 'Could not save'), 'Could not save');
      return false;
    }
  }

  async function saveEdit(values) {
    setSaving(true);
    const ok = await apply(() => zephyrApi.updateProject(project.id, cleanProjectBody(values)), 'Project saved');
    setSaving(false);
    if (ok) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`Delete ${project.code} ${project.name}?`)) return;
    try {
      await zephyrApi.deleteProject(project.id);
      pushSuccess('Project deleted');
      navigate('/zephyr/projects');
    } catch (e) {
      pushError(zephyrError(e, 'Could not delete'), 'Delete failed');
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <Link to="/zephyr/projects" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline"><ArrowLeft className="h-4 w-4" />All projects</Link>

      <section className={`${card} flex flex-wrap items-start justify-between gap-4`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-tertiary-500">{project.code}</span>
            <Pill tone={STATUS_META[project.status]?.tone}>{STATUS_META[project.status]?.label}</Pill>
            <Pill tone={project.kind === 'self' ? 'purple' : 'blue'}>{KIND_LABEL[project.kind]}</Pill>
          </div>
          <h2 className="mt-1 font-heading text-xl font-bold text-tertiary-900">{project.name}</h2>
          <div className="mt-1 text-sm text-tertiary-500">{[project.party?.name, project.location].filter(Boolean).join(' · ') || 'No client or location yet'}</div>
          <div className="mt-3"><ProgressBar value={project.progress} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <select aria-label="Project status" value={project.status} onChange={(e) => apply(() => zephyrApi.updateProject(project.id, { status: e.target.value }), 'Status updated')} className="rounded-xl border px-3 py-2 text-sm">
              {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
          {canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</button>}
          {canDelete && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </section>

      <SectionTabs tabs={TABS.filter((t) => t.key !== 'money' || zxCan(me, 'ledger'))} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={project.kind === 'client' ? 'Contract value' : 'Budget'} value={rupees(project.kind === 'client' ? project.contract_value : project.budget)} />
            <StatCard label="Milestone billing" value={rupees(project.billing_billed)} hint={`of ${rupees(project.billing_planned)} planned`} />
            <StatCard label="Committed to vendors" value={rupees(project.wo_value)} hint={`${rupees(project.wo_billed)} billed so far`} />
            <StatCard label="Milestones" value={`${project.milestones_done}/${project.milestones_total}`} hint={project.milestones_overdue ? `${project.milestones_overdue} overdue` : 'on track'} accent={Boolean(project.milestones_overdue)} />
          </div>
          <section className={card}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Client">{project.party?.name}</Detail>
              <Detail label="Project manager">{project.manager?.name}</Detail>
              <Detail label="Location">{project.location}</Detail>
              <Detail label="Start date">{project.start_date ? dateLabel(project.start_date) : null}</Detail>
              <Detail label="End date">{project.end_date ? dateLabel(project.end_date) : null}</Detail>
              {project.kind === 'client' && project.budget != null && <Detail label="Planned cost">{rupees(project.budget)}</Detail>}
              {project.kind === 'self' && project.contract_value != null && <Detail label="Expected sale value">{rupees(project.contract_value)}</Detail>}
              <div className="sm:col-span-2 lg:col-span-3"><Detail label="Notes"><span className="whitespace-pre-wrap">{project.notes}</span></Detail></div>
            </dl>
          </section>
        </div>
      )}
      {tab === 'milestones' && <MilestonesTab project={project} canEdit={canEdit} closed={closed} apply={apply} />}
      {tab === 'work_orders' && <WorkOrdersTab project={project} canEdit={canEdit} closed={closed} vendors={vendors} apply={apply} />}
      {tab === 'team' && (
        <section className={`${card} overflow-x-auto p-0 md:p-0`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2.5">Person</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Share of time</th><th className="px-4 py-2.5">Period</th></tr>
            </thead>
            <tbody className="divide-y">
              {project.team.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-tertiary-400">Nobody is assigned yet. Assign people from the Employee / Contractor page.</td></tr>}
              {project.team.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5"><div className="font-medium text-tertiary-900">{t.person.name}</div><div className="text-xs text-tertiary-400">{t.person.designation || t.person.kind}</div></td>
                  <td className="px-4 py-2.5 text-tertiary-600">{t.role || '—'}</td>
                  <td className="px-4 py-2.5">{t.allocation_pct}%</td>
                  <td className="px-4 py-2.5 text-tertiary-600">{t.from_date ? dateLabel(t.from_date) : 'Start'} – {t.to_date ? dateLabel(t.to_date) : 'ongoing'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === 'documents' && <section className={card}><ZephyrDocuments ownerType="project" ownerId={project.id} canEdit={canEdit} /></section>}
      {tab === 'money' && zxCan(me, 'ledger') && <ZephyrProjectMoney project={project} isAdmin={zxCan(me, 'overviewValuation')} canDelete={canDelete} onChanged={load} />}

      <Drawer open={editing} onClose={() => setEditing(false)} size="xl" tone="edit" title={`Edit ${project.code}`}>
        {editing && <ProjectForm initial={project} parties={parties} managers={managers} saving={saving} onSubmit={saveEdit} onCancel={() => setEditing(false)} hasMilestones={project.milestones.length > 0} />}
      </Drawer>
    </div>
  );
}
