import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { SERVICE_TYPES, pctLabel } from '../../lib/acconcy/meta.js';
import { Empty, Kpi, Money, Select, card, inputCls, labelCls } from '../../components/acconcy/ui.jsx';
import { shortMonth } from '../../lib/format.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Block({ title, children, cols = 'grid-cols-2 lg:grid-cols-4' }) {
  return (
    <section className="space-y-2">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-wider text-tertiary-500">{title}</h2>
      <div className={`grid gap-3 ${cols}`}>{children}</div>
    </section>
  );
}

export default function AcconcyHomePage() {
  const { user } = useAuth();
  const { me, loading } = useAcconcy();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const [f, setF] = useState({ service_type: '', month: '' });
  const [d, setD] = useState(null);

  useEffect(() => {
    if (me && axCan(me, 'dashboard')) {
      setD(null);
      acconcyApi.dashboard(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).then(setD, (e) => pushError(acconcyError(e, 'Could not load the dashboard'), 'Load failed'));
    }
  }, [me, f, pushError]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'dashboard')) return <Navigate to="/acconcy/my-work" replace />;

  const svc = f.service_type ? `&service_type=${f.service_type}` : '';
  const go = (path) => () => navigate(path);
  const p = d?.pipeline;
  const fin = d?.financial;
  const perf = d?.performance;
  const inv = fin?.investments;
  const val = fin?.valuation;

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-tertiary-900">{greeting()}, {user?.name?.split(' ')[0] || 'there'}</h1>
          <p className="text-sm text-tertiary-500">Acconcy Finance overview. Every number opens the records behind it.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Service" value={f.service_type} onChange={(v) => setF((c) => ({ ...c, service_type: v }))} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} blank="All services" />
          <label className={labelCls}>Financial month<input type="month" className={inputCls} value={f.month} onChange={(e) => setF((c) => ({ ...c, month: e.target.value }))} /></label>
          {(f.service_type || f.month) && <button type="button" className="pb-2 text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={() => setF({ service_type: '', month: '' })}>Clear</button>}
        </div>
      </div>

      {!d ? <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div> : (
        <>
          <Block title="Lead pipeline" cols="grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Total leads" value={p.total} onClick={go(`/acconcy/leads?stage=all${svc}`)} />
            <Kpi label="New" value={p.new} onClick={go(`/acconcy/leads?stage=new${svc}`)} />
            <Kpi label="Discussion" value={p.in_discussion} onClick={go(`/acconcy/leads?stage=in_discussion${svc}`)} />
            <Kpi label="Qualification" value={p.qualification} onClick={go(`/acconcy/leads?stage=qualification${svc}`)} />
            <Kpi label="Proposal" value={p.proposal} onClick={go(`/acconcy/leads?stage=proposal${svc}`)} />
            <Kpi label="Negotiation" value={p.negotiation} onClick={go(`/acconcy/leads?stage=negotiation${svc}`)} />
            <Kpi label="Won" value={p.won} tone="text-green-700" hint={p.win_rate === null ? undefined : `Win rate ${p.win_rate}%`} onClick={go(`/acconcy/leads?stage=won${svc}`)} />
            <Kpi label="Dropped" value={p.dropped} onClick={go(`/acconcy/leads?stage=dropped${svc}`)} />
          </Block>

          <section className={`${card} overflow-x-auto`}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Leads by service and stage</h3>
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-xs text-tertiary-500"><tr><th className="py-1 pr-3 text-left font-medium">Service</th>{['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'won'].map((s) => <th key={s} className="px-2 py-1 text-right font-medium capitalize">{s.replace('_', ' ')}</th>)}<th className="px-2 py-1 text-right font-medium">Total</th></tr></thead>
              <tbody>
                {Object.entries(p.by_service_type).map(([key, m]) => (
                  <tr key={key} className="border-t">
                    <td className="py-1.5 pr-3 font-medium text-tertiary-900">{m.label}</td>
                    {['new', 'in_discussion', 'qualification', 'proposal', 'negotiation', 'won'].map((s) => (
                      <td key={s} className="px-2 py-1.5 text-right tabular-nums">{m.by_stage[s] ? <button type="button" className="font-medium text-primary-700 hover:underline" onClick={go(`/acconcy/leads?stage=${s}&service_type=${key}`)}>{m.by_stage[s]}</button> : <span className="text-tertiary-300">0</span>}</td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{m.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <Block title="Deal overview">
            <Kpi label="Active deals" value={d.deals.active} onClick={go(`/acconcy/deals?status=open${svc}`)} />
            <Kpi label="Completed deals" value={d.deals.completed} onClick={go(`/acconcy/deals?status=completed${svc}`)} />
            <Kpi label="Total deal value" value={<Money v={d.deals.total_value} />} onClick={go(`/acconcy/deals?status=all${svc}`)} />
            <Kpi label="Delayed deals" value={d.deals.delayed} tone={d.deals.delayed ? 'text-red-600' : undefined} onClick={go(`/acconcy/deals?flag=delayed&status=all${svc}`)} />
          </Block>
          <Block title="Deals by service" cols="grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {d.deals.by_service.map((s) => <Kpi key={s.key} label={s.label} value={s.count} hint={<Money v={s.value} />} onClick={go(`/acconcy/deals?status=all&service_type=${s.key}`)} />)}
          </Block>

          {fin && (
            <Block title={`Financial overview${f.month ? ` · ${shortMonth(f.month)}` : ' · all time'}`} cols="grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Kpi label="Revenue" value={<Money v={fin.revenue} />} onClick={go('/acconcy/finance?tab=pnl')} />
              <Kpi label="Expenses" value={<Money v={fin.deal_expenses + fin.operational_expenses} />} onClick={go('/acconcy/finance?tab=entries')} />
              <Kpi label="Salaries" value={<Money v={fin.salaries + fin.contractor_costs} />} onClick={go('/acconcy/salaries')} />
              <Kpi label="Profit" value={<Money v={fin.net_profit} signed />} tone="ax-gold" onClick={go('/acconcy/finance?tab=pnl')} />
              <Kpi label="Profit margin" value={pctLabel(fin.margin_pct)} />
            </Block>
          )}

          {inv && (
            <Block title="Investment overview" cols="grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              <Kpi label="Total investment" value={<Money v={inv.invested} />} onClick={go('/acconcy/investments')} />
              <Kpi label="Current value" value={<Money v={inv.current_value} />} onClick={go('/acconcy/investments')} />
              <Kpi label="Realised gain" value={<Money v={inv.realised_gain} signed />} hint="in revenue" onClick={go('/acconcy/investments')} />
              <Kpi label="Unrealised gain" value={<Money v={inv.unrealised_gain} signed />} hint="not revenue" onClick={go('/acconcy/investments')} />
              <Kpi label="Gain / loss %" value={pctLabel(inv.gain_loss_pct)} />
            </Block>
          )}

          {val && (
            <Block title="Company valuation" cols="grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              <Kpi label="Current valuation" value={<Money v={val.total} signed />} hint={`(profit x ${val.profit_multiplier}) + (assets x ${val.asset_multiplier})`} tone="ax-gold" onClick={go('/acconcy/financials?tab=valuation')} />
              <Kpi label="Profit component" value={<Money v={val.profit_component} signed />} onClick={go('/acconcy/financials?tab=valuation')} />
              <Kpi label="Asset component" value={<Money v={val.asset_component} />} onClick={go('/acconcy/financials?tab=valuation')} />
              <Kpi label="Previous valuation" value={val.previous_total === null ? '-' : <Money v={val.previous_total} signed />} onClick={go('/acconcy/financials?tab=valuation')} />
              <Kpi label="Change" value={val.change === null ? '-' : <Money v={val.change} signed />} onClick={go('/acconcy/financials?tab=valuation')} />
            </Block>
          )}

          {perf && (
            <section className={`${card} overflow-x-auto`}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Performance by service</h3>
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-xs text-tertiary-500"><tr><th className="py-1 pr-3 text-left font-medium">Service</th><th className="px-2 py-1 text-right font-medium">Deals</th><th className="px-2 py-1 text-right font-medium">Revenue</th><th className="px-2 py-1 text-right font-medium">Expenses</th><th className="px-2 py-1 text-right font-medium">Profit</th><th className="px-2 py-1 text-right font-medium">Invested</th><th className="px-2 py-1 text-right font-medium">Gain / loss</th></tr></thead>
                <tbody>
                  {perf.by_service.map((s) => (
                    <tr key={s.key} className="border-t"><td className="py-1.5 pr-3 font-medium text-tertiary-900">{s.label}</td><td className="px-2 py-1.5 text-right tabular-nums">{s.deals}</td><td className="px-2 py-1.5 text-right"><Money v={s.revenue} /></td><td className="px-2 py-1.5 text-right"><Money v={s.expenses} /></td><td className="px-2 py-1.5 text-right"><Money v={s.profit} signed className="font-semibold" /></td><td className="px-2 py-1.5 text-right">{s.investment_count ? <Money v={s.investment.invested} /> : '-'}</td><td className="px-2 py-1.5 text-right">{s.investment_count ? <Money v={s.investment.gain_loss} signed /> : '-'}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {perf.highest_revenue_deal ? <button type="button" className="rounded-xl border p-2 text-left hover:border-primary-300" onClick={go(`/acconcy/deals/${perf.highest_revenue_deal.id}`)}><span className="text-xs text-tertiary-500">Highest revenue deal</span><br />{perf.highest_revenue_deal.code} {perf.highest_revenue_deal.name} · <Money v={perf.highest_revenue_deal.value} /></button> : <Empty>No revenue yet.</Empty>}
                {perf.highest_profit_deal ? <button type="button" className="rounded-xl border p-2 text-left hover:border-primary-300" onClick={go(`/acconcy/deals/${perf.highest_profit_deal.id}`)}><span className="text-xs text-tertiary-500">Highest profit deal</span><br />{perf.highest_profit_deal.code} {perf.highest_profit_deal.name} · <Money v={perf.highest_profit_deal.value} /></button> : <Empty>No profitable deal yet.</Empty>}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
