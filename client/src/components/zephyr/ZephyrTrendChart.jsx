import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, shortMonth } from '../../lib/format.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';

// Zephyr palette: sage green for money in, earth brown for money out, charcoal for profit (from the logo).
export const ZX_CHART = { revenue: '#5BA372', expense: '#8B6A56', salaries: '#C9B8A8', profit: '#555555', grid: '#E0E9E2' };

/**
 * Month-by-month revenue / expense bars with a profit line. `rows` = [{ month, revenue, expense, salaries?, profit }].
 * When `showSalaries` is false (managers) the salaries series is omitted.
 */
export default function ZephyrTrendChart({ rows, showSalaries = true, height = 260, projectedFrom }) {
  const data = rows.map((r) => ({ ...r, label: shortMonth(r.month), projected: projectedFrom ? r.month >= projectedFrom : false }));
  const money = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
  return (
    <div style={{ height }} role="img" aria-label="Monthly revenue, expense and profit">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={ZX_CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v, name) => [money(v), name]} contentStyle={chartTooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="revenue" name="Revenue" fill={ZX_CHART.revenue} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expense" name="Expense" fill={ZX_CHART.expense} radius={[4, 4, 0, 0]} maxBarSize={22} />
          {showSalaries && <Bar dataKey="salaries" name="Salaries" fill={ZX_CHART.salaries} radius={[4, 4, 0, 0]} maxBarSize={22} />}
          <Line type="monotone" dataKey="profit" name="Profit" stroke={ZX_CHART.profit} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
