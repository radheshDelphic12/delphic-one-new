import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, CartesianGrid, Line, LineChart } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Building2, Minus } from 'lucide-react';
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
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return <span className="text-xs text-tertiary-400">{suffix ? `No previous period` : ''}</span>;
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
  const gid = `spark-${label.replace(/\W+/g, '')}`;
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
        <div className="min-w-0">{note ? <span className="text-xs text-tertiary-500">{note}</span> : <DeltaPill pct={pct} invert={invert} />}</div>
        {showSpark && (
          <div className="h-10 w-24 shrink-0 opacity-90" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={t.line} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={t.line} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={t.line} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
              </AreaChart>
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
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-sm" style={{ boxShadow: `0 0 0 2px ${color}22` }}>
      {logo ? <img src={logo} alt="" className="h-full w-full object-contain p-1" /> : <Building2 className="h-5 w-5" style={{ color }} />}
    </span>
  );
}

/** One company as a card: logo, status, revenue / profit / margin, its share of group revenue and valuation. */
export function CompanyCard({ company, color, groupRevenue, rangeLabel, onOpen }) {
  const { org } = company;
  if (company.coming_soon) {
    return (
      <div className="rounded-2xl border border-dashed border-tertiary-200 bg-white/60 p-4 text-tertiary-400">
        <div className="flex items-center gap-3">
          <Avatar org={org} color="#94a3b8" />
          <div>
            <p className="font-heading text-sm font-semibold text-tertiary-500">{org.name}</p>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Coming soon</span>
          </div>
        </div>
        <p className="mt-3 text-xs">Not live yet; left out of the totals.</p>
      </div>
    );
  }
  const loss = company.totals.profit < 0;
  const share = groupRevenue > 0 && company.totals.revenue > 0 ? Math.min(100, (company.totals.revenue / groupRevenue) * 100) : 0;
  const status = !company.has_data ? ['No data', 'bg-tertiary-100 text-tertiary-500'] : loss ? ['Loss', 'bg-rose-100 text-rose-700'] : ['Profitable', 'bg-emerald-100 text-emerald-700'];
  return (
    <button
      type="button"
      onClick={() => onOpen(org)}
      className="group relative overflow-hidden rounded-2xl border border-tertiary-100 bg-white p-4 text-left shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-cardHover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }} aria-hidden="true" />
      <div className="flex items-center gap-3">
        <Avatar org={org} color={color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-semibold text-tertiary-900">{org.name}</p>
          <p className="text-xs text-tertiary-500">{company.people.employees + company.people.contractors} people</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status[1]}`}>{status[0]}</span>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-400">Revenue</div>
          <div className="font-heading text-xl font-bold tabular-nums text-tertiary-900">{company.has_data ? compact(company.totals.revenue) : '—'}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-400">Profit</div>
          <div className={`font-heading text-xl font-bold tabular-nums ${loss ? 'text-rose-600' : 'text-emerald-700'}`}>{company.has_data ? compact(company.totals.profit) : '—'}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] font-medium text-tertiary-500">
          <span>Share of group revenue</span>
          <span className="tabular-nums">{share ? `${share.toFixed(share < 10 ? 1 : 0)}%` : '—'}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-tertiary-100">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${share}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)` }} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-tertiary-100 pt-3 text-xs">
        <div>
          <div className="text-tertiary-400">Expenses</div>
          <div className="font-semibold text-tertiary-800">{company.has_data ? compact(company.totals.expenses) : '—'}</div>
        </div>
        <div>
          <div className="text-tertiary-400">Margin</div>
          <div className="font-semibold text-tertiary-800">{company.totals.margin_pct === null || company.totals.margin_pct === undefined ? 'N/A' : `${company.totals.margin_pct}%`}</div>
        </div>
        <div className="text-right">
          <div className="text-tertiary-400">Valuation</div>
          <div className="font-semibold text-tertiary-800">{company.valuation ? compact(company.valuation.current) : 'N/A'}</div>
        </div>
      </div>
      {rangeLabel && !company.has_data && <p className="mt-2 text-[11px] text-tertiary-400">Nothing recorded in {rangeLabel}.</p>}
    </button>
  );
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-tertiary-100 bg-white px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-tertiary-900">{p.name}</div>
      <div className="text-tertiary-600">{p.share}% · {money(p.value)}</div>
    </div>
  );
}

/** Donut of each company's share of a group total, with a ranked legend beside it. */
export function ContributionDonut({ title, subtitle, rows, colorOfOrg }) {
  const data = rows.map((r) => ({ id: r.org_id, name: r.org_name, share: r.share_pct ?? 0, value: r.value })).filter((r) => r.share > 0);
  const lead = [...data].sort((a, b) => b.share - a.share)[0];
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
      <p className="text-xs text-tertiary-500">{subtitle}</p>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-tertiary-500">Nothing to compare in this period.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <div className="relative h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="share" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {data.map((d) => <Cell key={d.id} fill={colorOfOrg(d.id)} />)}
                </Pie>
                <RTooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {lead && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-heading text-xl font-bold tabular-nums text-tertiary-900">{lead.share}%</span>
                <span className="max-w-[5.5rem] truncate text-[10px] font-medium text-tertiary-500">{lead.name}</span>
              </div>
            )}
          </div>
          <ul className="min-w-[10rem] flex-1 space-y-1.5 text-sm">
            {[...data].sort((a, b) => b.share - a.share).map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOfOrg(d.id) }} />
                <span className="min-w-0 flex-1 truncate text-tertiary-700">{d.name}</span>
                <span className="font-semibold tabular-nums text-tertiary-900">{d.share}%</span>
                <span className="hidden w-20 text-right text-xs tabular-nums text-tertiary-500 sm:inline">{compact(d.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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

/** Multi-company trend: smooth lines, soft grid, a ranked tooltip and a pill legend. */
export function TrendLines({ rows, companies, colorOfOrg, metric }) {
  return (
    <div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 10, right: 14, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={compact} width={72} axisLine={false} tickLine={false} />
            <RTooltip content={<TrendTooltip companies={companies} />} cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }} />
            {companies.map((c) => (
              <Line key={`${metric}-${c.org.id}`} type="monotone" dataKey={c.org.id} name={c.org.name} stroke={colorOfOrg(c.org.id)} strokeWidth={2.5} dot={rows.length < 25 ? { r: 3, strokeWidth: 0, fill: colorOfOrg(c.org.id) } : false} activeDot={{ r: 5 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {companies.map((c) => (
          <span key={c.org.id} className="inline-flex items-center gap-1.5 rounded-full border border-tertiary-100 bg-white px-2.5 py-1 text-xs text-tertiary-700">
            <span className="h-2 w-2 rounded-full" style={{ background: colorOfOrg(c.org.id) }} />
            {c.org.name}
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
