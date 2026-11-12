import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { inr } from '../../lib/foundation/meta.js';

// One palette for the whole Foundation workspace (the greens of the logo, plus a warm amber for "actual").
export const FX_COLORS = { planned: '#9CC9AB', investment: '#2F7A4F', expenditure: '#D9993D', funding: '#5B8DB8', projected: '#7A6BB5', grid: '#E3ECE6' };
const axis = (v) => `₹${compact(v)}`;

/** Planned versus actual by month, with the projection as a dashed line. rows come from the server's monthly series. */
export function MonthlyChart({ rows, height = 280, showProjected = true, showFunding = false }) {
  const data = rows.map((r) => ({ ...r, label: shortMonth(r.month) }));
  if (!data.length) return <div className="flex h-40 items-center justify-center text-sm text-tertiary-400">No monthly figures yet.</div>;
  return (
    <div style={{ height }} role="img" aria-label="Monthly planned investment, actual investment, expenditure and projection">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={FX_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={62} />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="planned_investment" name="Planned investment" fill={FX_COLORS.planned} radius={[4, 4, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="actual_investment" name="Actual investment" fill={FX_COLORS.investment} radius={[4, 4, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="actual_expenditure" name="Actual expenditure" fill={FX_COLORS.expenditure} radius={[4, 4, 0, 0]} />
          {showFunding && <Line isAnimationActive={false} type="monotone" dataKey="funding_received" name="Funds received" stroke={FX_COLORS.funding} strokeWidth={2} dot={false} />}
          {showProjected && <Line isAnimationActive={false} type="monotone" dataKey="projected" name="Projected spending" stroke={FX_COLORS.projected} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2.5 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Generic report chart: bars or a line over the rows the report endpoint returned. */
export function ReportChart({ chart, rows, height = 300 }) {
  const data = chart.data || rows;
  const palette = [FX_COLORS.investment, FX_COLORS.expenditure, FX_COLORS.funding, FX_COLORS.projected];
  const isPct = chart.series.every((s) => /%/.test(s.label));
  const fmt = (v) => (isPct ? `${v}%` : inr(v));
  const Series = chart.kind === 'line' ? Line : Bar;
  return (
    <div style={{ height }} role="img" aria-label="Report chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={FX_COLORS.grid} vertical={false} />
          <XAxis dataKey={chart.x} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tickFormatter={isPct ? (v) => `${v}%` : axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={62} />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [fmt(v), name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {chart.series.map((s, i) => (chart.kind === 'line'
            ? <Series key={s.key} isAnimationActive={false} type="monotone" dataKey={s.key} name={s.label} stroke={palette[i % palette.length]} strokeWidth={2} dot={false} />
            : <Series key={s.key} isAnimationActive={false} dataKey={s.key} name={s.label} fill={palette[i % palette.length]} radius={[4, 4, 0, 0]} />))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
