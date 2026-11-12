import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Banknote, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { PAYMENT_METHODS, METHOD_LABEL } from '../../lib/zephyr/propertyMeta.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { Detail, Section, dayOf, inputCls, labelCls, today } from '../../components/zephyr/formKit.jsx';

const TABS = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'payouts', label: 'Payouts & advances' },
  { key: 'report', label: 'Project report' },
  { key: 'workers', label: 'Workers' },
];
const MARKS = [
  { value: 'present', label: 'Present', on: 'bg-green-600 text-white' },
  { value: 'half', label: 'Half', on: 'bg-amber-500 text-white' },
  { value: 'absent', label: 'Absent', on: 'bg-red-600 text-white' },
];
const monthStart = () => `${today().slice(0, 7)}-01`;

// ---------------------------------------------------------------- Attendance
function AttendanceTab({ projects, canMark, run, saving }) {
  const [date, setDate] = useState(today());
  const [projectId, setProjectId] = useState('');
  const [sheet, setSheet] = useState([]);
  const [edits, setEdits] = useState({});
  const [q, setQ] = useState('');
  const { pushError } = useAlerts();

  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id);
  }, [projects, projectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await zephyrApi.wageSheet({ date, project_id: projectId });
      setSheet(data.workers);
      setEdits({});
    } catch (e) {
      pushError(zephyrError(e, 'Could not load the attendance sheet'), 'Load failed');
    }
  }, [date, projectId, pushError]);
  useEffect(() => {
    load();
  }, [load]);

  const valueOf = (w) => edits[w.id] ?? (w.mark ? { status: w.mark.status, ot_hours: w.mark.ot_hours, notes: w.mark.notes || '' } : { status: '', ot_hours: 0, notes: '' });
  const setEdit = (w, patch) => setEdits((cur) => ({ ...cur, [w.id]: { ...valueOf(w), ...patch } }));
  const rows = sheet.filter((w) => !q.trim() || w.name.toLowerCase().includes(q.trim().toLowerCase()));
  const dirty = sheet.filter((w) => edits[w.id] && !w.mark?.paid);

  const counts = useMemo(() => {
    const c = { present: 0, half: 0, absent: 0, unmarked: 0, pay: 0 };
    for (const w of sheet) {
      const v = valueOf(w);
      if (!v.status) c.unmarked += 1;
      else {
        c[v.status] += 1;
        const f = v.status === 'present' ? 1 : v.status === 'half' ? 0.5 : 0;
        c.pay += (w.mark?.rate ?? w.daily_rate) * f + (v.status === 'absent' ? 0 : ((Number(v.ot_hours) || 0) * (w.mark?.rate ?? w.daily_rate)) / 8);
      }
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, edits]);

  function markAll(status) {
    setEdits((cur) => {
      const next = { ...cur };
      for (const w of sheet) if (!w.mark?.paid && w.other_fraction === 0) next[w.id] = { ...valueOf(w), status };
      return next;
    });
  }

  async function save() {
    const marks = dirty.map((w) => {
      const v = valueOf(w);
      return v.status ? { worker_id: w.id, status: v.status, ot_hours: Number(v.ot_hours) || 0, ...(v.notes?.trim() ? { notes: v.notes.trim() } : {}) } : { worker_id: w.id, status: 'clear' };
    });
    if (!marks.length) return;
    const result = await run(() => zephyrApi.markWageAttendance({ project_id: projectId, work_date: date, marks }), 'Attendance saved');
    if (result?.locked?.length) pushError(`Already paid, not changed: ${result.locked.join(', ')}`, 'Some days are paid');
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelCls}>Date<input type="date" className={`${inputCls} w-44`} value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className={labelCls}>Project<select className={`${inputCls} w-64`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a worker…" aria-label="Find a worker" className="rounded-xl border px-3 py-2 text-sm" />
        {canMark && (
          <span className="ml-auto inline-flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => markAll('present')}>Everyone present</button>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={saving || dirty.length === 0} onClick={save}><Save className="h-4 w-4" />Save attendance{dirty.length ? ` (${dirty.length})` : ''}</button>
          </span>
        )}
      </div>
      {!projects.length && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-500">Create a project first: attendance is marked against a project.</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Present" value={counts.present} />
        <StatCard label="Half day" value={counts.half} />
        <StatCard label="Absent" value={counts.absent} />
        <StatCard label="Not marked" value={counts.unmarked} tone={counts.unmarked ? 'warning' : undefined} />
        <StatCard label="Wages for the day" value={rupees(counts.pay)} hint="on this project" />
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase tracking-wide text-tertiary-500">
            <tr><th className="px-3 py-2">Worker</th><th className="px-3 py-2">Rate / day</th><th className="px-3 py-2">Attendance</th><th className="px-3 py-2">Overtime (hrs)</th><th className="px-3 py-2">Note</th><th className="px-3 py-2 text-right">Wage</th></tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const v = valueOf(w);
              const paid = Boolean(w.mark?.paid);
              const full = w.other_fraction >= 1;
              const half = w.other_fraction > 0 && w.other_fraction < 1;
              const off = !canMark || paid || full;
              const rate = w.mark?.rate ?? w.daily_rate;
              const f = v.status === 'present' ? 1 : v.status === 'half' ? 0.5 : 0;
              const wage = v.status ? rate * f + (v.status === 'absent' ? 0 : ((Number(v.ot_hours) || 0) * rate) / 8) : 0;
              return (
                <tr key={w.id} className="border-t">
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{w.name}</span><span className="block text-xs text-tertiary-500">{w.trade || '—'}</span></td>
                  <td className="px-3 py-2 tabular-nums">{rupees(rate)}</td>
                  <td className="px-3 py-2">
                    {full ? <span className="text-xs text-tertiary-500">Marked for a full day on another project</span> : (
                      <span className="inline-flex overflow-hidden rounded-lg border" role="group" aria-label={`Attendance of ${w.name}`}>
                        {MARKS.filter((m) => !(half && m.value === 'present')).map((m) => (
                          <button key={m.value} type="button" disabled={off} aria-pressed={v.status === m.value} onClick={() => setEdit(w, { status: v.status === m.value ? '' : m.value, ...(m.value === 'absent' ? { ot_hours: 0 } : {}) })} className={`px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${v.status === m.value ? m.on : 'bg-white text-tertiary-600 hover:bg-tertiary-50'}`}>{m.label}</button>
                        ))}
                      </span>
                    )}
                    {half && <span className="ml-2 text-xs text-tertiary-500">half day already on another project</span>}
                    {paid && <span className="ml-2"><Pill tone="green">Paid</Pill></span>}
                  </td>
                  <td className="px-3 py-2"><input type="number" min="0" max="12" step="0.5" className="w-20 rounded-lg border px-2 py-1 text-sm" disabled={off || !v.status || v.status === 'absent'} value={v.ot_hours || ''} onChange={(e) => setEdit(w, { ot_hours: e.target.value })} aria-label={`Overtime hours of ${w.name}`} /></td>
                  <td className="px-3 py-2"><input className="w-40 rounded-lg border px-2 py-1 text-sm" disabled={off || !v.status} maxLength={300} value={v.notes || ''} onChange={(e) => setEdit(w, { notes: e.target.value })} aria-label={`Note for ${w.name}`} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.status ? rupees(wage) : '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-tertiary-500">No active workers. Add them in the Workers tab.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tertiary-500">A day is paid at the worker&apos;s daily rate (half day = half). Overtime is paid per hour at one-eighth of the daily rate. A worker can be split across projects on the same day, but not more than one day in total.</p>
    </div>
  );
}

// ------------------------------------------------------------------- Workers
function WorkerForm({ initial, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ name: initial?.name || '', phone: initial?.phone || '', trade: initial?.trade || '', daily_rate: initial?.daily_rate ?? '', joined_on: dayOf(initial?.joined_on), active: initial?.active ?? true, notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: v.name.trim(), phone: v.phone.trim() || null, trade: v.trade.trim() || null, daily_rate: Number(v.daily_rate), joined_on: v.joined_on || null, active: v.active, notes: v.notes.trim() || null });
      }}
      className="space-y-4"
    >
      <Section title="Worker">
        <label className={`${labelCls} sm:col-span-2`}>Name<input className={inputCls} value={v.name} onChange={set('name')} required maxLength={120} autoFocus /></label>
        <label className={labelCls}>Trade / skill<input className={inputCls} value={v.trade} onChange={set('trade')} maxLength={80} placeholder="Mason, helper, electrician…" /></label>
        <label className={labelCls}>Phone<input className={inputCls} value={v.phone} onChange={set('phone')} maxLength={30} /></label>
        <label className={labelCls}>Daily wage (₹)<input type="number" min="1" className={inputCls} value={v.daily_rate} onChange={set('daily_rate')} required /></label>
        <label className={labelCls}>Joined on<input type="date" className={inputCls} value={v.joined_on} onChange={set('joined_on')} /></label>
        <label className="flex items-center gap-2 text-sm text-tertiary-800 sm:col-span-2"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Active (shows on the attendance sheet)</label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<textarea className={inputCls} rows={2} value={v.notes} onChange={set('notes')} maxLength={1000} /></label>
      </Section>
      {initial && <p className="text-xs text-tertiary-500">A changed daily wage applies to days marked from now on; days already marked keep the rate they were marked with.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save worker'}</button>
      </div>
    </form>
  );
}

function WorkersTab({ canMark, canDelete, run, saving, reloadKey }) {
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState('true');
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(null);
  const { pushError } = useAlerts();
  const load = useCallback(async () => {
    try {
      setRows((await zephyrApi.wageWorkers({ ...(active ? { active } : {}), ...(q.trim() ? { q: q.trim() } : {}) })).workers);
    } catch (e) {
      pushError(zephyrError(e, 'Could not load workers'), 'Load failed');
    }
  }, [active, q, pushError]);
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  async function save(values) {
    const done = await run(() => (drawer.worker ? zephyrApi.updateWageWorker(drawer.worker.id, values) : zephyrApi.createWageWorker(values)), drawer.worker ? 'Worker saved' : 'Worker added');
    if (done) {
      setDrawer(null);
      load();
    }
  }
  async function remove(w) {
    if (window.confirm(`Delete ${w.name}? A worker with attendance on record cannot be deleted; mark them inactive instead.`) && (await run(() => zephyrApi.deleteWageWorker(w.id), 'Worker deleted'))) load();
  }
  const columns = [
    { key: 'name', header: 'Worker', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{[r.trade, r.phone].filter(Boolean).join(' · ') || '—'}</span></span> },
    { key: 'rate', header: 'Daily wage', render: (r) => <span className="tabular-nums">{rupees(r.daily_rate)}</span> },
    { key: 'unpaid', header: 'Earned, not paid', render: (r) => <span className="tabular-nums">{rupees(r.unpaid)}</span> },
    { key: 'adv', header: 'Advance to recover', render: (r) => (r.advance_outstanding ? <span className="tabular-nums">{rupees(r.advance_outstanding)}</span> : '—') },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Inactive'}</Pill> },
    ...(canMark ? [{ key: 'act', header: '', render: (r) => (
      <span className="inline-flex gap-1">
        <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50" aria-label={`Edit ${r.name}`} onClick={() => setDrawer({ worker: r })}><Pencil className="h-4 w-4" /></button>
        {canDelete && <button type="button" className="rounded-lg p-1.5 text-danger-600 hover:bg-danger-50" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
      </span>
    ) }] : []),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workers…" aria-label="Search workers" className="rounded-xl border px-3 py-1.5 text-sm" />
          <select value={active} onChange={(e) => setActive(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="true">Active</option><option value="false">Inactive</option><option value="">All</option></select>
        </div>
        {canMark && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ worker: null })}><Plus className="h-4 w-4" />Add worker</button>}
      </div>
      <DataTable columns={columns} rows={rows} emptyLabel="No workers yet. Add the daily-wage workers you employ." maxHeight="62vh" />
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="lg" tone={drawer?.worker ? 'edit' : 'create'} title={drawer?.worker ? `Edit ${drawer.worker.name}` : 'Add worker'}>
        {drawer && <WorkerForm initial={drawer.worker} saving={saving} onSubmit={save} onCancel={() => setDrawer(null)} />}
      </Drawer>
    </div>
  );
}

// ------------------------------------------------------------------- Payouts
function PayForm({ workers, initialWorker, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ worker_id: initialWorker || '', to_date: today(), project_id: '', paid_on: today(), advance_recovered: '', other_deductions: '', payment_mode: 'cash', reference: '', notes: '' });
  const [pre, setPre] = useState(null);
  const [projects, setProjects] = useState([]);
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  useEffect(() => {
    zephyrApi.projects({}).then(setProjects, () => setProjects([]));
  }, []);
  useEffect(() => {
    if (!v.worker_id) return setPre(null);
    let live = true;
    zephyrApi.wagePayable({ worker_id: v.worker_id, to_date: v.to_date, ...(v.project_id ? { project_id: v.project_id } : {}) }).then((d) => live && setPre(d), () => live && setPre(null));
    return () => { live = false; };
  }, [v.worker_id, v.to_date, v.project_id]);
  const adv = Number(v.advance_recovered) || 0;
  const other = Number(v.other_deductions) || 0;
  const net = pre ? pre.gross - adv - other : 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ worker_id: v.worker_id, to_date: v.to_date, ...(v.project_id ? { project_id: v.project_id } : {}), paid_on: v.paid_on, advance_recovered: adv, other_deductions: other, payment_mode: v.payment_mode, ...(v.reference.trim() ? { reference: v.reference.trim() } : {}), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}) });
      }}
      className="space-y-4"
    >
      <Section title="Pay a worker">
        <label className={`${labelCls} sm:col-span-2`}>Worker<select className={inputCls} value={v.worker_id} onChange={set('worker_id')} required><option value="">Choose a worker</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}{w.unpaid ? ` · ${rupees(w.unpaid)} due` : ''}</option>)}</select></label>
        <label className={labelCls}>Pay days worked up to<input type="date" className={inputCls} value={v.to_date} onChange={set('to_date')} required /></label>
        <label className={labelCls}>Only this project (optional)<select className={inputCls} value={v.project_id} onChange={set('project_id')}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
      </Section>
      {pre && (
        <div className="rounded-xl border bg-tertiary-50 p-3 text-sm">
          {pre.rows === 0 ? <span className="text-tertiary-600">No unpaid days up to that date.</span> : (
            <>
              <div className="font-medium text-tertiary-900">{pre.days} day{pre.days === 1 ? '' : 's'}{pre.ot_hours ? ` + ${pre.ot_hours} overtime hrs` : ''} = {rupees(pre.gross)}</div>
              <ul className="mt-1 space-y-0.5 text-tertiary-600">{pre.projects.map((p) => <li key={p.project_id}>{p.code} {p.name}: {p.days} day{p.days === 1 ? '' : 's'} · {rupees(p.amount)}</li>)}</ul>
            </>
          )}
          {pre.advance_outstanding > 0 && <div className="mt-2 text-amber-700">Advance still to recover: {rupees(pre.advance_outstanding)}</div>}
        </div>
      )}
      <Section title="Payment">
        <label className={labelCls}>Recover advance (₹)<input type="number" min="0" max={pre?.advance_outstanding ?? undefined} className={inputCls} value={v.advance_recovered} onChange={set('advance_recovered')} disabled={!pre?.advance_outstanding} /></label>
        <label className={labelCls}>Other deduction (₹)<input type="number" min="0" className={inputCls} value={v.other_deductions} onChange={set('other_deductions')} /></label>
        <label className={labelCls}>Paid on<input type="date" className={inputCls} value={v.paid_on} onChange={set('paid_on')} required /></label>
        <label className={labelCls}>Method<select className={inputCls} value={v.payment_mode} onChange={set('payment_mode')}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        <label className={`${labelCls} sm:col-span-2`}>Reference / note<input className={inputCls} value={v.reference} onChange={set('reference')} maxLength={120} /></label>
      </Section>
      {pre?.rows > 0 && <div className="flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50 px-4 py-3"><span className="text-sm text-tertiary-700">Net to hand over</span><span className="text-xl font-semibold text-tertiary-900">{rupees(net)}</span></div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || !pre || pre.rows === 0 || net < 0}>{saving ? 'Saving…' : 'Record payout'}</button>
      </div>
    </form>
  );
}

function AdvanceForm({ workers, initial, saving, onSubmit, onCancel }) {
  const [v, setV] = useState({ worker_id: initial?.worker_id || '', given_on: dayOf(initial?.given_on) || today(), amount: initial?.amount ?? '', payment_mode: initial?.payment_mode || 'cash', notes: initial?.notes || '' });
  const set = (key) => (e) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...(initial ? {} : { worker_id: v.worker_id }), given_on: v.given_on, amount: Number(v.amount), payment_mode: v.payment_mode, notes: v.notes.trim() || null });
      }}
      className="space-y-4"
    >
      <Section title="Advance">
        <label className={`${labelCls} sm:col-span-2`}>Worker<select className={inputCls} value={v.worker_id} onChange={set('worker_id')} required disabled={Boolean(initial)}><option value="">Choose a worker</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className={labelCls}>Given on<input type="date" className={inputCls} value={v.given_on} onChange={set('given_on')} required /></label>
        <label className={labelCls}>Amount (₹)<input type="number" min="1" className={inputCls} value={v.amount} onChange={set('amount')} required /></label>
        <label className={labelCls}>Method<select className={inputCls} value={v.payment_mode} onChange={set('payment_mode')}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        <label className={`${labelCls} sm:col-span-2`}>Notes<input className={inputCls} value={v.notes} onChange={set('notes')} maxLength={300} /></label>
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save advance'}</button>
      </div>
    </form>
  );
}

function PayoutsTab({ canPay, run, saving, onChanged, reloadKey }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [payouts, setPayouts] = useState({ payouts: [], totals: { gross: 0, net: 0, advance_recovered: 0 } });
  const [advances, setAdvances] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const { pushError } = useAlerts();
  const load = useCallback(async () => {
    try {
      const [p, a, w] = await Promise.all([zephyrApi.wagePayouts({ from, to }), zephyrApi.wageAdvances({}), zephyrApi.wageWorkers({})]);
      setPayouts(p);
      setAdvances(a.advances);
      setWorkers(w.workers);
    } catch (e) {
      pushError(zephyrError(e, 'Could not load payouts'), 'Load failed');
    }
  }, [from, to, pushError]);
  useEffect(() => {
    load();
  }, [load, reloadKey]);
  const name = (id) => workers.find((w) => w.id === id)?.name || 'Worker';
  const due = workers.reduce((a, w) => a + w.unpaid, 0);
  const owed = workers.reduce((a, w) => a + w.advance_outstanding, 0);

  async function pay(body) {
    if (await run(() => zephyrApi.payWages(body), 'Payout recorded')) {
      setDrawer(null);
      await load();
      onChanged();
    }
  }
  async function saveAdvance(body) {
    if (await run(() => (drawer.advance ? zephyrApi.updateWageAdvance(drawer.advance.id, body) : zephyrApi.createWageAdvance(body)), 'Advance saved')) {
      setDrawer(null);
      await load();
      onChanged();
    }
  }
  async function voidIt(p) {
    const reason = window.prompt(`Void this payout of ${rupees(p.net)} to ${p.worker?.name}? Their days become unpaid again. Why?`);
    if (reason?.trim() && (await run(() => zephyrApi.voidWagePayout(p.id, reason.trim()), 'Payout voided'))) {
      setDrawer(null);
      await load();
      onChanged();
    }
  }
  async function removeAdvance(a) {
    if (window.confirm(`Delete the ${rupees(a.amount)} advance to ${name(a.worker_id)}?`) && (await run(() => zephyrApi.deleteWageAdvance(a.id), 'Advance deleted'))) {
      await load();
      onChanged();
    }
  }
  async function view(p) {
    try {
      setDrawer({ detail: (await zephyrApi.wagePayout(p.id)).payout });
    } catch (e) {
      pushError(zephyrError(e, 'Could not open the payout'), 'Load failed');
    }
  }

  const payoutCols = [
    { key: 'paid_on', header: 'Paid on', render: (r) => dateLabel(r.paid_on) },
    { key: 'worker', header: 'Worker', render: (r) => <span className="font-medium text-tertiary-900">{r.worker?.name}</span> },
    { key: 'period', header: 'Days up to', render: (r) => `${dateLabel(r.from_date)} – ${dateLabel(r.to_date)}` },
    { key: 'days', header: 'Days', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'gross', header: 'Wages', render: (r) => <span className="tabular-nums">{rupees(r.gross)}</span> },
    { key: 'ded', header: 'Deducted', render: (r) => <span className="tabular-nums">{r.advance_recovered + r.other_deductions ? rupees(r.advance_recovered + r.other_deductions) : '—'}</span> },
    { key: 'net', header: 'Paid', render: (r) => <span className="font-medium tabular-nums">{rupees(r.net)}</span> },
    { key: 'mode', header: 'Method', render: (r) => METHOD_LABEL[r.payment_mode] || r.payment_mode || '—' },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'paid' ? 'green' : 'gray'}>{r.status === 'paid' ? 'Paid' : 'Voided'}</Pill> },
  ];
  const advCols = [
    { key: 'given_on', header: 'Given on', render: (r) => dateLabel(r.given_on) },
    { key: 'worker', header: 'Worker', render: (r) => name(r.worker_id) },
    { key: 'amount', header: 'Amount', render: (r) => <span className="tabular-nums">{rupees(r.amount)}</span> },
    { key: 'mode', header: 'Method', render: (r) => METHOD_LABEL[r.payment_mode] || '—' },
    { key: 'notes', header: 'Notes', render: (r) => r.notes || '—' },
    ...(canPay ? [{ key: 'act', header: '', render: (r) => (
      <span className="inline-flex gap-1">
        <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50" aria-label="Edit advance" onClick={() => setDrawer({ advance: r })}><Pencil className="h-4 w-4" /></button>
        <button type="button" className="rounded-lg p-1.5 text-danger-600 hover:bg-danger-50" aria-label="Delete advance" onClick={() => removeAdvance(r)}><Trash2 className="h-4 w-4" /></button>
      </span>
    ) }] : []),
  ];
  const d = drawer?.detail;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Earned, not yet paid" value={rupees(due)} tone={due ? 'warning' : undefined} hint="all workers, all projects" />
        <StatCard label="Advances to recover" value={rupees(owed)} />
        <StatCard label="Paid in period" value={rupees(payouts.totals.net)} />
        <StatCard label="Wages settled in period" value={rupees(payouts.totals.gross)} hint={payouts.totals.advance_recovered ? `${rupees(payouts.totals.advance_recovered)} advance recovered` : undefined} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className={labelCls}>From<input type="date" className={`${inputCls} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className={labelCls}>To<input type="date" className={`${inputCls} w-40`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {canPay && (
          <span className="inline-flex gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer({ advance: null, advanceForm: true })}><Plus className="h-4 w-4" />Give advance</button>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ pay: true })}><Banknote className="h-4 w-4" />Pay a worker</button>
          </span>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-tertiary-800">Payouts</h3>
        <DataTable columns={payoutCols} rows={payouts.payouts} emptyLabel="No payouts in this period." onRowClick={view} maxHeight="40vh" />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-tertiary-800">Advances given</h3>
        <DataTable columns={advCols} rows={advances} emptyLabel="No advances recorded." maxHeight="30vh" />
      </div>
      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} size="xl" tone={drawer?.pay || drawer?.advanceForm ? 'create' : drawer?.advance ? 'edit' : 'default'} title={drawer?.pay ? 'Pay a worker' : drawer?.advanceForm || drawer?.advance ? (drawer.advance ? 'Edit advance' : 'Give advance') : 'Payout'}>
        {drawer?.pay && <PayForm workers={workers.filter((w) => w.active || w.unpaid)} saving={saving} onSubmit={pay} onCancel={() => setDrawer(null)} />}
        {(drawer?.advanceForm || drawer?.advance) && <AdvanceForm workers={workers} initial={drawer.advance} saving={saving} onSubmit={saveAdvance} onCancel={() => setDrawer(null)} />}
        {d && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><Pill tone={d.status === 'paid' ? 'green' : 'gray'}>{d.status === 'paid' ? 'Paid' : 'Voided'}</Pill>{canPay && d.status === 'paid' && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium text-tertiary-600 hover:bg-primary-50" onClick={() => voidIt({ ...d })}><RotateCcw className="h-4 w-4" />Void payout</button>}</div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Worker">{d.worker?.name}{d.worker?.trade ? ` · ${d.worker.trade}` : ''}</Detail>
              <Detail label="Paid on">{dateLabel(d.paid_on)} by {METHOD_LABEL[d.payment_mode] || '—'}</Detail>
              <Detail label="Wages">{rupees(d.gross)} for {d.days} days{d.ot_hours ? ` + ${d.ot_hours} OT hrs` : ''}</Detail>
              <Detail label="Deducted">{d.advance_recovered || d.other_deductions ? `${rupees(d.advance_recovered)} advance, ${rupees(d.other_deductions)} other` : null}</Detail>
              <Detail label="Net paid">{rupees(d.net)}</Detail>
              <Detail label="Reference">{d.reference}</Detail>
              <div className="sm:col-span-2"><Detail label="Voided because">{d.voided_reason}</Detail></div>
            </dl>
            <table className="min-w-full text-sm"><thead className="text-left text-xs uppercase text-tertiary-500"><tr><th className="py-1">Date</th><th>Project</th><th>Day</th><th className="text-right">Wage</th></tr></thead>
              <tbody>{d.attendance.map((a) => <tr key={a.id} className="border-t"><td className="py-1">{dateLabel(a.work_date)}</td><td>{a.project ? `${a.project.code} ${a.project.name}` : '—'}</td><td className="capitalize">{a.status}{a.ot_hours ? ` +${a.ot_hours}h` : ''}</td><td className="text-right tabular-nums">{rupees(a.amount)}</td></tr>)}</tbody></table>
          </div>
        )}
      </Drawer>
    </div>
  );
}

// -------------------------------------------------------------------- Report
function ReportTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const { pushError } = useAlerts();
  useEffect(() => {
    zephyrApi.wageSummary({ from, to }).then(setData, (e) => pushError(zephyrError(e, 'Could not load the report'), 'Load failed'));
  }, [from, to, pushError]);
  const projectCols = [
    { key: 'project', header: 'Project', render: (r) => <span className="font-medium text-tertiary-900">{r.code ? `${r.code} ` : ''}{r.name}</span> },
    { key: 'workers', header: 'Workers', render: (r) => r.workers },
    { key: 'days', header: 'Days', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'ot', header: 'OT hrs', render: (r) => <span className="tabular-nums">{r.ot_hours || '—'}</span> },
    { key: 'amount', header: 'Wages', render: (r) => <span className="font-medium tabular-nums">{rupees(r.amount)}</span> },
    { key: 'paid', header: 'Paid', render: (r) => <span className="tabular-nums">{rupees(r.paid)}</span> },
    { key: 'unpaid', header: 'Not paid', render: (r) => <span className={`tabular-nums ${r.unpaid ? 'text-amber-700' : ''}`}>{rupees(r.unpaid)}</span> },
  ];
  const workerCols = [
    { key: 'name', header: 'Worker', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.trade || '—'}</span></span> },
    { key: 'days', header: 'Days', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'absent', header: 'Absent', render: (r) => r.absent_days || '—' },
    { key: 'ot', header: 'OT hrs', render: (r) => <span className="tabular-nums">{r.ot_hours || '—'}</span> },
    { key: 'amount', header: 'Wages', render: (r) => <span className="font-medium tabular-nums">{rupees(r.amount)}</span> },
    { key: 'unpaid', header: 'Not paid', render: (r) => <span className={`tabular-nums ${r.unpaid ? 'text-amber-700' : ''}`}>{rupees(r.unpaid)}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className={labelCls}>From<input type="date" className={`${inputCls} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={labelCls}>To<input type="date" className={`${inputCls} w-40`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Days worked" value={data?.totals.days} />
        <StatCard label="Wage cost" value={data ? rupees(data.totals.amount) : '—'} />
        <StatCard label="Paid" value={data ? rupees(data.totals.paid) : '—'} />
        <StatCard label="Not yet paid" value={data ? rupees(data.totals.unpaid) : '—'} tone={data?.totals.unpaid ? 'warning' : undefined} />
      </div>
      <div><h3 className="mb-2 text-sm font-semibold text-tertiary-800">By project</h3><DataTable columns={projectCols} rows={data?.projects || []} emptyLabel="No attendance in this period." maxHeight="40vh" /></div>
      <div><h3 className="mb-2 text-sm font-semibold text-tertiary-800">By worker</h3><DataTable columns={workerCols} rows={data?.workers || []} emptyLabel="No attendance in this period." maxHeight="40vh" /></div>
      <p className="text-xs text-tertiary-500">Wage cost counts by the day worked, whether or not it has been paid yet, and is included in each project&apos;s profit under salaries.</p>
    </div>
  );
}

// ---------------------------------------------------------------------- Page
export default function ZephyrWagesPage() {
  const { me, loading } = useZephyr();
  const { pushError, pushSuccess } = useAlerts();
  const [tab, setTab] = useState('attendance');
  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const canMark = zxCan(me, 'wages');
  const canPay = zxCan(me, 'wagesPay');
  const canDelete = zxCan(me, 'delete');

  useEffect(() => {
    zephyrApi.projects({}).then((rows) => setProjects(rows.filter((p) => !['completed', 'cancelled', 'closed'].includes(p.status))), () => setProjects([]));
  }, []);

  async function run(action, success, fail = 'Could not save') {
    setSaving(true);
    try {
      const result = await action();
      if (success) pushSuccess(success);
      setReloadKey((k) => k + 1);
      return result ?? true;
    } catch (e) {
      pushError(zephyrError(e, fail), fail);
      return null;
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'wagesView')) return <Navigate to="/zephyr" replace />;

  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'attendance' && <AttendanceTab projects={projects} canMark={canMark} run={run} saving={saving} />}
      {tab === 'workers' && <WorkersTab canMark={canMark} canDelete={canDelete} run={run} saving={saving} reloadKey={reloadKey} />}
      {tab === 'payouts' && <PayoutsTab canPay={canPay} run={run} saving={saving} onChanged={() => setReloadKey((k) => k + 1)} reloadKey={reloadKey} />}
      {tab === 'report' && <ReportTab key={reloadKey} />}
    </div>
  );
}
