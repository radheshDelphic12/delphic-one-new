import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { inr } from '../../lib/gulati/meta.js';
import Modal from '../../components/ui/Modal.jsx';
import { Area, Kpi, Money, Num, card, inputCls, labelCls } from '../../components/gulati/ui.jsx';
import { shortMonth } from '../../lib/format.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsAgo = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};
const Th = ({ children, right }) => <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;

// Valuation = (Gulati net profit x 240) + (asset value x 3), month by month, with the working shown for each month.
export default function GulatiValuationTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [q, setQ] = useState({ from: monthsAgo(11), to: thisMonth(), state: 'live' });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const alertsRef = useRef({ pushError });
  alertsRef.current = { pushError };

  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await gulatiApi.valuation(q)); } catch (e) { alertsRef.current.pushError(gulatiError(e, 'Could not load the valuation'), 'Load failed'); } finally { setBusy(false); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await gulatiApi.setAssetValue({ month: edit.month, asset_value: Number(edit.asset_value), ...(edit.notes ? { notes: edit.notes } : {}) });
      pushSuccess('Asset value saved');
      setEdit(null);
      load();
    } catch (err) { pushError(gulatiError(err, 'Could not save'), 'Could not save'); } finally { setSaving(false); }
  }
  async function remove(m) {
    if (!window.confirm(`Remove the asset value recorded for ${shortMonth(m.month)}? Later months will carry forward the earlier figure.`)) return;
    try { await gulatiApi.deleteAssetValue(m.month); pushSuccess('Asset value removed'); load(); } catch (err) { pushError(gulatiError(err, 'Could not remove'), 'Could not remove'); }
  }

  const months = data?.months || [];
  const latest = months[months.length - 1];
  const f = data?.formula || { profit: 240, asset_value: 3 };
  return (
    <div className="space-y-4">
      <section className={`${card} space-y-2`}>
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">How the valuation is calculated</h3>
        <p className="text-sm text-tertiary-600">Valuation = (Gulati net profit x {f.profit}) + (Asset value x {f.asset_value}). Net profit is the company net profit for the month (deals, deal expenses and company-level entries). Asset value is the figure an admin records for the month; a month without its own figure carries forward the latest earlier one.</p>
      </section>

      <div className={`${card} grid gap-3 sm:grid-cols-3`}>
        <label className={labelCls}>From month<input type="month" className={inputCls} value={q.from} max={q.to} onChange={(e) => e.target.value && setQ((c) => ({ ...c, from: e.target.value }))} /></label>
        <label className={labelCls}>To month<input type="month" className={inputCls} value={q.to} min={q.from} onChange={(e) => e.target.value && setQ((c) => ({ ...c, to: e.target.value }))} /></label>
        <label className={labelCls}>Profit taken from
          <select className={inputCls} value={q.state} onChange={(e) => setQ((c) => ({ ...c, state: e.target.value }))}>
            <option value="live">Live figures (all months)</option>
            <option value="closed">Closed months only</option>
          </select>
        </label>
      </div>

      {busy && <p className="text-xs text-tertiary-500" role="status">Updating for the new filter…</p>}
      <div className={busy ? 'opacity-60' : ''} aria-busy={busy}>
        {latest && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={`Valuation, ${shortMonth(latest.month)}`} value={<Money v={latest.valuation} />} tone="gx-copper" />
            <Kpi label={`Net profit x ${f.profit}`} value={<Money v={latest.profit_x} signed />} hint={`${inr(latest.profit)} net profit`} />
            <Kpi label={`Asset value x ${f.asset_value}`} value={<Money v={latest.asset_value_x} />} hint={`${inr(latest.asset_value)}${latest.asset_value_carried ? ' (carried forward)' : ''}`} />
            <Kpi label="Net profit (month)" value={<Money v={latest.profit} signed />} hint={latest.closed ? 'Month closed' : 'Month open'} />
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-primary-50/60 text-xs text-tertiary-500">
              <tr><Th>Month</Th><Th right>Revenue</Th><Th right>Net profit</Th><Th right>Profit x {f.profit}</Th><Th right>Asset value</Th><Th right>Asset x {f.asset_value}</Th><Th right>Valuation</Th><Th right>Asset value</Th></tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month} className="border-t">
                  <td className="px-3 py-2 font-medium">{shortMonth(m.month)}{m.closed && <span className="ml-1.5 text-[10px] text-tertiary-400">closed</span>}</td>
                  <td className="px-3 py-2 text-right"><Money v={m.revenue} /></td>
                  <td className="px-3 py-2 text-right"><Money v={m.profit} signed /></td>
                  <td className="px-3 py-2 text-right"><Money v={m.profit_x} signed /></td>
                  <td className="px-3 py-2 text-right"><Money v={m.asset_value} />{m.asset_value_carried && <span className="ml-1 text-[10px] text-tertiary-400">carried</span>}</td>
                  <td className="px-3 py-2 text-right"><Money v={m.asset_value_x} /></td>
                  <td className="px-3 py-2 text-right font-semibold"><Money v={m.valuation} /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button type="button" className="rounded p-1 text-tertiary-500 hover:text-primary-700" title="Set asset value" onClick={() => setEdit({ month: m.month, asset_value: m.asset_value || '', notes: m.asset_notes || '' })}><Pencil className="h-4 w-4" /></button>
                    {m.asset_value_id && <button type="button" className="rounded p-1 text-tertiary-500 hover:text-red-600" title="Remove asset value" onClick={() => remove(m)}><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
              {months.length === 0 && <tr><td className="px-3 py-6 text-center text-tertiary-400" colSpan={8}>No months in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `Asset value, ${shortMonth(edit.month)}` : ''}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Num label="Asset value" value={edit.asset_value} onChange={(v) => setEdit((c) => ({ ...c, asset_value: v }))} required />
            <Area label="Notes" rows={2} value={edit.notes} onChange={(v) => setEdit((c) => ({ ...c, notes: v }))} maxLength={500} />
            <p className="text-xs text-tertiary-500">Later months without their own figure carry this value forward.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEdit(null)} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
