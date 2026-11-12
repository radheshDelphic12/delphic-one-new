import { useCallback, useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useDepartmentOptions } from '../../lib/lookups.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

// Reports > Joining & attrition: joiners and leavers by month, joining rate, attrition rate, departments and reasons. Every count opens its people.
//   joining rate   = joiners / average headcount x 100
//   attrition rate = leavers / average headcount x 100 (annualised = x 12 / months)

const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const thr = `${th} text-right`;
const td = 'px-3 py-2 tabular-nums';
const tdr = `${td} text-right`;
const KIND_TITLE = { joiners: 'Joiners', leavers: 'Leavers', headcount: 'Headcount at the end', early_leavers: 'Left within 6 months of joining' };

const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthsAgo = (n) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };

function Count({ value, onClick, tone = '' }) {
  if (!value) return <span className="text-tertiary-400">0</span>;
  return <button type="button" data-testid="movement-count" onClick={onClick} title="Click to see the people" className={`min-w-[1.5rem] rounded-md px-1.5 py-0.5 font-semibold tabular-nums hover:bg-primary-50 hover:underline ${tone}`}>{value}</button>;
}

function Stat({ label, children, hint }) {
  return (
    <div className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-card">
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold text-tertiary-900">{children}</p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary-500">{hint}</p>}
    </div>
  );
}

export default function JoiningAttrition() {
  const { pushError } = useAlerts();
  const departments = useDepartmentOptions(true);
  const [from, setFrom] = useState(monthsAgo(11));
  const [to, setTo] = useState(thisMonth());
  const [department, setDepartment] = useState('');
  const [contractors, setContractors] = useState(false);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null); // { kind, month?, title }
  const [rows, setRows] = useState(null);

  const params = useCallback(() => ({ from, to, ...(department ? { department_id: department } : {}), ...(contractors ? { include_contractors: true } : {}) }), [from, to, department, contractors]);

  useEffect(() => {
    setData(null);
    apiClient.get('/reports/joining-attrition', { params: params() }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ months: [] }); pushError(apiErrorMessage(err, 'Could not load the report'), 'Load failed'); });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setRows(null); return; }
    setRows(null);
    apiClient.get('/reports/joining-attrition/details', { params: { ...params(), kind: open.kind, ...(open.month ? { month: open.month } : {}) } })
      .then(({ data: res }) => setRows(res.data.rows)).catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Could not load the people'), 'Load failed'); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (kind, title, month) => () => setOpen({ kind, month, title });
  const s = data?.summary;

  return (
    <div className="space-y-4" data-testid="joining-attrition">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <label className="block text-xs font-medium text-tertiary-600">From month<input type="month" aria-label="From month" className="mt-1 block rounded-xl border border-tertiary-200 px-3 py-2 text-sm" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="block text-xs font-medium text-tertiary-600">To month<input type="month" aria-label="To month" className="mt-1 block rounded-xl border border-tertiary-200 px-3 py-2 text-sm" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Department</label>
          <SearchableSelect ariaLabel="Department" allowClear value={department} onChange={setDepartment} options={departments} placeholder="All departments" searchPlaceholder="Search…" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-tertiary-700"><input type="checkbox" checked={contractors} onChange={(e) => setContractors(e.target.checked)} /> Include contractors</label>
      </div>

      {!data ? <Skeleton className="h-64" /> : !s ? <EmptyState title="Nothing to show" description="Pick a range of months." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Joining rate" hint={`${s.joiners} joined / average headcount ${s.average_headcount}`}>{s.joining_rate}%</Stat>
            <Stat label="Attrition rate" hint={`${s.leavers} left / average headcount ${s.average_headcount} · ${s.attrition_rate_annualised}% a year`}>{s.attrition_rate}%</Stat>
            <Stat label="Joined"><Count value={s.joiners} onClick={show('joiners', 'Joiners')} /></Stat>
            <Stat label="Left"><Count value={s.leavers} onClick={show('leavers', 'Leavers')} /></Stat>
            <Stat label="Headcount at the start">{s.opening}</Stat>
            <Stat label="Headcount at the end"><Count value={s.closing} onClick={show('headcount', KIND_TITLE.headcount)} /></Stat>
            <Stat label={`Left within ${s.early_months} months`} hint="Early attrition: people who did not stay"><Count value={s.early_leavers} onClick={show('early_leavers', KIND_TITLE.early_leavers)} /></Stat>
            <Stat label="Average stay of those who left" hint="in months">{s.avg_tenure_of_leavers_months ?? '—'}</Stat>
          </div>

          <ChartCard title="Joiners, leavers and attrition rate by month" subtitle="Bars are people; the line is the month's attrition rate">
            <div className="h-64 w-full">
              <ResponsiveContainer>
                <ComposedChart data={data.months} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="people" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="rate" orientation="right" unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend />
                  <Bar yAxisId="people" dataKey="joiners" name="Joined" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="people" dataKey="leavers" name="Left" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="rate" type="monotone" dataKey="attrition_rate" name="Attrition rate %" stroke={CHART_COLORS.primary} strokeWidth={2} dot />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
            <table className="min-w-full text-sm" data-testid="movement-months">
              <thead className="bg-canvas-muted"><tr><th className={th}>Month</th><th className={thr}>Opening</th><th className={thr}>Joined</th><th className={thr}>Left</th><th className={thr}>Closing</th><th className={thr}>Joining rate</th><th className={thr}>Attrition rate</th></tr></thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.key} className="border-t border-tertiary-100">
                    <td className={`${td} font-medium`}>{m.label}</td>
                    <td className={tdr}>{m.opening}</td>
                    <td className={tdr}><Count value={m.joiners} tone="text-success-700" onClick={show('joiners', `Joined in ${m.label}`, m.key)} /></td>
                    <td className={tdr}><Count value={m.leavers} tone="text-danger-600" onClick={show('leavers', `Left in ${m.label}`, m.key)} /></td>
                    <td className={tdr}>{m.closing}</td>
                    <td className={tdr}>{m.joining_rate}%</td>
                    <td className={tdr}>{m.attrition_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
              <h3 className="px-3 pt-3 font-heading text-sm font-semibold text-tertiary-900">By department</h3>
              <table className="min-w-full text-sm" data-testid="movement-departments">
                <thead><tr><th className={th}>Department</th><th className={thr}>Start</th><th className={thr}>Joined</th><th className={thr}>Left</th><th className={thr}>Attrition</th></tr></thead>
                <tbody>
                  {data.departments.map((d) => (
                    <tr key={d.department_id || 'none'} className="border-t border-tertiary-100">
                      <td className={`${td} font-medium`}>{d.department}</td><td className={tdr}>{d.opening}</td><td className={tdr}>{d.joiners}</td><td className={tdr}>{d.leavers}</td><td className={tdr}>{d.attrition_rate}%</td>
                    </tr>
                  ))}
                  {!data.departments.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-tertiary-500">No movement in these months.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card">
              <h3 className="px-3 pt-3 font-heading text-sm font-semibold text-tertiary-900">Why people left</h3>
              <table className="min-w-full text-sm" data-testid="movement-reasons">
                <thead><tr><th className={th}>Reason</th><th className={thr}>People</th><th className={thr}>Share</th></tr></thead>
                <tbody>
                  {data.reasons.map((r) => <tr key={r.reason} className="border-t border-tertiary-100"><td className={td}>{r.reason}</td><td className={tdr}>{r.count}</td><td className={tdr}>{r.share}%</td></tr>)}
                  {!data.reasons.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-sm text-tertiary-500">Nobody left in these months.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-tertiary-500">Headcount counts people on the payroll on that day: joined on or before it, and not yet left. Contractors are left out unless you include them.</p>
        </>
      )}

      <Drawer open={Boolean(open)} title={open?.title || ''} onClose={() => setOpen(null)} size="lg">
        {!rows ? <Skeleton className="h-40" /> : (
          <table className="min-w-full text-sm" data-testid="movement-people">
            <thead><tr><th className={th}>Name</th><th className={th}>Department</th><th className={th}>Joined</th><th className={th}>Left</th><th className={thr}>Months</th><th className={th}>Reason</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-tertiary-100">
                  <td className={`${td} font-medium`}>{p.name}{p.employee_code && <span className="block text-[11px] font-normal text-tertiary-500">{p.employee_code}</span>}</td>
                  <td className={td}>{p.department || '—'}</td><td className={td}>{p.joined_at}</td><td className={td}>{p.left_at || '—'}</td><td className={tdr}>{p.tenure_months ?? '—'}</td><td className={td}>{p.reason || '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-tertiary-500">No one.</td></tr>}
            </tbody>
          </table>
        )}
      </Drawer>
    </div>
  );
}
