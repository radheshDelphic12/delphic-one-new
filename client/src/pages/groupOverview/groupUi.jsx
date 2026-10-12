import { ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, CartesianGrid, Line, LineChart } from 'recharts';
import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Building2, ChevronDown, Minus } from 'lucide-react';
import { orgLogo } from '../../lib/orgLogo.js';

/**
 * Presentation-only building blocks for the Group Dashboard (hero, tab bar, stat tiles, company cards, donut,
 * trend chart). Nothing here fetches or calculates money: every figure is handed in by the tab that owns it.
 */

// One colour per company by position, calm and distinguishable (also used for the activity feed chips).
export const COMPANY_COLORS = ['#1f6f50', '#2b5d9e', '#b9822a', '#7a5c9e', '#2c7a85', '#a8443f', '#5b7a2e', '#5c6b7a', '#9a5b2e', '#3f7d73'];
export const colorAt = (i) => COMPANY_COLORS[((i % COMPANY_COLORS.length) + COMPANY_COLORS.length) % COMPANY_COLORS.length];

export const money = (n) => (n === null || n === undefined ? 'N/A' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
export const compact = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`;
  return `${sign}₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

/** Page banner: kept exactly as the original design (green gradient, large logo, short description). */
export function GroupHero({ title = 'Gulati Industries', logo = '/group-logo.svg' }) {
  return (
    <div className="flex flex-wrap items-center gap-5 overflow-hidden rounded-2xl bg-gradient-to-r from-[#1f3a2c] via-[#2f5d43] to-[#4f8f60] p-4 text-white shadow-card sm:p-5">
      <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-soft sm:h-28 sm:w-40">
        <img src={logo} alt={title} className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Multi-organization group</p>
        <h2 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-white/80">One view of every company in the group: revenue, profit, assets and valuation side by side. Open any company from the sidebar to work inside it; the Group Dashboard link brings you back.</p>
      </div>
    </div>
  );
}

/** Section tabs: kept exactly as the original underline bar. */
export function GroupTabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${value === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`}
          onClick={() => onChange(key)}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Section heading: title on the left, a muted hint on the right, a hairline underneath. */
export function SectionHeading({ title, hint }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-tertiary-200 pb-2 pt-5">
      <h2 className="font-heading text-[15px] font-semibold tracking-tight text-tertiary-900">{title}</h2>
      {hint && <span className="text-xs text-tertiary-500">{hint}</span>}
    </div>
  );
}

/** Change versus the previous period: an arrow and a percentage in text (green good, red bad, grey flat). `invert` flips it for costs. */
export function DeltaPill({ pct, invert = false, suffix = 'vs previous period' }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return <span className="whitespace-nowrap text-xs text-tertiary-400">No prior period</span>;
  const n = Number(pct);
  const flat = n === 0;
  const good = invert ? n < 0 : n > 0;
  const Icon = flat ? Minus : n > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = flat ? 'text-tertiary-500' : good ? 'text-emerald-700' : 'text-rose-700';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tertiary-500">
      <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${tone}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {Math.abs(n)}%
      </span>
      {suffix}
    </span>
  );
}

/** Headline figure: label, value, change versus the previous period and a thin trend line. One neutral style for every tile. */
export function StatTile({ label, value, icon: Icon, pct, invert, series, note }) {
  const points = (series || []).map((v, i) => ({ i, v: Number(v) || 0 }));
  const showSpark = points.length > 1 && points.some((p) => p.v !== points[0].v);
  return (
    <div className="rounded-xl border border-tertiary-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary-500">{label}</div>
          <div className="mt-1.5 truncate font-heading text-2xl font-semibold leading-none tabular-nums text-tertiary-900">{value ?? '—'}</div>
        </div>
        {Icon && (
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tertiary-50 text-tertiary-500">
            <Icon className="h-4 w-4" strokeWidth={1.9} />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          {note ? <span className="text-xs text-tertiary-500">{note}</span> : <DeltaPill pct={pct} invert={invert} suffix={showSpark ? '' : undefined} />}
        </div>
        {showSpark && (
          <div className="h-8 w-24 shrink-0" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
                <Line type="monotone" dataKey="v" stroke="#4b7f66" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ org, color }) {
  const logo = orgLogo(org);
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-tertiary-100 bg-white shadow-sm">
      {logo ? <img src={logo} alt="" className="h-full w-full object-contain p-1" /> : <Building2 className="h-4 w-4" style={{ color }} />}
    </span>
  );
}

/**
 * Every company, one card shape: a colour key, name and status; revenue / profit / margin; a thin revenue + profit
 * line when the series has several points; and the company's share of group revenue with its valuation.
 */
export function CompanyCard({ company, color, groupRevenue, onOpen, series: seriesOverride }) {
  const { org } = company;
  if (company.coming_soon) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-tertiary-300 bg-tertiary-50/60 p-4 text-tertiary-400">
        <Avatar org={org} color="#94a3b8" />
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-tertiary-500">{org.name}</p>
          <span className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Coming soon</span>
        </div>
      </div>
    );
  }
  const t = company.totals;
  const loss = t.profit < 0;
  const share = groupRevenue > 0 && t.revenue > 0 ? Math.min(100, (t.revenue / groupRevenue) * 100) : 0;
  const status = !company.has_data ? ['No data', 'bg-tertiary-300', 'text-tertiary-500'] : loss ? ['Loss', 'bg-rose-500', 'text-rose-700'] : ['Profit', 'bg-emerald-500', 'text-emerald-700'];
  const series = (seriesOverride || company.series || []).map((r) => ({ label: r.label, revenue: Number(r.revenue) || 0, profit: Number(r.profit) || 0 }));
  const showLine = series.length > 1 && series.some((p) => p.revenue || p.profit);
  return (
    <button
      type="button"
      onClick={() => onOpen(org)}
      className="group flex flex-col rounded-xl border border-tertiary-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-tertiary-300 hover:bg-tertiary-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <div className="flex items-center gap-3">
        <Avatar org={org} color={color} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-heading text-sm font-semibold leading-tight text-tertiary-900">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} aria-hidden="true" />
            <span className="truncate">{org.name}</span>
          </p>
          <p className="text-[11px] text-tertiary-500">{company.people.employees + company.people.contractors} people</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${status[2]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status[1]}`} aria-hidden="true" />
          {status[0]}
        </span>
      </div>

      {company.has_data ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Revenue</div>
            <div className="text-[15px] font-semibold tabular-nums text-tertiary-900">{compact(t.revenue)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Profit</div>
            <div className={`text-[15px] font-semibold tabular-nums ${loss ? 'text-rose-700' : 'text-tertiary-900'}`}>{compact(t.profit)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Margin</div>
            <div className="text-[15px] font-semibold tabular-nums text-tertiary-900">{t.margin_pct === null || t.margin_pct === undefined ? 'N/A' : `${t.margin_pct}%`}</div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-tertiary-400">Nothing recorded in this period.</p>
      )}

      {showLine && (
        <div className="mt-2 h-11" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
              <XAxis dataKey="label" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Line type="monotone" dataKey="revenue" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="profit" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2" title="Share of group revenue">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-tertiary-100">
          <div className="h-full rounded-full" style={{ width: `${share}%`, background: color }} />
        </div>
        <span className="w-9 text-right text-[10px] font-medium tabular-nums text-tertiary-500">{share ? `${share.toFixed(share < 10 ? 1 : 0)}%` : '—'}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-tertiary-100 pt-2.5 text-[11px] text-tertiary-500">
        <span>Valuation <b className="font-semibold text-tertiary-800">{company.valuation ? compact(company.valuation.current) : 'N/A'}</b></span>
        <span className="font-medium text-primary-700 opacity-0 transition-opacity group-hover:opacity-100">Details →</span>
      </div>
    </button>
  );
}

/**
 * A closed-by-default panel: a header button with an icon, a count badge and a chevron; its content shows only when
 * the user asks for it. Used for alerts and "needs attention" lists so they do not crowd the page.
 */
export function Disclosure({ title, count, icon: Icon, tone = 'amber', defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const tones = {
    amber: 'border-amber-200 bg-amber-50/60 text-amber-900',
    slate: 'border-tertiary-100 bg-white text-tertiary-800',
  };
  return (
    <div className={`overflow-hidden rounded-xl border ${tones[tone] || tones.amber}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-semibold">
        {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count != null && <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm">{count}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && <div className="border-t border-black/5 bg-white/70 p-3.5 text-sm">{children}</div>}
    </div>
  );
}

function ShareTooltip({ active, payload, label, companies }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null).sort((a, b) => b.value - a.value);
  return (
    <div className="min-w-[10rem] rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-tertiary-900">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 py-0.5">
          <span className="flex items-center gap-1.5 text-tertiary-600"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{companies.find((c) => c.org.id === p.dataKey)?.org.name || p.name}</span>
          <span className="font-semibold tabular-nums text-tertiary-900">{p.value}%</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Each company's share of the group total over time (a line per company), with the share for the whole selected
 * period listed beside it. Shares come from the trend rows the tab already has; a company in loss counts as 0%.
 */
export function ContributionLines({ title, subtitle, trendRows, rows, companies, colorOfOrg }) {
  const series = trendRows.map((r) => {
    // Same rule as the server's contribution table: only companies in profit count, so the shares add up to 100%.
    const total = companies.reduce((sum, c) => sum + Math.max(0, Number(r[c.org.id]) || 0), 0);
    const point = { label: r.label };
    for (const c of companies) {
      const v = Number(r[c.org.id]);
      point[c.org.id] = total > 0 && Number.isFinite(v) ? Math.round((Math.max(0, v) / total) * 1000) / 10 : null;
    }
    return point;
  });
  const legend = rows
    .map((r) => ({ id: r.org_id, name: r.org_name, share: r.share_pct ?? 0, value: r.value }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share);
  const hasLines = series.some((p) => companies.some((c) => p[c.org.id] != null));
  return (
    <div className="rounded-xl border border-tertiary-200 bg-white p-4 shadow-sm">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
      <p className="text-xs text-tertiary-500">{subtitle}</p>
      {!hasLines ? (
        <p className="py-10 text-center text-sm text-tertiary-500">Nothing to compare in this period.</p>
      ) : (
        <>
          <ChartFrame className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 18, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: '#d5ddd8' }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} width={44} axisLine={false} tickLine={false} />
                <RTooltip content={<ShareTooltip companies={companies} />} cursor={{ stroke: '#b9c6be' }} />
                {companies.map((c) => (
                  <Line key={c.org.id} dataKey={c.org.id} name={c.org.name} connectNulls {...lineProps(colorOfOrg(c.org.id), series.length)} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
          <ShortPeriodHint count={series.length} />
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {legend.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: colorOfOrg(d.id) }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-tertiary-700">{d.name}</span>
                <span className="font-semibold tabular-nums text-tertiary-900">{d.share}%</span>
                <span className="w-16 text-right text-xs tabular-nums text-tertiary-500">{compact(d.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---- shared line-chart styling: hairline grid, thin smooth lines, no markers until hover -------------------------------
export const GRID_PROPS = { vertical: false, stroke: '#e6ece8' };
export const AXIS_TICK = { fontSize: 11, fill: '#6b7c72' };

/** Props for a <Line>: a smooth 2px line with no markers; hovering shows a single ringed point. Dots only for very short series. */
export function lineProps(color, count = 0, { dashed = false, width = 2 } = {}) {
  return {
    type: 'monotone',
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeDasharray: dashed ? '6 4' : undefined,
    dot: count > 0 && count <= 2 ? { r: 3, fill: color, stroke: '#fff', strokeWidth: 1.5 } : false,
    activeDot: { r: 4.5, fill: color, stroke: '#fff', strokeWidth: 2 },
    animationDuration: 500,
    label: false,
  };
}

/** Plain wrapper that fixes the chart height. */
export function ChartFrame({ children, className = 'h-72' }) {
  return <div className={className}>{children}</div>;
}

/** A one-line note when the period is too short to draw a trend. */
export function ShortPeriodHint({ count }) {
  if (count >= 3) return null;
  return <p className="mt-2 text-[11px] text-tertiary-500">Only {count === 1 ? 'one period' : 'two periods'} in this range. Pick a quarter or a financial year above to see the line.</p>;
}

function TrendTooltip({ active, payload, label, companies }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null).sort((a, b) => b.value - a.value);
  return (
    <div className="min-w-[10rem] rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-tertiary-900">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 py-0.5">
          <span className="flex items-center gap-1.5 text-tertiary-600"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{companies.find((c) => c.org.id === p.dataKey)?.org.name || p.name}</span>
          <span className="font-semibold tabular-nums text-tertiary-900">{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Multi-company trend: thin smooth lines on a hairline grid, a ranked tooltip and a plain legend with each latest value. */
export function TrendLines({ rows, companies, colorOfOrg, metric }) {
  const latest = (id) => {
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i][id] != null && rows[i][id] !== '') return Number(rows[i][id]);
    return null;
  };
  return (
    <div>
      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: '#d5ddd8' }} tickLine={false} />
            <YAxis tick={AXIS_TICK} tickFormatter={compact} width={72} axisLine={false} tickLine={false} />
            <RTooltip content={<TrendTooltip companies={companies} />} cursor={{ stroke: '#b9c6be' }} />
            {companies.map((c) => (
              <Line key={`${metric}-${c.org.id}`} dataKey={c.org.id} name={c.org.name} connectNulls {...lineProps(colorOfOrg(c.org.id), rows.length)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ShortPeriodHint count={rows.length} />
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 border-t border-tertiary-100 pt-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {companies.map((c) => (
          <li key={c.org.id} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: colorOfOrg(c.org.id) }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-tertiary-600">{c.org.name}</span>
            {latest(c.org.id) != null && <span className="font-semibold tabular-nums text-tertiary-900">{compact(latest(c.org.id))}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Top-N list: plain rank numbers and a thin relative bar. */
export function RankCard({ title, rows, format }) {
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.value) || 0)), 1);
  return (
    <div className="rounded-xl border border-tertiary-200 bg-white p-4 shadow-sm">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{title}</h4>
      <ol className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.org_id}>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-tertiary-400">{r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-tertiary-800">{r.org_name}</span>
              <span className="font-semibold tabular-nums text-tertiary-900">{format(r.value)}</span>
            </div>
            <div className="ml-6 mt-1 h-1 overflow-hidden rounded-full bg-tertiary-100">
              <div className="h-full rounded-full bg-primary-600/80" style={{ width: `${Math.max(3, Math.min(100, (Math.abs(Number(r.value) || 0) / max) * 100))}%` }} />
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-tertiary-500">Nothing to rank yet.</li>}
      </ol>
    </div>
  );
}

const KPI_TONE = { blue: 'blue', green: 'green', purple: 'violet', orange: 'amber', red: 'rose', cyan: 'teal' };

/** Drop-in for the shared `KpiCard` props (label, value, hint, icon, theme) so the company sections match the new look. */
export function KpiTile({ label, value, hint, icon, theme = 'blue' }) {
  return <StatTile label={label} value={value} icon={icon} tone={KPI_TONE[theme] || 'blue'} note={hint || ' '} />;
}
