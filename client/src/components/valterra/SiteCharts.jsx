import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { VT_COLORS, inr } from '../../lib/valterra/meta.js';

// Line charts only. Recharts only recognises its own elements as direct children of a chart, so the shared pieces are plain elements.
const SITE_PALETTE = [VT_COLORS.ink, VT_COLORS.brass, VT_COLORS.sage, VT_COLORS.wine, VT_COLORS.slate, '#4F7CAC', '#8E6C8A', '#C48B5C'];
const grid = <CartesianGrid stroke={VT_COLORS.grid} vertical={false} />;
const xAxis = <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />;
const yAxis = <YAxis tickFormatter={(v) => `₹${compact(v)}`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={62} />;
const tip = <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} />;
const legend = <Legend wrapperStyle={{ fontSize: 12 }} />;

/**
 * One line per mining site over the months (investment, revenue, expenses or net result by site). `keys` is
 * [{ id, code, name }] and `rows` carries one value per site id for every month.
 */
export function SiteLineChart({ rows, keys, height = 270, label }) {
  const data = (rows || []).map((r) => ({ ...r, label: shortMonth(r.month) }));
  const any = data.some((r) => keys.some((k) => Number(r[k.id]) !== 0));
  if (!keys.length || !any) return <div className="flex items-center justify-center text-sm text-tertiary-400" style={{ height: 160 }}>Nothing to show for these filters.</div>;
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: 0 }}>
          {grid}{xAxis}{yAxis}{tip}{legend}
          {keys.map((k, i) => (
            <Line key={k.id} isAnimationActive={false} type="monotone" dataKey={k.id} name={k.name} stroke={SITE_PALETTE[i % SITE_PALETTE.length]} strokeWidth={2.25} dot={{ r: 3, strokeWidth: 0, fill: SITE_PALETTE[i % SITE_PALETTE.length] }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
