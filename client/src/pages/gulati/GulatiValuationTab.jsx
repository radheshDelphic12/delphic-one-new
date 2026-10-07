import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Area as ChartArea, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { inr as inrShort } from '../../lib/gulati/meta.js';
import Modal from '../../components/ui/Modal.jsx';
import { Area, Kpi, Money, Num, card, inputCls, labelCls } from '../../components/gulati/ui.jsx';
import { compact, shortMonth } from '../../lib/format.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import { GX_CHART } from '../../components/gulati/GulatiTrendChart.jsx';

const inr = (n) => `${Number(n) < 0 ? '-' : ''}₹${Math.abs(Number(n || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsAgo = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};
const Th = ({ children, right }) => <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;

const rupee = (n) => `${Number(n) < 0 ? '-' : ''}₹${compact(Math.abs(Number(n || 0)))}`;

// One month-on-month line: smooth line with a soft fill, a value on every point and the exact amount in the tooltip.
function TrendChart({ title, subtitle, data, dataKey, color, name, className = '' }) {
  const gradientId = `gx-trend-${dataKey}`;
  return (
    <ChartCard title={title} subtitle={subtitle} className={className}>
      <div className="h-72" data-testid={`gx-trend-${dataKey}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 22, right: 16, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GX_CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={rupee} tick={{ fontSize: 11 }} width={64} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [inr(v), name]} />
            <ChartArea type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false}>
              <LabelList dataKey={dataKey} position="top" formatter={(v) => (v ? rupee(v) : '')} style={{ fontSize: 10, fill: '#6B7280' }} />
            </ChartArea>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// Valuation = (Gulati net profit x 240) + (asset value x 3), month by month, with the working shown for each month.
export default function GulatiValuationTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [q, setQ] = useState({ from: monthsAgo(11), to: thisMonth(), state: 'live' });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const alertsRef = useRef({ pushError });
  useEffect(() => { alertsRef.current = { pushError }; });

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
  const chartRows = months.map((m) => ({ ...m, label: shortMonth(m.month) }));
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
            <Kpi label={`Net profit x ${f.profit}`} value={<Money v={latest.profit_x} signed />} hint={`${inrShort(latest.profit)} net profit`} />
            <Kpi label={`Asset value x ${f.asset_value}`} value={<Money v={latest.asset_value_x} />} hint={`${inrShort(latest.asset_value)}${latest.asset_value_carried ? ' (carried forward)' : ''}`} />
            <Kpi label="Net profit (month)" value={<Money v={latest.profit} signed />} hint={latest.closed ? 'Month closed' : 'Month open'} />
          </div>
        )}

        {months.length > 0 && (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <TrendChart title="Revenue — month on month" subtitle="Gulati sales revenue per month" data={chartRows} dataKey="revenue" name="Revenue" color={GX_CHART.sales} />
            <TrendChart title="Profit — month on month" subtitle="Gulati net profit per month" data={chartRows} dataKey="profit" name="Net profit" color={GX_CHART.net} />
            <TrendChart className="xl:col-span-2" title="Valuation — month on month" subtitle="(Net profit × 240) + (Asset value × 3)" data={chartRows} dataKey="valuation" name="Valuation" color={GX_CHART.cost} />
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
