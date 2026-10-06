import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, Pencil, Play, Plus, RotateCcw, Search, Trash2, XCircle } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { PAYMENT_METHODS, PRIORITY_TONE, TASK_STATUS_META, TASK_TYPES, TASK_TYPE_LABEL } from '../../lib/zephyr/propertyMeta.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { Detail, Section, dayOf, inputCls, labelCls, toBody, today, useDebounced } from '../../components/zephyr/formKit.jsx';

const VIEWS = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
  { key: '', label: 'All' },
];

function TaskForm({ initial, people, properties, projects, dues, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({
    title: initial?.title || '', task_type: initial?.task_type || 'visit_property', person_id: initial?.person_id || '', property_id: initial?.property_id || '', project_id: initial?.project_id || '',
    rent_due_id: initial?.rent_due_id || '', due_date: dayOf(initial?.due_date), priority: initial?.priority || 'normal', amount: initial?.amount ?? '', description: initial?.description || '', notes: initial?.notes || '',
  });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const rentDues = dues.filter((d) => !v.property_id || d.property_id === v.property_id);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(toBody(v, { numbers: ['amount'] })); }} className="space-y-4">
      <Section title="Task">
        <label className={`${labelCls} sm:col-span-2`}>What needs doing<input className={inputCls} value={v.title} onChange={set('title')} required maxLength={200} autoFocus placeholder="Collect October rent from Shop 4" /></label>
        <label className={labelCls}>Task type<select className={inputCls} value={v.task_type} onChange={set('task_type')}>{TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label className={labelCls}>Assigned to<select className={inputCls} value={v.person_id} onChange={set('person_id')}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}</select></label>
        <label className={labelCls}>Due date<input type="date" className={inputCls} value={v.due_date} onChange={set('due_date')} /></label>
        <label className={labelCls}>Priority<select className={inputCls} value={v.priority} onChange={set('priority')}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        <label className={labelCls}>Property (optional)<select className={inputCls} value={v.property_id} onChange={set('property_id')}><option value="">None</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={labelCls}>Project (optional)<select className={inputCls} value={v.project_id} onChange={set('project_id')}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        {v.task_type === 'collect_rent' && (
          <label className={`${labelCls} sm:col-span-2`}>Rent to collect<select className={inputCls} value={v.rent_due_id} onChange={set('rent_due_id')}><option value="">Not linked</option>{rentDues.map((d) => <option key={d.id} value={d.id}>{d.tenant.name} · {d.property.name} / {d.unit.name} · {d.period} · balance {rupees(d.balance)}</option>)}</select></label>
        )}
        <label className={labelCls}>Amount (₹, if any)<input type="number" min="0" className={inputCls} value={v.amount} onChange={set('amount')} /></label>
        <label className={`${labelCls} sm:col-span-2`}>Details<textarea className={inputCls} rows={3} value={v.description} onChange={set('description')} maxLength={2000} /></label>
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save task'}</button>
      </div>
    </form>
  );
}

function CompleteForm({ task, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ completed_on: today(), notes: '', collect: Boolean(task.rent_due_id), amount: task.amount ?? '', method: 'cash', reference: '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          completed_on: v.completed_on,
          ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
          ...(v.collect && task.rent_due_id ? { payment: { amount: Number(v.amount), paid_on: v.completed_on, method: v.method, ...(v.reference.trim() ? { reference: v.reference.trim() } : {}) } } : {}),
        });
      }}
      className="space-y-4"
    >
      <Section title="Complete task">
        <label className={labelCls}>Completed on<input type="date" className={inputCls} max={today()} value={v.completed_on} onChange={set('completed_on')} required /></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} /></label>
        {task.rent_due_id && (
          <>
            <label className="flex items-center gap-2 text-sm text-tertiary-800 sm:col-span-2"><input type="checkbox" checked={v.collect} onChange={(e) => setV({ ...v, collect: e.target.checked })} />I collected the rent: record the payment now</label>
            {v.collect && (
              <>
                <label className={labelCls}>Amount collected (₹)<input type="number" min="1" className={inputCls} value={v.amount} onChange={set('amount')} required /></label>
                <label className={labelCls}>Method<select className={inputCls} value={v.method} onChange={set('method')}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
                <label className={`${labelCls} sm:col-span-2`}>Reference number<input className={inputCls} value={v.reference} onChange={set('reference')} maxLength={120} /></label>
              </>
            )}
          </>
        )}
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Mark completed'}</button>
      </div>
    </form>
  );
}

export default function ZephyrTasksPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const [view, setView] = useState('open');
  const [filters, setFilters] = useState({ person_id: '', property_id: '', task_type: '', priority: '' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [people, setPeople] = useState([]);
  const [properties, setProperties] = useState([]);
  const [projects, setProjects] = useState([]);
  const [dues, setDues] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);

  const all = zxCan(me, 'tasksAll');
  const isAdmin = zxCan(me, 'settings');
  const canDelete = zxCan(me, 'delete');

  const load = useCallback(async () => {
    const params = { ...(view ? { status: view } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, x]) => x)), ...(dq ? { q: dq } : {}) };
    try {
      const [list, sum] = await Promise.all([zephyrApi.tasks(params), zephyrApi.taskSummary()]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      pushError(zephyrError(e, 'Could not load tasks'), 'Load failed');
    }
  }, [view, filters, dq, pushError]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!all) return;
    zephyrApi.people({ status: 'active' }).then(setPeople, () => setPeople([]));
    if (zxCan(me, 'properties')) zephyrApi.properties({}).then(setProperties, () => setProperties([]));
    if (zxCan(me, 'projects')) zephyrApi.projects({ status: 'open' }).then(setProjects, () => setProjects([]));
    if (zxCan(me, 'rent')) zephyrApi.rentDues({ month: new Date().toISOString().slice(0, 7), status: '' }).then((d) => setDues(d.filter((x) => x.balance > 0)), () => setDues([]));
  }, [all, me]);

  const task = drawer?.task;
  const current = useMemo(() => (task ? rows.find((r) => r.id === task.id) || task : null), [rows, task]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'tasks')) return <Navigate to="/zephyr" replace />;

  async function run(action, success, fail = 'Could not save') {
    setSaving(true);
    try {
      const result = await action();
      if (success) pushSuccess(success);
      await load();
      return result;
    } catch (e) {
      pushError(zephyrError(e, fail), fail);
      return null;
    } finally {
      setSaving(false);
    }
  }
  const close = () => setDrawer(null);
  const keep = (saved) => saved && setDrawer({ kind: 'view', task: saved });

  async function save(values) {
    const saved = await run(() => (drawer.task ? zephyrApi.updateTask(drawer.task.id, values) : zephyrApi.createTask(values)), drawer.task ? 'Task saved' : 'Task created');
    keep(saved);
  }
  const start = async () => keep(await run(() => zephyrApi.setTaskStatus(current.id, { status: 'in_progress' }), 'Task started'));
  const complete = async (body) => keep(await run(() => zephyrApi.completeTask(current.id, body), body.payment ? 'Completed and rent recorded' : 'Task completed'));
  async function cancel() {
    if (window.confirm('Cancel this task?')) keep(await run(() => zephyrApi.setTaskStatus(current.id, { status: 'cancelled' }), 'Task cancelled'));
  }
  async function reopen() {
    const reason = window.prompt('Why is this task being reopened?');
    if (reason?.trim()) keep(await run(() => zephyrApi.reopenTask(current.id, reason.trim()), 'Task reopened'));
  }
  async function remove() {
    if (window.confirm(`Delete ${current.code}?`) && (await run(() => zephyrApi.deleteTask(current.id), 'Task deleted'))) close();
  }

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const columns = [
    { key: 'code', header: 'ID', render: (r) => <span className="font-mono text-xs text-tertiary-500">{r.code}</span> },
    { key: 'title', header: 'Task', render: (r) => <span><span className="font-medium text-tertiary-900">{r.title}</span><span className="block text-xs text-tertiary-500">{TASK_TYPE_LABEL[r.task_type]}</span></span> },
    { key: 'person', header: 'Assigned to', render: (r) => r.person?.name || '—' },
    { key: 'where', header: 'Property / project', render: (r) => [r.property?.name, r.unit?.name, r.project?.code].filter(Boolean).join(' · ') || '—' },
    { key: 'due', header: 'Due', render: (r) => (r.due_date ? <span className={r.overdue ? 'font-medium text-red-600' : ''}>{dateLabel(r.due_date)}{r.overdue ? ' · overdue' : ''}</span> : '—') },
    { key: 'priority', header: 'Priority', render: (r) => <Pill tone={PRIORITY_TONE[r.priority]}>{r.priority}</Pill> },
    { key: 'amount', header: 'Amount', render: (r) => (r.amount ? <span className="tabular-nums">{rupees(r.amount)}</span> : '—') },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={TASK_STATUS_META[r.status]?.tone}>{TASK_STATUS_META[r.status]?.label}</Pill> },
  ];
  const open = current && ['pending', 'in_progress'].includes(current.status);

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending" value={summary?.pending ?? '—'} />
        <StatCard label="In progress" value={summary?.in_progress ?? '—'} />
        <StatCard label="Overdue" value={summary?.overdue ?? 0} tone={summary?.overdue ? 'danger' : undefined} />
        <StatCard label="Completed this month" value={summary?.completed_this_month ?? 0} hint={summary?.open_amount ? `${rupees(summary.open_amount)} of open tasks carry an amount` : undefined} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-xl border bg-white text-sm" role="tablist">
          {VIEWS.map((x) => <button key={x.key || 'all'} type="button" role="tab" aria-selected={view === x.key} onClick={() => setView(x.key)} className={`px-3 py-1.5 ${view === x.key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-primary-50'}`}>{x.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" className="w-44 rounded-xl border py-1.5 pl-9 pr-3 text-sm" /></div>
          {all && <select value={filters.person_id} onChange={setFilter('person_id')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Assigned to"><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          {all && properties.length > 0 && <select value={filters.property_id} onChange={setFilter('property_id')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Property"><option value="">All properties</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <select value={filters.task_type} onChange={setFilter('task_type')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Task type"><option value="">All types</option>{TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          <select value={filters.priority} onChange={setFilter('priority')} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Priority"><option value="">Any priority</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
          {all && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'form' })}><Plus className="h-4 w-4" />New task</button>}
        </div>
      </div>

      <DataTable columns={columns} rows={rows} emptyLabel={all ? 'No tasks here. Create one to send someone to a property or to collect rent.' : 'Nothing is assigned to you right now.'} onRowClick={(r) => setDrawer({ kind: 'view', task: r })} maxHeight="62vh" />

      <Drawer open={Boolean(drawer)} onClose={close} size="xl" tone={drawer?.kind === 'form' ? (drawer.task ? 'edit' : 'create') : 'default'} title={drawer?.kind === 'form' ? (drawer.task ? `Edit ${drawer.task.code}` : 'New task') : drawer?.kind === 'complete' ? 'Complete task' : current?.title || ''}>
        {drawer?.kind === 'form' && <TaskForm initial={drawer.task} people={people} properties={properties} projects={projects} dues={dues} saving={saving} onSubmit={save} onCancel={() => setDrawer(drawer.task ? { kind: 'view', task: drawer.task } : null)} />}
        {drawer?.kind === 'complete' && current && <CompleteForm task={current} saving={saving} onSubmit={complete} onCancel={() => setDrawer({ kind: 'view', task: current })} />}
        {drawer?.kind === 'view' && current && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-2"><Pill tone={TASK_STATUS_META[current.status]?.tone}>{TASK_STATUS_META[current.status]?.label}</Pill><Pill tone={PRIORITY_TONE[current.priority]}>{current.priority} priority</Pill>{current.overdue && <Pill tone="red">Overdue</Pill>}<span className="font-mono text-xs text-tertiary-400">{current.code}</span></span>
              <span className="inline-flex flex-wrap gap-2">
                {open && current.status === 'pending' && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" disabled={saving} onClick={start}><Play className="h-4 w-4" />Start</button>}
                {open && <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={saving} onClick={() => setDrawer({ kind: 'complete', task: current })}><CheckCircle2 className="h-4 w-4" />Complete</button>}
                {open && all && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ kind: 'form', task: current })}><Pencil className="h-4 w-4" />Edit</button>}
                {open && all && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium text-tertiary-600 hover:bg-primary-50" onClick={cancel}><XCircle className="h-4 w-4" />Cancel task</button>}
                {!open && isAdmin && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={reopen}><RotateCcw className="h-4 w-4" />Reopen</button>}
                {canDelete && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
              </span>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Type">{TASK_TYPE_LABEL[current.task_type]}</Detail>
              <Detail label="Assigned to">{current.person ? `${current.person.name} (${current.person.kind})` : 'Unassigned'}</Detail>
              <Detail label="Property">{current.property && (zxCan(me, 'properties') ? <Link to={`/zephyr/properties/${current.property.id}`} className="text-primary-700 hover:underline">{current.property.name}{current.unit ? ` · ${current.unit.name}` : ''}</Link> : current.property.name)}</Detail>
              <Detail label="Project">{current.project && `${current.project.code} ${current.project.name}`}</Detail>
              <Detail label="Due date">{current.due_date ? dateLabel(current.due_date) : null}</Detail>
              <Detail label="Completed on">{current.completed_on ? dateLabel(current.completed_on) : null}</Detail>
              <Detail label="Amount">{current.amount ? rupees(current.amount) : null}</Detail>
              <div className="sm:col-span-2"><Detail label="Details"><span className="whitespace-pre-wrap">{current.description}</span></Detail></div>
              <div className="sm:col-span-2"><Detail label="Notes"><span className="whitespace-pre-wrap">{current.notes}</span></Detail></div>
            </dl>
          </div>
        )}
      </Drawer>
    </div>
  );
}
