import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { ZK_COLORS, inr } from '../../lib/zklyrera/meta.js';

// Every Zklyrera chart is a line chart. Recharts only recognises its own elements as direct children of a chart,
// so the shared pieces are plain elements / element factories, not components.
const axis = (v) => `₹${compact(v)}`;
const PIE = [ZK_COLORS.ink, ZK_COLORS.brass, ZK_COLORS.slate, ZK_COLORS.wine, ZK_COLORS.sage, ZK_COLORS.projected, '#4B5563', '#C9B28A'];

function Frame({ height, label, empty, children }) {
  if (empty) return <div className="flex items-center justify-center text-sm text-tertiary-400" style={{ height: Math.min(height, 160) }}>Nothing to show for these filters.</div>;
  return <div style={{ height }} role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}
const grid = <CartesianGrid stroke={ZK_COLORS.grid} vertical={false} />;
const xAxis = (dataKey = 'label') => <XAxis dataKey={dataKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />;
const yAxis = <YAxis tickFormatter={axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={62} />;
const tip = <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} />;
const legend = <Legend wrapperStyle={{ fontSize: 12 }} />;
const margin = { top: 8, right: 14, left: 4, bottom: 0 };
const line = (key, name, color, extra = {}) => <Line key={key} isAnimationActive={false} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={2.25} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} {...extra} />;
const withLabel = (rows) => (rows || []).map((r) => ({ ...r, label: shortMonth(r.month) }));
const hasAny = (rows, keys) => (rows || []).some((r) => keys.some((k) => Number(r[k]) !== 0));

/** 1. Capital placed versus principal recovered, by month. */
export function InvestmentFlowChart({ rows, height = 270 }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly investment additions versus principal recovered" empty={!hasAny(data, ['investment_added', 'principal_returned'])}>
      <LineChart data={data} margin={margin}>{grid}{xAxis()}{yAxis}{tip}{legend}
        {line('investment_added', 'Investment added', ZK_COLORS.ink)}
        {line('principal_returned', 'Principal recovered', ZK_COLORS.brass)}
      </LineChart>
    </Frame>
  );
}

/** 2. Investment earnings and other income, by month. */
export function IncomeChart({ rows, height = 270 }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly investment earnings and other income" empty={!hasAny(data, ['investment_earnings', 'other_income'])}>
      <LineChart data={data} margin={margin}>{grid}{xAxis()}{yAxis}{tip}{legend}
        {line('investment_earnings', 'Investment earnings', ZK_COLORS.sage)}
        {line('other_income', 'Other income', ZK_COLORS.slate)}
      </LineChart>
    </Frame>
  );
}

/** 3. Expenses by category for the selected period: one point per category, largest first. */
export function CategoryChart({ rows, height = 250 }) {
  const data = (rows || []).filter((r) => r.amount > 0).map((r) => ({ ...r, label: r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name }));
  return (
    <Frame height={height} label="Expenses by category" empty={!data.length}>
      <LineChart data={data} margin={margin}>{grid}{xAxis()}{yAxis}
        <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [inr(v), 'Amount']} labelFormatter={(l, p) => p?.[0]?.payload?.name || l} />
        {line('amount', 'Amount', ZK_COLORS.brass)}
      </LineChart>
    </Frame>
  );
}

/** 4. Business expenses and salaries, by month. */
export function ExpenseTrendChart({ rows, height = 270, showSalary = true }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly expenses and salaries" empty={!hasAny(data, ['expenses_ex_salary', 'salaries'])}>
      <LineChart data={data} margin={margin}>{grid}{xAxis()}{yAxis}{tip}{legend}
        {line('expenses_ex_salary', 'Business expenses', ZK_COLORS.wine)}
        {showSalary && line('salaries', 'Salaries', ZK_COLORS.brass)}
      </LineChart>
    </Frame>
  );
}

/** 5 / 6. Projected versus actual, one side (income or expenses): solid = actual, dashed = the plan. */
export function ProjectedActualChart({ rows, side = 'income', height = 260 }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label={`Projected versus actual ${side}`} empty={!hasAny(data, [`projected_${side}`, `actual_${side}`])}>
      <LineChart data={data} margin={margin}>{grid}{xAxis()}{yAxis}{tip}{legend}
        {line(`actual_${side}`, 'Actual', side === 'income' ? ZK_COLORS.sage : ZK_COLORS.wine)}
        {line(`projected_${side}`, 'Projected', ZK_COLORS.projected, { strokeDasharray: '6 4' })}
      </LineChart>
    </Frame>
  );
}

/** 7. Net result by month. */
export function NetTrendChart({ rows, height = 260 }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly net result" empty={!hasAny(data, ['net_result'])}>
      <LineChart data={data} margin={margin}>{grid}{xAxis()}{yAxis}{tip}{legend}
        {line('net_result', 'Net result', ZK_COLORS.ink)}
      </LineChart>
    </Frame>
  );
}

/** 8. Investment by investment: expected return versus received (principal + earnings) and the earnings part. */
export function InvestmentReturnsChart({ rows, height = 270 }) {
  const data = (rows || []).filter((r) => r.expected_return_amount !== null || r.received > 0).map((r) => ({ name: r.code, full: r.name, expected: r.expected_return_amount || 0, received: r.received || 0, earnings: r.earnings || 0 }));
  return (
    <Frame height={height} label="Investment-wise expected versus actual returns" empty={!data.length}>
      <LineChart data={data} margin={margin}>{grid}{xAxis('name')}{yAxis}
        <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
        {legend}
        {line('expected', 'Expected return', ZK_COLORS.projected, { strokeDasharray: '6 4' })}
        {line('received', 'Received (principal + earnings)', ZK_COLORS.ink)}
        {line('earnings', 'Of which earnings', ZK_COLORS.brass)}
      </LineChart>
    </Frame>
  );
}

export { PIE as ZK_PIE };
