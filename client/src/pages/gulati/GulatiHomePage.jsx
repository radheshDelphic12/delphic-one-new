import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { gulatiApi, gulatiError } from '../../lib/gulati/api.js';
import { useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { pctLabel, qtyLabel } from '../../lib/gulati/meta.js';
import { Empty, Kpi, Money, card } from '../../components/gulati/ui.jsx';

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

export default function GulatiHomePage() {
  const { user } = useAuth();
  const { me, loading } = useGulati();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const [d, setD] = useState(null);

  useEffect(() => {
    if (me && gxCan(me, 'dashboard')) gulatiApi.dashboard().then(setD, (e) => pushError(gulatiError(e, 'Could not load the dashboard'), 'Load failed'));
  }, [me, pushError]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!gxCan(me, 'dashboard')) return <Navigate to="/gulati/my-work" replace />;
  if (!d) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;

  const go = (path) => () => navigate(path);
  const p = d.pipeline;
  const a = d.active_trading;
  const fin = d.financial;
  const perf = d.performance;

  return (
    <div className="mt-4 space-y-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">{greeting()}, {user?.name?.split(' ')[0] || 'there'}</h1>
        <p className="text-sm text-tertiary-500">Gulati Industries trading overview. Every number opens the records behind it.</p>
      </div>

      <Block title="Lead pipeline" cols="grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Total leads" value={p.total} onClick={go('/gulati/leads?stage=all')} />
        <Kpi label="New" value={p.new} onClick={go('/gulati/leads?stage=new')} />
        <Kpi label="Discussion" value={p.in_discussion} onClick={go('/gulati/leads?stage=in_discussion')} />
        <Kpi label="Negotiation" value={p.negotiation} onClick={go('/gulati/leads?stage=negotiation')} />
        <Kpi label="Sourcing" value={p.sourcing} onClick={go('/gulati/leads?stage=sourcing')} />
        <Kpi label="Won" value={p.won} tone="text-green-700" onClick={go('/gulati/leads?stage=won')} />
        <Kpi label="Dropped" value={p.dropped} onClick={go('/gulati/leads?stage=dropped')} />
      </Block>

      <Block title="Active trading">
        <Kpi label="Active deals" value={a.active_deals} onClick={go('/gulati/deals?status=active')} />
        {a.by_trading_type.map((t) => <Kpi key={t.key} label={t.label} value={t.count} hint="active deals" onClick={go(`/gulati/deals?status=active&trading_type=${t.key}`)} />)}
        <Kpi label="Pending sourcing" value={a.pending_sourcing} onClick={go('/gulati/deals?flag=pending_sourcing')} />
        <Kpi label="Pending supply" value={a.pending_supply} onClick={go('/gulati/deals?flag=pending_supply')} />
        <Kpi label="Delayed deals" value={a.delayed} tone={a.delayed ? 'text-red-600' : undefined} onClick={go('/gulati/deals?flag=delayed')} />
      </Block>

      {fin && (
        <Block title="Financial" cols="grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total revenue" value={<Money v={fin.sales_revenue} />} onClick={go('/gulati/finance?tab=pnl')} />
          <Kpi label="Total purchase" value={<Money v={fin.purchase_cost} />} onClick={go('/gulati/finance?tab=pnl')} />
          <Kpi label="Gross profit" value={<Money v={fin.gross_profit} signed />} hint={`Margin ${pctLabel(fin.gross_margin_pct)}`} onClick={go('/gulati/finance?tab=pnl')} />
          <Kpi label="Net profit" value={<Money v={fin.net_profit} signed />} hint={`Margin ${pctLabel(fin.net_margin_pct)}`} tone="gx-copper" onClick={go('/gulati/finance?tab=pnl')} />
          <Kpi label="Expenses" value={<Money v={fin.deal_expenses + fin.company_expenses} />} onClick={go('/gulati/finance?tab=expenses')} />
          <Kpi label="Receivables" value={<Money v={fin.receivables} />} hint="from clients" onClick={go('/gulati/deals?status=all&flag=client_due')} />
          <Kpi label="Payables" value={<Money v={fin.payables} />} hint="to vendors" onClick={go('/gulati/deals?status=all&flag=vendor_due')} />
          {fin.valuation && <Kpi label="Valuation" value={fin.valuation.value === null ? '-' : <Money v={fin.valuation.value} />} hint="from last 12 months" onClick={go('/gulati/finance')} />}
        </Block>
      )}

      {perf && (
        <section className="space-y-2">
          <h2 className="font-heading text-xs font-semibold uppercase tracking-wider text-tertiary-500">Deal performance</h2>
          <div className="grid gap-3 lg:grid-cols-4">
            <Kpi label="Highest value deal" value={perf.highest_value_deal ? <Money v={perf.highest_value_deal.value} /> : '-'} hint={perf.highest_value_deal?.name} onClick={perf.highest_value_deal ? go(`/gulati/deals/${perf.highest_value_deal.id}`) : undefined} />
            <Kpi label="Highest profit deal" value={perf.highest_profit_deal ? <Money v={perf.highest_profit_deal.value} /> : '-'} hint={perf.highest_profit_deal?.name} onClick={perf.highest_profit_deal ? go(`/gulati/deals/${perf.highest_profit_deal.id}`) : undefined} />
            <Kpi label="Most active client" value={perf.most_active_client?.name || '-'} hint={perf.most_active_client ? `${perf.most_active_client.count} deals` : undefined} onClick={perf.most_active_client ? go(`/gulati/deals?status=all&party_id=${perf.most_active_client.id}`) : undefined} />
            <Kpi label="Most active vendor" value={perf.most_active_vendor?.name || '-'} hint={perf.most_active_vendor ? `${perf.most_active_vendor.count} deals` : undefined} onClick={perf.most_active_vendor ? go(`/gulati/deals?status=all&vendor_id=${perf.most_active_vendor.id}`) : undefined} />
          </div>
          <div className={`${card} overflow-x-auto`}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Trading type performance</h3>
            {perf.by_trading_type.length === 0 ? <Empty>No trading types.</Empty> : (
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-left text-xs text-tertiary-500"><tr><th className="py-1 font-medium">Trading type</th><th className="px-2 text-right font-medium">Deals</th><th className="px-2 text-right font-medium">Sales qty</th><th className="px-2 text-right font-medium">Sales value</th><th className="px-2 text-right font-medium">Gross profit</th><th className="px-2 text-right font-medium">Net profit</th></tr></thead>
                <tbody>
                  {perf.by_trading_type.map((t) => (
                    <tr key={t.key} className="cursor-pointer border-t hover:bg-primary-50/50" onClick={go(`/gulati/finance?tab=types&trading_type=${t.key}`)}>
                      <td className="py-1.5 font-medium">{t.label}</td>
                      <td className="px-2 text-right tabular-nums">{t.deals}</td>
                      <td className="px-2 text-right tabular-nums">{qtyLabel(t.sales_qty)}</td>
                      <td className="px-2 text-right"><Money v={t.sales_revenue} /></td>
                      <td className="px-2 text-right"><Money v={t.gross_profit} signed /></td>
                      <td className="px-2 text-right font-semibold"><Money v={t.net_profit} signed /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
