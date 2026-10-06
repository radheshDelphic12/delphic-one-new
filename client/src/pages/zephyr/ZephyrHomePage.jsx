import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Settings2, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { zephyrApi } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { ZEPHYR_MY_WORK, ZEPHYR_SECTIONS } from '../../lib/zephyr/sections.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { compact, dateLabel } from '../../lib/format.js';
import ZephyrTrendChart from '../../components/zephyr/ZephyrTrendChart.jsx';

const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
const STAGE_ROWS = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['site_visit', 'Site visit'],
  ['proposal', 'Proposal'],
  ['negotiation', 'Negotiation'],
  ['won', 'Won'],
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// A failed block must never blank the whole home page, so each call settles on its own.
const settle = (promise) => promise.then((value) => value, () => null);

function Kpi({ label, value, hint, tone, to }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${tone || 'text-tertiary-900'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-tertiary-500">{hint}</div>}
    </>
  );
  const base = 'rounded-2xl border bg-white p-4 shadow-soft';
  return to ? (
    <Link to={to} className={`${base} transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card`}>{body}</Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className={card}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const PanelLink = ({ to, children }) => (
  <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
    {children} <ArrowRight className="h-3 w-3" />
  </Link>
);

function SectionCard({ section }) {
  const Icon = section.icon;
  return (
    <Link
      to={section.to}
      className="group flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 group-hover:bg-primary-100">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-tertiary-900">{section.label}</span>
        <span className="mt-0.5 block text-sm text-tertiary-500">{section.blurb}</span>
      </span>
    </Link>
  );
}

function Pipeline({ summary }) {
  const rows = STAGE_ROWS.map(([key, label]) => ({ key, label, ...(summary.by_stage?.[key] || { count: 0, value: 0 }) }));
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 text-tertiary-600">{r.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-tertiary-100">
            <div className={`h-full rounded-full ${r.key === 'won' ? 'bg-primary-600' : 'bg-primary-300'}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right font-medium tabular-nums text-tertiary-900">{r.count}</span>
          <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-tertiary-500 sm:block">{r.value ? `₹${compact(r.value)}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Attention({ items }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-3 text-sm text-primary-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" /> All clear. Nothing is overdue right now.
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.key}>
          <Link to={item.to} className="flex items-start gap-3 py-2.5 text-sm hover:bg-primary-50/50">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.urgent ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
              {item.urgent ? <AlertTriangle className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-tertiary-900">{item.title}</span>
              <span className="block truncate text-xs text-tertiary-500">{item.sub}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Dashboard({ me, user }) {
  const [data, setData] = useState(null);
  const admin = zxCan(me, 'overviewValuation');

  useEffect(() => {
    let live = true;
    Promise.all([
      zxCan(me, 'overview') ? settle(zephyrApi.overview({ preset: 'fy' })) : null,
      zxCan(me, 'leads') ? settle(zephyrApi.leadSummary()) : null,
      zxCan(me, 'leads') ? settle(zephyrApi.leadFollowUps()) : null,
      zxCan(me, 'projects') ? settle(zephyrApi.projectSummary()) : null,
    ]).then(([overview, leads, followUps, projects]) => live && setData({ overview, leads, followUps, projects }));
    return () => {
      live = false;
    };
  }, [me]);

  const o = data?.overview;
  const attention = [];
  for (const f of data?.followUps || []) {
    attention.push({ key: `f${f.id}`, urgent: f.overdue, to: `/zephyr/leads`, title: `${f.overdue ? 'Overdue follow-up' : 'Follow-up'}: ${f.lead.name}`, sub: `${f.summary} · ${dateLabel(f.follow_up_date)}` });
  }
  if (data?.projects?.milestones_overdue) {
    attention.push({ key: 'ms', urgent: true, to: '/zephyr/projects', title: `${data.projects.milestones_overdue} milestone${data.projects.milestones_overdue > 1 ? 's' : ''} past due`, sub: 'Open Projects to review the schedule' });
  }
  const topProjects = (o?.by_project || []).filter((p) => p.project_id).sort((a, b) => b.profit - a.profit).slice(0, 5);
  const profitUp = o ? o.summary.profit >= 0 : true;
  const sections = ZEPHYR_SECTIONS.filter((s) => zxCan(me, s.cap));

  return (
    <div className="mt-4 space-y-5">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-soft md:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary-200/30 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary-700">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <h2 className="mt-1 font-heading text-xl font-bold text-tertiary-900 md:text-2xl">
              {greeting()}, {user?.name?.split(' ')[0] || 'there'}
              <span className="ml-2 align-middle rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium capitalize text-primary-800">{me.role}</span>
            </h2>
            <p className="mt-1 text-sm text-tertiary-600">
              {data?.leads ? `${data.leads.open_count} open lead${data.leads.open_count === 1 ? '' : 's'}` : 'Your workspace'}
              {data?.projects ? ` · ${data.projects.live_count} live project${data.projects.live_count === 1 ? '' : 's'}` : ''}
              {data?.leads?.follow_ups_due ? ` · ${data.leads.follow_ups_due} follow-up${data.leads.follow_ups_due === 1 ? '' : 's'} due` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {zxCan(me, 'leads') && <Link to="/zephyr/leads" className="rounded-xl bg-primary-600 px-3.5 py-2 text-sm font-medium text-white shadow-soft hover:bg-primary-700">Open leads</Link>}
            {zxCan(me, 'projects') && <Link to="/zephyr/projects" className="rounded-xl border bg-white px-3.5 py-2 text-sm font-medium text-tertiary-800 hover:border-primary-300">Projects</Link>}
            {zxCan(me, 'overview') && <Link to="/zephyr/overview" className="rounded-xl border bg-white px-3.5 py-2 text-sm font-medium text-tertiary-800 hover:border-primary-300">Revenue &amp; profit</Link>}
            {zxCan(me, 'settings') && (
              <Link to="/zephyr/settings" className="inline-flex items-center gap-1.5 rounded-xl border bg-white px-3.5 py-2 text-sm font-medium text-tertiary-800 hover:border-primary-300">
                <Settings2 className="h-4 w-4" /> Setup
              </Link>
            )}
          </div>
        </div>
      </div>

      {!data && <div className="py-6 text-center text-sm text-tertiary-500">Loading your numbers…</div>}

      {o && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Kpi label="Revenue · FY to date" value={`₹${compact(o.summary.revenue)}`} hint={rupees(o.summary.revenue)} tone="text-primary-700" to="/zephyr/overview" />
          <Kpi label="Expense · FY to date" value={`₹${compact(o.summary.expense)}`} hint={rupees(o.summary.expense)} to="/zephyr/overview" />
          <Kpi
            label="Profit"
            value={<span className="inline-flex items-center gap-1.5">{profitUp ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}₹{compact(o.summary.profit)}</span>}
            hint={o.summary.margin === null ? undefined : `${o.summary.margin}% margin${admin ? '' : ' · before salaries'}`}
            tone={profitUp ? 'text-tertiary-900' : 'text-red-600'}
            to="/zephyr/overview"
          />
          {admin && <Kpi label="Salaries · FY" value={`₹${compact(o.summary.salaries)}`} hint="approved + paid" to="/zephyr/people" />}
          {admin && <Kpi label="Valuation" value={o.valuation?.value == null ? '—' : `₹${compact(o.valuation.value)}`} hint={o.valuation ? (o.valuation.method === 'manual' ? 'set manually' : `${o.valuation.multiple}x ${o.valuation.basis}`) : undefined} to="/zephyr/settings" />}
          {!admin && data?.projects && <Kpi label="Live projects" value={data.projects.live_count} hint={`₹${compact(data.projects.committed_cost)} committed to vendors`} to="/zephyr/projects" />}
        </div>
      )}

      {o && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Panel title="Last 12 months" action={<PanelLink to="/zephyr/overview">Full overview</PanelLink>}>
              <ZephyrTrendChart rows={o.trend} showSalaries={admin} height={270} />
            </Panel>
          </div>
          <Panel title="Needs attention" action={attention.length > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{attention.length}</span>}>
            <Attention items={attention.slice(0, 6)} />
          </Panel>
        </div>
      )}

      {(data?.leads || topProjects.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data?.leads && (
            <Panel title="Lead pipeline" action={<PanelLink to="/zephyr/leads">All leads</PanelLink>}>
              <Pipeline summary={data.leads} />
              <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-center">
                <div><div className="text-lg font-bold tabular-nums text-tertiary-900">₹{compact(data.leads.open_value)}</div><div className="text-[11px] uppercase tracking-wide text-tertiary-500">Open value</div></div>
                <div><div className="text-lg font-bold tabular-nums text-tertiary-900">₹{compact(data.leads.won_value)}</div><div className="text-[11px] uppercase tracking-wide text-tertiary-500">Won value</div></div>
                <div><div className="text-lg font-bold tabular-nums text-tertiary-900">{data.leads.win_rate === null ? '—' : `${data.leads.win_rate}%`}</div><div className="text-[11px] uppercase tracking-wide text-tertiary-500">Win rate</div></div>
              </div>
            </Panel>
          )}
          {topProjects.length > 0 && (
            <Panel title="Top projects by profit" action={<PanelLink to="/zephyr/projects">All projects</PanelLink>}>
              <ul className="divide-y">
                {topProjects.map((p) => (
                  <li key={p.project_id}>
                    <Link to={`/zephyr/projects/${p.project_id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-primary-50/50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-tertiary-900">{p.name}</span>
                        <span className="block text-xs tabular-nums text-tertiary-500">Revenue {rupees(p.revenue)} · Expense {rupees(p.expense)}</span>
                      </span>
                      <span className={`shrink-0 font-semibold tabular-nums ${p.profit < 0 ? 'text-red-600' : 'text-primary-700'}`}>{rupees(p.profit)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Workspaces</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => <SectionCard key={section.key} section={section} />)}
        </div>
      </div>
    </div>
  );
}

export default function ZephyrHomePage() {
  const { user } = useAuth();
  const { me, loading, error } = useZephyr();

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (error || !me) {
    return (
      <div className="mt-6 rounded-2xl border bg-white p-6 text-sm text-tertiary-600">
        {error?.response?.data?.message || 'Your account has no Zephyr access yet. Ask an administrator to link your login.'}
      </div>
    );
  }

  if (me.role === 'staff') {
    return (
      <div className="mt-4 space-y-5">
        <div className="rounded-2xl border bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-soft md:p-6">
          <h2 className="font-heading text-xl font-bold text-tertiary-900">
            {greeting()}, {user?.name?.split(' ')[0] || 'there'}
            <span className="ml-2 align-middle rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium capitalize text-primary-800">{me.role}</span>
          </h2>
          <p className="mt-1 text-sm text-tertiary-600">Your assigned projects and salary slips are in one place.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><SectionCard section={ZEPHYR_MY_WORK} /></div>
      </div>
    );
  }

  return <Dashboard me={me} user={user} />;
}
