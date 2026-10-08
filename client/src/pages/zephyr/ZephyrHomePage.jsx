import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ListChecks, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { zephyrApi } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { ZEPHYR_MY_WORK, ZEPHYR_SECTIONS } from '../../lib/zephyr/sections.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import { UNIT_STATUSES } from '../../lib/zephyr/propertyMeta.js';
import { SERVICE_META, useServiceTypes } from '../../lib/zephyr/serviceMeta.js';
import { compact, dateLabel } from '../../lib/format.js';
import ZephyrTrendChart from '../../components/zephyr/ZephyrTrendChart.jsx';

const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
const STAGE_ROWS = [
  ['new', 'New'],
  ['in_discussion', 'In discussion'],
  ['negotiation', 'Negotiation'],
  ['on_hold', 'On hold'],
  ['won', 'Won'],
  ['dropped', 'Dropped'],
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Kpi({ label, value, hint, tone, to }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${tone || 'text-tertiary-900'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-tertiary-500">{hint}</div>}
    </>
  );
  const base = 'rounded-2xl border bg-white p-4 shadow-soft';
  return to ? <Link to={to} className={`${base} transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card`}>{body}</Link> : <div className={base}>{body}</div>;
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
  <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">{children} <ArrowRight className="h-3 w-3" /></Link>
);

function SectionCard({ section }) {
  const Icon = section.icon;
  return (
    <Link to={section.to} className="group flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 group-hover:bg-primary-100"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-tertiary-900">{section.label}</span>
        <span className="mt-0.5 block text-sm text-tertiary-500">{section.blurb}</span>
      </span>
    </Link>
  );
}

function Bar({ value, max, tone = 'bg-primary-300' }) {
  return <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>;
}

function Pipeline({ summary }) {
  const rows = STAGE_ROWS.map(([key, label]) => ({ key, label, ...(summary.by_stage?.[key] || { count: 0, value: 0 }) }));
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 text-tertiary-600">{r.label}</span>
          <Bar value={r.count} max={max} tone={r.key === 'won' ? 'bg-primary-600' : r.key === 'dropped' ? 'bg-red-300' : 'bg-primary-300'} />
          <span className="w-8 shrink-0 text-right font-medium tabular-nums text-tertiary-900">{r.count}</span>
          <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-tertiary-500 sm:block">{r.value ? `₹${compact(r.value)}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Attention({ items }) {
  if (items.length === 0) {
    return <div className="flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-3 text-sm text-primary-800"><CheckCircle2 className="h-4 w-4 shrink-0" /> All clear. Nothing is overdue right now.</div>;
  }
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.key}>
          <Link to={item.to} className="flex items-start gap-3 py-2.5 text-sm hover:bg-primary-50/50">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.urgent ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>{item.urgent ? <AlertTriangle className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-tertiary-900">{item.title}</span><span className="block truncate text-xs text-tertiary-500">{item.sub}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Dashboard({ me, user }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const { services, label: serviceLabel } = useServiceTypes();
  const admin = zxCan(me, 'overviewValuation');
  const finance = zxCan(me, 'propertyFinance');

  useEffect(() => {
    let live = true;
    zephyrApi.dashboard().then((data) => live && setD(data), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [me]);

  const f = d?.finance;
  const attention = [];
  for (const x of d?.follow_ups || []) attention.push({ key: `f${x.id}`, urgent: x.overdue, to: '/zephyr/leads', title: `${x.overdue ? 'Overdue follow-up' : 'Follow-up'}: ${x.lead.name}`, sub: `${x.summary} · ${dateLabel(x.follow_up_date)}` });
  if (d?.projects?.milestones_overdue) attention.push({ key: 'ms', urgent: true, to: '/zephyr/projects', title: `${d.projects.milestones_overdue} milestone${d.projects.milestones_overdue > 1 ? 's' : ''} past due`, sub: 'Open Projects to review the schedule' });
  for (const r of d?.rent?.overdue_items || []) attention.push({ key: `r${r.id}`, urgent: true, to: '/zephyr/rent', title: `Rent overdue: ${r.tenant.name}`, sub: `${r.property.name} / ${r.unit.name} · ${rupees(r.balance)} · ${r.days_overdue} days late` });
  if (d?.tasks?.overdue) attention.push({ key: 'tk', urgent: true, to: '/zephyr/tasks', title: `${d.tasks.overdue} task${d.tasks.overdue > 1 ? 's' : ''} overdue`, sub: 'Open Tasks to follow up' });
  const profitUp = f ? f.fy.profit >= 0 : true;
  const quick = [
    d?.leads && { label: 'Open leads', value: d.leads.open_count, to: '/zephyr/leads' },
    d?.projects && { label: 'Live projects', value: d.projects.live_count, to: '/zephyr/projects' },
    d?.properties && { label: 'Properties', value: d.properties.properties, to: '/zephyr/properties' },
    d?.rent && { label: 'Rent overdue', value: d.rent.overdue_count || 0, to: '/zephyr/rent', warn: Boolean(d.rent.overdue_count) },
    d?.tasks && { label: 'Tasks pending', value: d.tasks.pending || 0, to: '/zephyr/tasks' },
  ].filter(Boolean);
  const unitStatus = d?.properties?.units_by_status;
  const unitMax = Math.max(1, ...Object.values(unitStatus || {}));
  const revenueByService = (f?.by_service || []).filter((s) => s.key);

  const profitByService = Object.fromEntries(revenueByService.map((s) => [s.key, s]));

  return (
    <div className="mt-4 space-y-6">
      <div className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold text-tertiary-900">{greeting()}, {user?.name?.split(' ')[0] || 'there'}</h2>
          <p className="mt-0.5 text-sm text-tertiary-500">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quick.map((x) => (
              <Link key={x.label} to={x.to} className={`min-w-[6.5rem] rounded-xl border px-3 py-2 transition hover:border-primary-300 ${x.warn ? 'border-red-200 bg-red-50' : 'bg-white'}`}>
                <div className={`text-xl font-bold tabular-nums leading-6 ${x.warn ? 'text-red-600' : 'text-tertiary-900'}`}>{x.value}</div>
                <div className="text-xs text-tertiary-500">{x.label}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {!d && !failed && <div className="py-6 text-center text-sm text-tertiary-500">Loading your numbers…</div>}
      {failed && <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-500">The dashboard could not be loaded. Use the menu on the left to open any section.</div>}

      {d && (
        <Panel title="Needs your attention" action={attention.length > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{attention.length}</span>}>
          <Attention items={attention.slice(0, 5)} />
        </Panel>
      )}

      {f && (
        <section>
          <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Money this financial year</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Money earned" value={`₹${compact(f.fy.revenue)}`} hint="all revenue so far" tone="text-primary-700" to="/zephyr/overview" />
            <Kpi label="Money spent" value={`₹${compact(f.fy.expense)}`} hint="all expenses so far" to="/zephyr/overview" />
            <Kpi label="Profit" value={<span className="inline-flex items-center gap-1.5">{profitUp ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}₹{compact(f.fy.profit)}</span>} hint={f.fy.margin === null ? undefined : `${f.fy.margin}% of what you earned${admin ? '' : ' (before salaries)'}`} tone={profitUp ? 'text-tertiary-900' : 'text-red-600'} to="/zephyr/overview" />
            <Kpi label="This month's profit" value={`₹${compact(f.month.profit)}`} hint={`earned ₹${compact(f.month.revenue)} · spent ₹${compact(f.month.expense)}`} tone={f.month.profit < 0 ? 'text-red-600' : 'text-tertiary-900'} to="/zephyr/overview" />
          </div>
          {((finance && f.unrealized?.appreciation != null) || (admin && f.valuation?.value != null)) && (
            <p className="mt-3 text-xs text-tertiary-500">
              {finance && f.unrealized?.appreciation != null && <>Property value has grown by ₹{compact(f.unrealized.appreciation)} on paper (not counted in profit until sold). </>}
              {admin && f.valuation?.value != null && <>Company valuation: ₹{compact(f.valuation.value)}.</>}
            </p>
          )}
        </section>
      )}

      {f && (
        <Panel title="Money in and out · last 12 months" action={<PanelLink to="/zephyr/overview">See details</PanelLink>}>
          <ZephyrTrendChart rows={f.trend} showSalaries={admin} height={250} />
        </Panel>
      )}

      {(d?.leads || d?.rent) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.leads && (
            <Panel title="Leads" action={<PanelLink to="/zephyr/leads">Open leads</PanelLink>}>
              <Pipeline summary={d.leads} />
              <p className="mt-4 border-t pt-3 text-sm text-tertiary-600">
                ₹{compact(d.leads.open_value)} still in progress · ₹{compact(d.leads.won_value)} won{d.leads.win_rate === null ? '' : ` · ${d.leads.win_rate}% of decided leads were won`}
              </p>
            </Panel>
          )}
          {d.rent && (
            <Panel title="Rent this month" action={<PanelLink to="/zephyr/rent">Open rent</PanelLink>}>
              <div className="text-sm text-tertiary-600">₹{compact(d.rent.collected)} collected of ₹{compact(d.rent.total_due)} due</div>
              <div className="mt-2"><Bar value={d.rent.collected} max={d.rent.total_due} tone="bg-primary-600" /></div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-xs text-tertiary-500">Still to collect</dt><dd className="text-lg font-semibold tabular-nums text-tertiary-900">₹{compact(d.rent.pending)}</dd></div>
                <div><dt className="text-xs text-tertiary-500">Overdue</dt><dd className={`text-lg font-semibold tabular-nums ${d.rent.overdue ? 'text-red-600' : 'text-tertiary-900'}`}>₹{compact(d.rent.overdue)}</dd></div>
                <div><dt className="text-xs text-tertiary-500">Rents due</dt><dd className="text-lg font-semibold tabular-nums text-tertiary-900">{d.rent.count}</dd></div>
              </dl>
              {d.tasks && <div className="mt-4 flex items-center gap-2 border-t pt-3 text-sm text-tertiary-600"><ListChecks className="h-4 w-4 text-primary-600" />{d.tasks.pending + d.tasks.in_progress} open tasks · {d.tasks.completed_this_month} done this month</div>}
            </Panel>
          )}
        </div>
      )}

      {d?.properties && (
        <Panel title="Properties" action={<PanelLink to="/zephyr/properties">Open properties</PanelLink>}>
          <p className="text-sm text-tertiary-600">{d.properties.properties} properties · {d.properties.units} units · {d.properties.occupied} rented</p>
          <div className="mt-3 space-y-2">
            {UNIT_STATUSES.map((s) => (unitStatus?.[s.value] ? <div key={s.value} className="flex items-center gap-3 text-sm"><span className="w-36 shrink-0 text-tertiary-600">{s.label}</span><Bar value={unitStatus[s.value]} max={unitMax} /><span className="w-8 shrink-0 text-right font-medium tabular-nums">{unitStatus[s.value]}</span></div> : null))}
            {d.properties.units === 0 && <div className="text-sm text-tertiary-400">No units yet.</div>}
          </div>
          {finance && d.properties.total_invested !== undefined && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm sm:grid-cols-4">
              {[['Invested', `₹${compact(d.properties.total_invested)}`], ['Current value', d.properties.valued_properties ? `₹${compact(d.properties.valuation)}` : '—'], ['Loans', `₹${compact(d.properties.outstanding_loans)}`], ['Monthly EMI', `₹${compact(d.properties.monthly_emi)}`]].map(([label, value]) => <div key={label}><dt className="text-xs text-tertiary-500">{label}</dt><dd className="font-semibold tabular-nums text-tertiary-900">{value}</dd></div>)}
            </dl>
          )}
        </Panel>
      )}

      {d?.leads && (
        <Panel title="By service" action={<PanelLink to="/zephyr/projects">Open projects</PanelLink>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-tertiary-500">
                  <th className="pb-2 font-medium">Service</th>
                  <th className="pb-2 text-right font-medium">Open leads</th>
                  <th className="pb-2 text-right font-medium">Live projects</th>
                  {f && <th className="pb-2 text-right font-medium">Profit this year</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {services.map((s) => {
                  const Icon = SERVICE_META[s.key].icon;
                  const profit = profitByService[s.key]?.profit;
                  return (
                    <tr key={s.key}>
                      <td className="py-2.5"><span className="inline-flex items-center gap-2 font-medium text-tertiary-900"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><Icon className="h-3.5 w-3.5" /></span>{serviceLabel(s.key)}</span></td>
                      <td className="py-2.5 text-right tabular-nums">{d.leads.by_service?.[s.key]?.open ?? 0}</td>
                      <td className="py-2.5 text-right tabular-nums">{d.projects?.by_service?.[s.key]?.live ?? 0}</td>
                      {f && <td className={`py-2.5 text-right tabular-nums ${profit < 0 ? 'text-red-600' : ''}`}>{profit === undefined ? '—' : `₹${compact(profit)}`}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

export default function ZephyrHomePage() {
  const { user } = useAuth();
  const { me, loading, error } = useZephyr();

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (error || !me) {
    return <div className="mt-6 rounded-2xl border bg-white p-6 text-sm text-tertiary-600">{error?.response?.data?.message || 'Your account has no Zephyr access yet. Ask an administrator to link your login.'}</div>;
  }

  if (me.role === 'staff') {
    const mine = [ZEPHYR_MY_WORK, ...ZEPHYR_SECTIONS.filter((s) => zxCan(me, s.cap))];
    return (
      <div className="mt-4 space-y-5">
        <div className="rounded-2xl border bg-white p-5 shadow-soft md:p-6">
          <h2 className="font-heading text-xl font-bold text-tertiary-900">
            {greeting()}, {user?.name?.split(' ')[0] || 'there'}
            <span className="ml-2 align-middle rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium capitalize text-primary-800">{me.role}</span>
          </h2>
          <p className="mt-1 text-sm text-tertiary-600">Your assigned projects, salary slips and tasks are in one place.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{mine.map((s) => <SectionCard key={s.key} section={s} />)}</div>
      </div>
    );
  }

  return <Dashboard me={me} user={user} />;
}
