import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, shortMonth } from '../../lib/format.js';
import { ZK_COLORS, inr } from '../../lib/zklyrera/meta.js';

const axis = (v) => `₹${compact(v)}`;
const PIE = [ZK_COLORS.ink, ZK_COLORS.brass, ZK_COLORS.slate, ZK_COLORS.wine, ZK_COLORS.sage, ZK_COLORS.projected, '#4B5563', '#C9B28A'];

function Frame({ height, label, empty, children }) {
  if (empty) return <div className="flex items-center justify-center text-sm text-tertiary-400" style={{ height: Math.min(height, 160) }}>Nothing to show for these filters.</div>;
  return <div style={{ height }} role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}
// Recharts only recognises its own elements as direct children of a chart, so these are plain elements / element factories, not components.
const grid = <CartesianGrid stroke={ZK_COLORS.grid} vertical={false} />;
const xAxis = (dataKey = 'label') => <XAxis dataKey={dataKey} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />;
const yAxis = <YAxis tickFormatter={axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={62} />;
const tip = <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} />;
const withLabel = (rows) => (rows || []).map((r) => ({ ...r, label: shortMonth(r.month) }));
const hasAny = (rows, keys) => (rows || []).some((r) => keys.some((k) => Number(r[k]) !== 0));

/** 1. Capital placed versus principal recovered, by month. */
export function InvestmentFlowChart({ rows, height = 270 }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly investment additions versus principal recovered" empty={!hasAny(data, ['investment_added', 'principal_returned'])}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        {grid}{xAxis()}{yAxis}{tip}<Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="investment_added" name="Investment added" fill={ZK_COLORS.ink} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="principal_returned" name="Principal recovered" fill={ZK_COLORS.brass} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

/** 2. Investment earnings and other income, by month. */
export function IncomeChart({ rows, height = 270 }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly investment earnings and other income" empty={!hasAny(data, ['investment_earnings', 'other_income'])}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        {grid}{xAxis()}{yAxis}{tip}<Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} stackId="inc" dataKey="investment_earnings" name="Investment earnings" fill={ZK_COLORS.sage} />
        <Bar isAnimationActive={false} stackId="inc" dataKey="other_income" name="Other income" fill={ZK_COLORS.slate} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

/** 3. Expenses by category for the selected period (donut + the legend as a list is added by the page). */
export function CategoryChart({ rows, height = 250 }) {
  const data = (rows || []).filter((r) => r.amount > 0);
  return (
    <Frame height={height} label="Expenses by category" empty={!data.length}>
      <PieChart>
        <Pie isAnimationActive={false} data={data} dataKey="amount" nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={2}>
          {data.map((c, i) => <Cell key={c.name} fill={PIE[i % PIE.length]} />)}
        </Pie>
        <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} />
      </PieChart>
    </Frame>
  );
}

/** 4. Salary (and total expense) trend by month. */
export function ExpenseTrendChart({ rows, height = 270, showSalary = true }) {
  const data = withLabel(rows);
  return (
    <Frame height={height} label="Monthly expenses and salaries" empty={!hasAny(data, ['expenses_ex_salary', 'salaries'])}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        {grid}{xAxis()}{yAxis}{tip}<Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} stackId="exp" dataKey="expenses_ex_salary" name="Business expenses" fill={ZK_COLORS.wine} />
        {showSalary && <Bar isAnimationActive={false} stackId="exp" dataKey="salaries" name="Salaries" fill={ZK_COLORS.brass} radius={[4, 4, 0, 0]} />}
      </BarChart>
    </Frame>
  );
}

/** 5 / 6. Projected versus actual, one side (income or expenses). rows: projected_income / actual_income ... from the dashboard. */
export function ProjectedActualChart({ rows, side = 'income', height = 260 }) {
  const data = withLabel(rows);
  const p = `projected_${side}`;
  const a = `actual_${side}`;
  return (
    <Frame height={height} label={`Projected versus actual ${side}`} empty={!hasAny(data, [p, a])}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        {grid}{xAxis()}{yAxis}{tip}<Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey={a} name="Actual" fill={side === 'income' ? ZK_COLORS.sage : ZK_COLORS.wine} radius={[4, 4, 0, 0]} />
        <Line isAnimationActive={false} type="monotone" dataKey={p} name="Projected" stroke={ZK_COLORS.projected} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2.5 }} />
      </ComposedChart>
    </Frame>
  );
}

/** 7. Net result by month (ink = profit, wine = loss). */
export function NetTrendChart({ rows, height = 260 }) {
  const data = withLabel(rows).map((r) => ({ ...r, profit: r.net_result >= 0 ? r.net_result : 0, loss: r.net_result < 0 ? r.net_result : 0 }));
  return (
    <Frame height={height} label="Monthly net result" empty={!hasAny(data, ['net_result'])}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        {grid}{xAxis()}{yAxis}{tip}<Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="profit" name="Net surplus" fill={ZK_COLORS.ink} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="loss" name="Net deficit" fill={ZK_COLORS.wine} radius={[0, 0, 4, 4]} />
        <Line isAnimationActive={false} type="monotone" dataKey="net_result" name="Net result" stroke={ZK_COLORS.brass} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Frame>
  );
}

/** 8. Investment by investment: expected return versus received (principal + earnings). */
export function InvestmentReturnsChart({ rows, height = 270 }) {
  const data = (rows || []).filter((r) => r.expected_return_amount !== null || r.received > 0).map((r) => ({ name: r.code, full: r.name, expected: r.expected_return_amount || 0, received: r.received || 0, earnings: r.earnings || 0 }));
  return (
    <Frame height={height} label="Investment-wise expected versus actual returns" empty={!data.length}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        {grid}{xAxis('name')}{yAxis}
        <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [inr(v), name]} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="expected" name="Expected return" fill={ZK_COLORS.projected} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="received" name="Received (principal + earnings)" fill={ZK_COLORS.ink} radius={[4, 4, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="earnings" name="Of which earnings" fill={ZK_COLORS.brass} radius={[4, 4, 0, 0]} />
      </BarChart>
    </Frame>
  );
}

export { PIE as ZK_PIE };
