import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, Pencil, Trash2, Undo2, Wand2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { SALARY_STATUS } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import { Area, Empty, Kpi, Money, Num, withReason, labelCls, inputCls } from '../../components/acconcy/ui.jsx';
import { dateLabel, shortMonth } from '../../lib/format.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function EditForm({ row, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ gross: row.gross, deductions: row.deductions, notes: row.notes ?? '' });
  const net = Number(v.gross || 0) - Number(v.deductions || 0);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ gross: Number(v.gross), deductions: Number(v.deductions || 0), notes: v.notes.trim() || null }); }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Num label="Gross salary" value={v.gross} onChange={(x) => setV((c) => ({ ...c, gross: x }))} required />
        <Num label="Deductions" value={v.deductions} onChange={(x) => setV((c) => ({ ...c, deductions: x }))} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={(x) => setV((c) => ({ ...c, notes: x }))} maxLength={500} />
      </div>
      <div className={`rounded-xl px-3 py-2 text-sm ${net < 0 ? 'bg-red-50 text-red-700' : 'bg-primary-50 text-primary-900'}`}>Net pay: {net.toLocaleString('en-IN')}</div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || net < 0}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function AcconcySalariesPage() {
  const { me, loading } = useAcconcy();
  const { pushError, pushSuccess } = useAlerts();
  const pickers = usePickers();
  const [f, setF] = useState({ month: thisMonth(), person_id: '', kind: '', status: '' });
  const [res, setRes] = useState({ rows: [], totals: null });
  const [fetching, setFetching] = useState(true);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((c) => ({ ...c, [k]: v }));

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const r = await acconcyApi.salaries(Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
      setRes({ rows: r.data, totals: r.totals });
    } catch (e) {
      pushError(acconcyError(e, 'Could not load salaries'), 'Load failed');
    } finally {
      setFetching(false);
    }
  }, [f, pushError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'salaries')) return <Navigate to="/acconcy" replace />;
  const isAdmin = me.role === 'admin';

  async function act(fn, ok) {
    try { await withReason(fn); if (ok) pushSuccess(ok); await load(); } catch (e) { pushError(acconcyError(e, 'Action failed'), 'Action failed'); }
  }
  async function generate() {
    if (!f.month) return;
    try {
      const r = await withReason((reason) => acconcyApi.generateSalaries({ month: f.month, ...(reason ? { reason } : {}) }));
      pushSuccess(`${r.created} row(s) created${r.skipped ? `, ${r.skipped} already existed` : ''}`);
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not generate'), 'Could not generate');
    }
  }
  async function save(body) {
    setSaving(true);
    try {
      await withReason((reason) => acconcyApi.updateSalary(edit.id, { ...body, ...(reason ? { reason } : {}) }));
      pushSuccess('Saved');
      setEdit(null);
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function pay(r) {
    const paid_on = window.prompt('Paid on (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!paid_on) return;
    act(() => acconcyApi.paySalary(r.id, { paid_on }), 'Marked paid');
  }
  async function unapprove(r) {
    const reason = window.prompt('Reason for sending this salary back to draft:');
    if (!reason?.trim()) return;
    act(() => acconcyApi.unapproveSalary(r.id, { reason: reason.trim() }), 'Back to draft');
  }

  const t = res.totals;
  const needle = q.trim().toLowerCase();
  const shown = needle ? res.rows.filter((r) => `${r.person?.name || ''} ${r.person?.designation || ''}`.toLowerCase().includes(needle)) : res.rows;
  return (
    <div className="mt-4 space-y-4">
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Net payable" value={<Money v={t.net} />} hint={`${t.count} row(s) in this view`} />
          <Kpi label="In P&L (approved + paid)" value={<Money v={t.approved_paid} />} tone="ax-gold" />
          <Kpi label="Draft" value={<Money v={t.draft} />} hint="not in P&L yet" />
          <Kpi label="Paid" value={<Money v={t.paid} />} />
          <Kpi label="Month" value={f.month ? shortMonth(f.month) : 'All months'} />
        </div>
      )}
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search by name or designation..."
        fields={[
          { key: 'person_id', label: 'Person', type: 'select', any: 'Everyone', options: [...pickers.employees, ...pickers.contractors] },
          { key: 'kind', label: 'Employee or contractor', type: 'select', any: 'Both', options: [{ value: 'employee', label: 'Employees' }, { value: 'contractor', label: 'Contractors' }] },
          { key: 'status', label: 'Status', type: 'select', any: 'Any status', options: Object.entries(SALARY_STATUS).map(([value, m]) => ({ value, label: m.label })) },
        ]}
        values={f}
        onChange={set}
        onReset={() => setF({ month: thisMonth(), person_id: '', kind: '', status: '' })}
      >
        <label className={labelCls}><span className="sr-only">Month</span><input type="month" className={`${inputCls} mt-0`} value={f.month} onChange={(e) => set('month', e.target.value)} /></label>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={!f.month} onClick={generate}><Wand2 className="h-4 w-4" />Generate {f.month ? shortMonth(f.month) : ''} salaries</button>
      </FilterBar>

      {shown.length === 0 ? <Empty>{fetching ? 'Loading...' : 'No salary rows for this view. Set a monthly salary on each person in Employee / Contractor, then generate the month.'}</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Month</th><th className="px-3 py-2 font-medium">Person</th><th className="px-3 py-2 text-right font-medium">Gross</th><th className="px-3 py-2 text-right font-medium">Deductions</th><th className="px-3 py-2 text-right font-medium">Net</th><th className="px-3 py-2 font-medium">Status</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{shortMonth(r.month)}</td>
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.person?.name}</span><span className="block text-xs text-tertiary-500">{r.person?.kind === 'contractor' ? 'Contractor' : 'Employee'}{r.person?.designation ? ` · ${r.person.designation}` : ''}</span></td>
                  <td className="px-3 py-2 text-right"><Money v={r.gross} /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.deductions} /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.net} className="font-semibold" /></td>
                  <td className="px-3 py-2"><Pill tone={SALARY_STATUS[r.status]?.tone}>{SALARY_STATUS[r.status]?.label}</Pill>{r.paid_on && <span className="ml-1 text-xs text-tertiary-400">{dateLabel(r.paid_on)}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {(r.status === 'draft' || isAdmin) && <button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button>}
                    {r.status === 'draft' && <button type="button" title="Approve" className="mr-1 rounded p-1 text-primary-700 hover:bg-primary-50" onClick={() => act(() => acconcyApi.approveSalary(r.id), 'Approved')}><CheckCircle2 className="h-4 w-4" /></button>}
                    {r.status === 'approved' && <button type="button" title="Mark paid" className="mr-1 rounded p-1 text-green-700 hover:bg-green-50" onClick={() => pay(r)}><BadgeCheck className="h-4 w-4" /></button>}
                    {r.status !== 'draft' && isAdmin && <button type="button" title="Back to draft" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => unapprove(r)}><Undo2 className="h-4 w-4" /></button>}
                    {(r.status === 'draft' || isAdmin) && <button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => window.confirm('Delete this salary row?') && act((reason) => acconcyApi.deleteSalary(r.id, reason))}><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `Salary: ${edit.person?.name} · ${shortMonth(edit.month)}` : ''}>
        {edit && <EditForm row={edit} saving={saving} onSubmit={save} onCancel={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}
