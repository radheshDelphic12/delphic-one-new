import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { PRIORITIES, PRIORITY_META, TASK_STATUSES, TASK_STATUS_META, TASK_TYPES, TASK_TYPE_LABEL } from '../../lib/gulati/meta.js';
import { usePickers } from '../../lib/gulati/pickers.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import { Area, DateInput, Section, Select, Text, toBody } from '../../components/gulati/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const FIELDS = ['title', 'task_type', 'deal_id', 'party_id', 'assignee_id', 'contractor_id', 'due_date', 'priority', 'status', 'description', 'notes'];

function TaskForm({ initial, pickers, deals, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'task_type' ? 'other' : k === 'priority' ? 'medium' : k === 'status' ? 'pending' : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const partyOptions = [...new Map([...pickers.clients, ...pickers.vendors].map((o) => [o.value, o])).values()];
  return (
    <form onSubmit={(e) => { e.preventDefault(); const b = toBody(v); b.title = v.title.trim(); onSubmit(b); }} className="space-y-4">
      <Section title="Task">
        <Text label="Task" className="sm:col-span-2" value={v.title} onChange={set('title')} required maxLength={200} autoFocus placeholder="Confirm vendor material availability" />
        <Select label="Task type" value={v.task_type} onChange={set('task_type')} options={TASK_TYPES} />
        <Select label="Priority" value={v.priority} onChange={set('priority')} options={PRIORITIES} />
        <Select label="Trading deal" value={v.deal_id} onChange={set('deal_id')} options={deals} blank="Not linked" />
        <Select label="Client / vendor" value={v.party_id} onChange={set('party_id')} options={partyOptions} blank="None" />
        <Select label="Assigned employee" value={v.assignee_id} onChange={set('assignee_id')} options={pickers.employees} blank="Unassigned" />
        <Select label="Assigned contractor" value={v.contractor_id} onChange={set('contractor_id')} options={pickers.contractors} blank="None" />
        <DateInput label="Due date" value={v.due_date} onChange={set('due_date')} />
        <Select label="Status" value={v.status} onChange={set('status')} options={TASK_STATUSES} />
        <Area label="Description" className="sm:col-span-2" rows={4} value={v.description} onChange={set('description')} maxLength={4000} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={2000} />
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save task'}</button>
      </div>
    </form>
  );
}

/** Task list shared by the Tasks page and "My work". */
export default function GulatiTasksPage() {
  const { me, loading } = useGulati();
  const { pushError, pushSuccess } = useAlerts();
  const pickers = usePickers();
  const [f, setF] = useState({ status: 'open', priority: '', assignee_id: '', deal_id: '' });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [rows, setRows] = useState([]);
  const [deals, setDeals] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const query = Object.fromEntries(Object.entries({ ...f, q: dq }).filter(([k, v]) => v && !(k === 'status' && v === 'all')));
      const list = await gulatiApi.tasks(query);
      if (id === reqId.current) setRows(list);
    } catch (e) {
      if (id === reqId.current) pushError(gulatiError(e, 'Could not load tasks'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [f, dq, pushError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (me && gxCan(me, 'deals')) gulatiApi.deals({ status: 'all' }).then((d) => setDeals(d.map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))), () => {}); }, [me]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'tasks')) return <Navigate to="/gulati" replace />;
  const full = gxCan(me, 'tasksAll');

  async function save(body) {
    setSaving(true);
    try {
      if (drawer.task) await gulatiApi.updateTask(drawer.task.id, body);
      else await gulatiApi.createTask(body);
      pushSuccess('Saved');
      setDrawer(null);
      load();
    } catch (e) {
      pushError(gulatiError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function setStatus(t, status) {
    try { await gulatiApi.updateTask(t.id, { status }); load(); } catch (e) { pushError(gulatiError(e, 'Could not update'), 'Could not update'); }
  }
  async function remove(t) {
    if (!window.confirm(`Delete task ${t.code}?`)) return;
    try { await gulatiApi.deleteTask(t.id); load(); } catch (e) { pushError(gulatiError(e, 'Could not delete'), 'Delete failed'); }
  }

  const columns = [
    { key: 'title', header: 'Task', render: (r) => <span><span className="font-medium text-tertiary-900">{r.title}</span><span className="block text-xs text-tertiary-500">{r.code} · {TASK_TYPE_LABEL[r.task_type] || r.task_type}</span></span> },
    { key: 'deal', header: 'Deal', render: (r) => (r.deal ? `${r.deal.code} ${r.deal.name}` : '-') },
    { key: 'who', header: 'Assigned', render: (r) => r.assignee?.name || r.contractor?.name || '-' },
    { key: 'due', header: 'Due', render: (r) => (r.due_date ? <span className={r.overdue ? 'font-medium text-red-600' : ''}>{dateLabel(r.due_date)}{r.overdue ? ' (overdue)' : ''}</span> : '-') },
    { key: 'priority', header: 'Priority', render: (r) => <Pill tone={PRIORITY_META[r.priority]?.tone}>{PRIORITY_META[r.priority]?.label}</Pill> },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={TASK_STATUS_META[r.status]?.tone}>{TASK_STATUS_META[r.status]?.label}</Pill> },
    { key: 'actions', header: '', render: (r) => (
      <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {['pending', 'in_progress'].includes(r.status) && <button type="button" title="Mark done" className="rounded p-1 text-primary-700 hover:bg-primary-50" onClick={() => setStatus(r, 'done')}><Check className="h-4 w-4" /></button>}
        {full && <button type="button" title="Edit" className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setDrawer({ task: r })}><Pencil className="h-4 w-4" /></button>}
        {full && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
      </span>
    ) },
  ];
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));

  return (
    <div className="mt-4 space-y-4">
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search tasks..."
        fields={[
          { key: 'status', label: 'Status', type: 'select', any: 'Open tasks', options: [{ value: 'all', label: 'All' }, { value: 'overdue', label: 'Overdue' }, ...TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))] },
          { key: 'priority', label: 'Priority', type: 'select', any: 'Any priority', options: PRIORITIES },
          { key: 'assignee_id', label: 'Employee', type: 'select', any: 'Anyone', hidden: !full, options: pickers.employees },
          { key: 'deal_id', label: 'Deal', type: 'select', any: 'Any deal', hidden: !deals.length, options: deals },
        ]}
        values={f}
        defaults={{ status: 'open' }}
        onChange={set}
        onReset={() => { setF({ status: 'open', priority: '', assignee_id: '', deal_id: '' }); setQ(''); }}
      >
        {full && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({})}><Plus className="h-4 w-4" />New task</button>}
      </FilterBar>
      <DataTable columns={columns} rows={rows} loading={fetching && rows.length === 0} emptyLabel="No tasks match." maxHeight="64vh" />
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.task ? 'edit' : 'create'} title={drawer?.task ? `Edit ${drawer.task.code}` : 'New task'}>
        {drawer && <TaskForm key={drawer.task?.id || 'new'} initial={drawer.task} pickers={pickers} deals={deals} saving={saving} onSubmit={save} onCancel={() => setDrawer(null)} />}
      </Drawer>
    </div>
  );
}
