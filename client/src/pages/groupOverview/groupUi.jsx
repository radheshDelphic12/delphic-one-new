import { ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, CartesianGrid, Line, LineChart } from 'recharts';
import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Building2, ChevronDown, Minus } from 'lucide-react';
import { orgLogo } from '../../lib/orgLogo.js';

/**
 * Presentation-only building blocks for the Group Dashboard (hero, tab bar, stat tiles, company cards, donut,
 * trend chart). Nothing here fetches or calculates money: every figure is handed in by the tab that owns it.
 */

// One colour per company by position, calm and distinguishable (also used for the activity feed chips).
export const COMPANY_COLORS = ['#2f7d57', '#2563eb', '#d97706', '#7c3aed', '#0e7490', '#be123c', '#4d7c0f', '#475569', '#c2410c', '#0f766e'];
export const colorAt = (i) => COMPANY_COLORS[((i % COMPANY_COLORS.length) + COMPANY_COLORS.length) % COMPANY_COLORS.length];

export const money = (n) => (n === null || n === undefined ? 'N/A' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
export const compact = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(2)} L`;
  return `${sign}₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Top banner: deep emerald with soft light and a faint dot grid, logo, a personal greeting and today's date. */
export function GroupHero({ userName, title = 'Gulati Industries', logo = '/group-logo.svg', subtitle }) {
  // "Group Super Admin" is a role label, not a first name: greet by name only when there is a real one.
  const first = String(userName || '').trim().split(/\s+/)[0];
  const greetName = first && first.toLowerCase() !== 'group' ? first : '';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="group-hero relative overflow-hidden rounded-3xl p-5 text-white shadow-card sm:p-6">
      <div className="relative z-10 flex flex-wrap items-center gap-5 sm:gap-7">
        <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-2xl bg-white p-3 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)] sm:h-28 sm:w-40">
          <img src={logo} alt={title} className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-100/80">Multi-organization group · {today}</p>
          <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-emerald-50/85">
            {subtitle || `${greeting()}${greetName ? `, ${greetName}` : ''}. One view of every company in the group: revenue, profit, assets and valuation side by side. Open any company from the sidebar to work inside it.`}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Pill-style section switcher; same `role=tab` contract the old underline bar had. */
export function GroupTabs({ tabs, value, onChange }) {
  return (
    <div className="overflow-x-auto" role="tablist" aria-label="Group sections">
      <div className="inline-flex min-w-full gap-1 rounded-2xl border border-tertiary-100 bg-white p-1.5 shadow-card sm:min-w-0">
        {tabs.map(({ key, label, icon: Icon }) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(key)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                active ? 'group-tab-active bg-gradient-to-b from-[#3a8a5f] to-[#2b6b48] text-white shadow-[0_6px_16px_-6px_rgba(43,107,72,0.7)]' : 'text-tertiary-600 hover:bg-primary-50 hover:text-primary-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Numbered section heading with a short accent bar. */
export function SectionHeading({ n, title, hint }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-4">
      {n != null && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#3a8a5f] to-[#1f4d33] text-xs font-bold text-white shadow-[0_4px_10px_-3px_rgba(31,77,51,0.6)]">{n}</span>
      )}
      <h2 className="font-heading text-lg font-bold tracking-tight text-tertiary-900">{title}</h2>
      {hint && <span className="text-xs text-tertiary-500">{hint}</span>}
      <span className="ml-1 hidden h-px flex-1 bg-gradient-to-r from-primary-200 to-transparent sm:block" aria-hidden="true" />
    </div>
  );
}

const TONES = {
  green: { chip: 'bg-emerald-100 text-emerald-700', glow: 'from-emerald-50', line: '#10b981' },
  blue: { chip: 'bg-blue-100 text-blue-700', glow: 'from-blue-50', line: '#3b82f6' },
  amber: { chip: 'bg-amber-100 text-amber-700', glow: 'from-amber-50', line: '#f59e0b' },
  violet: { chip: 'bg-violet-100 text-violet-700', glow: 'from-violet-50', line: '#8b5cf6' },
  teal: { chip: 'bg-teal-100 text-teal-700', glow: 'from-teal-50', line: '#14b8a6' },
  rose: { chip: 'bg-rose-100 text-rose-700', glow: 'from-rose-50', line: '#f43f5e' },
};

/** Up / down / flat pill. `invert` flips the colour meaning (rising expenses are bad news). */
export function DeltaPill({ pct, invert = false, suffix = 'vs previous period' }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return <span className="whitespace-nowrap text-xs text-tertiary-400">No prior period</span>;
  const n = Number(pct);
  const flat = n === 0;
  const good = invert ? n < 0 : n > 0;
  const Icon = flat ? Minus : n > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = flat ? 'bg-tertiary-100 text-tertiary-600' : good ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tertiary-500">
      <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold tabular-nums ${tone}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />
        {Math.abs(n)}%
      </span>
      {suffix}
    </span>
  );
}

/** Headline figure with an icon chip, a change pill and a soft sparkline of the trend underneath. */
export function StatTile({ label, value, icon: Icon, tone = 'green', pct, invert, series, note }) {
  const t = TONES[tone] || TONES.green;
  const points = (series || []).map((v, i) => ({ i, v: Number(v) || 0 }));
  const showSpark = points.length > 1 && points.some((p) => p.v !== points[0].v);
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-tertiary-100 bg-gradient-to-br ${t.glow} to-white p-4 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-cardHover`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
          <div className="mt-1.5 truncate font-heading text-[1.7rem] font-bold leading-none tabular-nums tracking-tight text-tertiary-900">{value ?? '—'}</div>
        </div>
        {Icon && (
          <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.chip} shadow-sm transition-transform duration-300 group-hover:scale-110`}>
            <Icon className="h-5 w-5" strokeWidth={2.1} />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          {note ? <span className="text-xs text-tertiary-500">{note}</span> : <DeltaPill pct={pct} invert={invert} suffix={showSpark ? '' : undefined} />}
        </div>
        {showSpark && (
          <div className="h-10 w-24 shrink-0 opacity-90" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 6, right: 2, left: 2, bottom: 2 }}>
                <Line type="monotone" dataKey="v" stroke={t.line} strokeWidth={2.25} dot={false} isAnimationActive={false} />
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
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-tertiary-100 bg-white shadow-sm" style={{ boxShadow: `0 0 0 2px ${color}22` }}>
      {logo ? <img src={logo} alt="" className="h-full w-full object-contain p-1" /> : <Building2 className="h-4 w-4" style={{ color }} />}
    </span>
  );
}

/**
 * Every company, one card shape: logo, name, people and a status chip; revenue / profit / margin; a revenue + profit
 * line when the period has more than one point; and the company's share of group revenue with its valuation.
 */
export function CompanyCard({ company, color, groupRevenue, onOpen, series: seriesOverride }) {
  const { org } = company;
  if (company.coming_soon) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-tertiary-200 bg-white/60 p-4 text-tertiary-400">
        <Avatar org={org} color="#94a3b8" />
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold text-tertiary-500">{org.name}</p>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Coming soon</span>
        </div>
      </div>
    );
  }
  const t = company.totals;
  const loss = t.profit < 0;
  const share = groupRevenue > 0 && t.revenue > 0 ? Math.min(100, (t.revenue / groupRevenue) * 100) : 0;
  const status = !company.has_data ? ['No data', 'bg-tertiary-100 text-tertiary-500'] : loss ? ['Loss', 'bg-rose-100 text-rose-700'] : ['Profit', 'bg-emerald-100 text-emerald-700'];
  const series = (seriesOverride || company.series || []).map((r) => ({ label: r.label, revenue: Number(r.revenue) || 0, profit: Number(r.profit) || 0 }));
  const showLine = series.length > 1 && series.some((p) => p.revenue || p.profit);
  return (
    <button
      type="button"
      onClick={() => onOpen(org)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-tertiary-100 bg-white p-4 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-tertiary-200 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}44)` }} aria-hidden="true" />
      <div className="flex items-center gap-3">
        <Avatar org={org} color={color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-bold leading-tight text-tertiary-900">{org.name}</p>
          <p className="text-[11px] text-tertiary-500">{company.people.employees + company.people.contractors} people</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status[1]}`}>{status[0]}</span>
      </div>

      {company.has_data ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Revenue</div>
            <div className="text-[15px] font-bold tabular-nums text-tertiary-900">{compact(t.revenue)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Profit</div>
            <div className={`text-[15px] font-bold tabular-nums ${loss ? 'text-rose-600' : 'text-emerald-700'}`}>{compact(t.profit)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Margin</div>
            <div className="text-[15px] font-bold tabular-nums text-tertiary-900">{t.margin_pct === null || t.margin_pct === undefined ? 'N/A' : `${t.margin_pct}%`}</div>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-tertiary-50 px-2 py-1.5 text-[11px] text-tertiary-400">Nothing recorded in this period.</p>
      )}

      {showLine && (
        <div className="mt-2 h-12" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Line type="monotone" dataKey="revenue" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="profit" stroke="#1d4ed8" strokeWidth={1.75} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2" title="Share of group revenue">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-tertiary-100">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${share}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)` }} />
        </div>
        <span className="w-9 text-right text-[10px] font-medium tabular-nums text-tertiary-500">{share ? `${share.toFixed(share < 10 ? 1 : 0)}%` : '—'}</span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-tertiary-100 pt-2 text-[11px] text-tertiary-500">
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
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
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
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} width={44} axisLine={false} tickLine={false} />
                <RTooltip content={<ShareTooltip companies={companies} />} cursor={{ stroke: '#9fb3a7', strokeDasharray: '3 4' }} />
                {companies.map((c) => (
                  <Line key={c.org.id} dataKey={c.org.id} name={c.org.name} connectNulls {...lineProps(colorOfOrg(c.org.id), series.length, { width: 2.75, labels: true, format: (v) => `${v}%` })} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
          <ShortPeriodHint count={series.length} />
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {legend.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOfOrg(d.id) }} />
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

// ---- shared line-chart styling: soft dotted grid, rounded glowing lines, white-ringed dots --------------------------
export const GRID_PROPS = { strokeDasharray: '1 7', vertical: false, stroke: '#c5d1ca' };
export const AXIS_TICK = { fontSize: 11, fill: '#6b7c72' };

/** Props for a <Line>: smooth, thick, softly glowing, with white-ringed dots while the series is short. */
export function lineProps(color, count = 0, { dashed = false, width = 3, labels = false, format = compact } = {}) {
  const few = count > 0 && count <= 6;
  return {
    type: 'monotone',
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeDasharray: dashed ? '7 5' : undefined,
    dot: few ? { r: 3.5, fill: '#fff', stroke: color, strokeWidth: 2.25 } : false,
    activeDot: { r: 6.5, fill: color, stroke: '#fff', strokeWidth: 3 },
    style: { filter: `drop-shadow(0 4px 6px ${color}45)` },
    animationDuration: 700,
    label: labels && count > 0 && count <= 3 ? { position: 'top', fontSize: 11, fontWeight: 600, fill: color, formatter: format } : false,
  };
}

/** Soft tinted panel behind a chart so the lines sit on something instead of bare white. */
export function ChartFrame({ children, className = 'h-72' }) {
  return <div className={`${className} rounded-xl bg-gradient-to-b from-primary-50/60 via-white to-white p-2 ring-1 ring-primary-100/70`}>{children}</div>;
}

/** A one-line nudge when the period is too short to draw a trend. */
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

/** Multi-company trend: glowing smooth lines, dotted grid, ranked tooltip and legend pills that show each latest value. */
export function TrendLines({ rows, companies, colorOfOrg, metric }) {
  const latest = (id) => {
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i][id] != null && rows[i][id] !== '') return Number(rows[i][id]);
    return null;
  };
  return (
    <div>
      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 22, right: 22, left: 4, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} tickFormatter={compact} width={72} axisLine={false} tickLine={false} />
            <RTooltip content={<TrendTooltip companies={companies} />} cursor={{ stroke: '#9fb3a7', strokeDasharray: '3 4' }} />
            {companies.map((c) => (
              <Line key={`${metric}-${c.org.id}`} dataKey={c.org.id} name={c.org.name} connectNulls {...lineProps(colorOfOrg(c.org.id), rows.length, { labels: true })} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ShortPeriodHint count={rows.length} />
      <div className="mt-3 flex flex-wrap gap-2">
        {companies.map((c) => (
          <span key={c.org.id} className="inline-flex items-center gap-2 rounded-full border border-tertiary-100 bg-white py-1 pl-2 pr-3 text-xs text-tertiary-700 shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: colorOfOrg(c.org.id), boxShadow: `0 0 0 1px ${colorOfOrg(c.org.id)}66` }} />
            {c.org.name}
            {latest(c.org.id) != null && <b className="tabular-nums text-tertiary-900">{compact(latest(c.org.id))}</b>}
          </span>
        ))}
      </div>
    </div>
  );
}

const MEDAL = ['from-amber-300 to-amber-500 text-amber-950', 'from-slate-200 to-slate-400 text-slate-900', 'from-orange-300 to-orange-500 text-orange-950'];

/** Top-N list with medal-style ranks and a relative bar. */
export function RankCard({ title, rows, format }) {
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.value) || 0)), 1);
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card transition-shadow hover:shadow-cardHover">
      <h4 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">{title}</h4>
      <ol className="space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.org_id}>
            <div className="flex items-center gap-2 text-sm">
              <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold ${MEDAL[i] || 'from-tertiary-100 to-tertiary-200 text-tertiary-700'}`}>{r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-tertiary-800">{r.org_name}</span>
              <span className="font-semibold tabular-nums text-tertiary-900">{format(r.value)}</span>
            </div>
            <div className="ml-7 mt-1 h-1 overflow-hidden rounded-full bg-tertiary-100">
              <div className="h-full rounded-full bg-gradient-to-r from-[#3a8a5f] to-[#8bc4a0]" style={{ width: `${Math.max(4, Math.min(100, (Math.abs(Number(r.value) || 0) / max) * 100))}%` }} />
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
