import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, shortMonth } from '../../lib/format.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';

// Acconcy palette from the logo: plum for revenue, a soft rose for expenses, gold for net profit.
export const AX_CHART = { revenue: '#722F50', expenses: '#D9A9C0', net: '#B08D3C', grid: '#EADCE3' };

/** Month-by-month revenue / expense bars with a net profit line. rows = by_month from /finance/pnl. */
export default function AcconcyTrendChart({ rows, height = 260 }) {
  const data = rows.map((r) => ({ ...r, label: shortMonth(r.month) }));
  const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return (
    <div style={{ height }} role="img" aria-label="Monthly revenue, expenses and net profit">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={AX_CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v, name) => [money(v), name]} contentStyle={chartTooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="revenue" name="Revenue" fill={AX_CHART.revenue} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expenses" name="Expenses" fill={AX_CHART.expenses} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line type="monotone" dataKey="net_profit" name="Net profit" stroke={AX_CHART.net} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
