import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, shortMonth } from '../../lib/format.js';
import { chartTooltipStyle } from '../../lib/chartTheme.js';

// Gulati palette: logo green for sales, copper for purchase cost, slate for net profit.
export const GX_CHART = { sales: '#67A87A', cost: '#B06A3B', expenses: '#D9B99B', net: '#3F4B52', grid: '#DCE7E4' };

/** Month-by-month sales / purchase / expense bars with a net profit line. rows = by_month from /finance/pnl. */
export default function GulatiTrendChart({ rows, height = 260 }) {
  const data = rows.map((r) => ({ ...r, label: shortMonth(r.month), costs: r.purchase_cost, other: r.deal_expenses + r.company_expenses }));
  const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return (
    <div style={{ height }} role="img" aria-label="Monthly sales, purchase cost, expenses and net profit">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GX_CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v, name) => [money(v), name]} contentStyle={chartTooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sales_revenue" name="Sales" fill={GX_CHART.sales} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="costs" name="Purchase cost" fill={GX_CHART.cost} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="other" name="Expenses" fill={GX_CHART.expenses} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line type="monotone" dataKey="net_profit" name="Net profit" stroke={GX_CHART.net} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
