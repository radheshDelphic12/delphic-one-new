import { useCallback, useEffect, useState } from 'react';
import { Check, CircleDollarSign, RotateCcw, Split, Trash2, Wand2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import StatCard from '../../components/ui/StatCard.jsx';

const STATUS_TONE = { draft: 'gray', approved: 'amber', paid: 'green' };
const thisMonth = () => new Date().toISOString().slice(0, 7);

function SplitEditor({ record, projects, onSave, onClose }) {
  const [rows, setRows] = useState(() => (record.project_split || []).map((s) => ({ project_id: s.project_id, pct: s.pct })));
  const used = new Set(rows.map((r) => r.project_id));
  const total = rows.reduce((a, r) => a + Number(r.pct || 0), 0);
  const nameOf = (id) => projects.find((p) => p.id === id);
  return (
    <div className="space-y-4">
      <p className="text-sm text-tertiary-500">How the net pay of {record.person.name} for {record.month} is charged across projects. It must add up to 100%, or be left empty.</p>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.project_id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{nameOf(r.project_id) ? `${nameOf(r.project_id).code} · ${nameOf(r.project_id).name}` : r.project_id}</span>
            <input type="number" min="0" max="100" step="0.01" className="w-24 rounded-lg border px-2 py-1 text-sm" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} aria-label="Percent" />
            <span className="text-sm text-tertiary-400">%</span>
            <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <select className="w-full rounded-xl border px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && setRows([...rows, { project_id: e.target.value, pct: 0 }])} aria-label="Add project">
        <option value="">Add a project…</option>
        {projects.filter((p) => !used.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
      </select>
      <div className={`text-sm ${rows.length === 0 || Math.abs(total - 100) < 0.01 ? 'text-tertiary-500' : 'text-red-600'}`}>Total {total}%</div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={rows.length > 0 && Math.abs(total - 100) > 0.01} onClick={() => onSave(rows.map((r) => ({ project_id: r.project_id, pct: Number(r.pct) })))}>Save split</button>
      </div>
    </div>
  );
}

/** Monthly pay slips (admin only): generate from fixed rates, adjust days / deductions, approve, pay. */
export default function ZephyrSalaries({ projects }) {
  const { pushError, pushSuccess } = useAlerts();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [splitFor, setSplitFor] = useState(null);

  const load = useCallback(() => zephyrApi.salaries(month).then(setData, (e) => pushError(zephyrError(e, 'Could not load salaries'), 'Load failed')), [month, pushError]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  async function run(action, success) {
    setBusy(true);
    try {
      const result = await action();
      if (success) pushSuccess(typeof success === 'function' ? success(result) : success);
      await load();
      return true;
    } catch (e) {
      pushError(zephyrError(e, 'Could not update'), 'Could not update');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Gross" value={rupees(t?.gross)} />
        <StatCard label="Deductions" value={rupees(t?.deductions)} />
        <StatCard label="Net payable" value={rupees(t?.net)} accent />
        <StatCard label="Slips" value={t ? t.draft + t.approved + t.paid : '—'} hint={t ? `${t.draft} draft · ${t.approved} approved · ${t.paid} paid` : ''} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-tertiary-600">Month<input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-xl border px-3 py-1.5 text-sm" /></label>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={busy} onClick={() => run(() => zephyrApi.generateSalaries(month), (r) => (r.created ? `${r.created} draft slip(s) created` : 'Nothing new to generate'))}><Wand2 className="h-4 w-4" />Generate {month}</button>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
            <tr><th className="px-4 py-2.5">Person</th><th className="px-4 py-2.5">Basis</th><th className="px-4 py-2.5">Days</th><th className="px-4 py-2.5 text-right">Gross</th><th className="px-4 py-2.5 text-right">Deductions</th><th className="px-4 py-2.5 text-right">Net</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {data === null && <tr><td colSpan={8} className="px-4 py-6 text-center text-tertiary-400">Loading…</td></tr>}
            {data?.records.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-tertiary-400">No slips for {month}. Generate them from each person&apos;s fixed rate.</td></tr>}
            {data?.records.map((r) => {
              const draft = r.status === 'draft';
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2.5"><div className="font-medium text-tertiary-900">{r.person.name}</div><div className="text-xs text-tertiary-400">{r.person.designation || r.person.kind}</div></td>
                  <td className="px-4 py-2.5 text-tertiary-600">{r.pay_basis === 'daily' ? `${rupees(r.rate)} / day` : `${rupees(r.rate)} / month`}</td>
                  <td className="px-4 py-2.5">
                    {r.pay_basis === 'daily'
                      ? <input type="number" min="0" max="31" step="0.5" defaultValue={r.days ?? 0} disabled={!draft || busy} aria-label={`${r.person.name} days`} className="w-20 rounded-lg border px-2 py-1 disabled:bg-transparent" onBlur={(e) => Number(e.target.value) !== Number(r.days) && run(() => zephyrApi.updateSalary(r.id, { days: Number(e.target.value) }))} />
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(r.gross)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <input type="number" min="0" defaultValue={r.deductions} disabled={!draft || busy} aria-label={`${r.person.name} deductions`} className="w-24 rounded-lg border px-2 py-1 text-right disabled:bg-transparent" onBlur={(e) => Number(e.target.value) !== Number(r.deductions) && run(() => zephyrApi.updateSalary(r.id, { deductions: Number(e.target.value || 0) }))} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{rupees(r.net)}</td>
                  <td className="px-4 py-2.5"><Pill tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Pill></td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {draft && <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" title="Project split" aria-label="Edit project split" onClick={() => setSplitFor(r)}><Split className="h-4 w-4" /></button>}
                    {draft && <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" title="Approve" aria-label="Approve" disabled={busy} onClick={() => run(() => zephyrApi.approveSalary(r.id), 'Approved')}><Check className="h-4 w-4" /></button>}
                    {r.status === 'approved' && <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-primary-50 hover:text-primary-700" title="Mark paid" aria-label="Mark paid" disabled={busy} onClick={() => run(() => zephyrApi.paySalary(r.id), 'Marked paid')}><CircleDollarSign className="h-4 w-4" /></button>}
                    {r.status !== 'draft' && <button type="button" className="rounded-lg p-1.5 text-tertiary-500 hover:bg-amber-50 hover:text-amber-700" title="Reopen" aria-label="Reopen" disabled={busy} onClick={() => { const reason = window.prompt('Why is this slip being reopened?'); if (reason?.trim()) run(() => zephyrApi.unapproveSalary(r.id, reason.trim()), 'Reopened as draft'); }}><RotateCcw className="h-4 w-4" /></button>}
                    {draft && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" title="Delete" aria-label="Delete slip" disabled={busy} onClick={() => run(() => zephyrApi.deleteSalary(r.id), 'Deleted')}><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tertiary-400">Monthly slips use the fixed monthly salary; daily slips are rate × days entered. Approved and paid slips are locked; an admin can reopen either with a reason, which is kept in the audit log.</p>

      <Drawer open={Boolean(splitFor)} onClose={() => setSplitFor(null)} size="md" tone="edit" title="Project split">
        {splitFor && <SplitEditor record={splitFor} projects={projects} onClose={() => setSplitFor(null)} onSave={async (rows) => { if (await run(() => zephyrApi.updateSalary(splitFor.id, { project_split: rows.length ? rows : null }), 'Split saved')) setSplitFor(null); }} />}
      </Drawer>
    </div>
  );
}
