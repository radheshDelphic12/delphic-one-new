import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { INVESTMENT_TYPE_META, LEAD_STAGES, SERVICE_TYPES, pctLabel } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { DateInput, Empty, Kpi, Money, Select, card } from '../../components/acconcy/ui.jsx';
import { shortMonth } from '../../lib/format.js';

function Th({ children, right }) {
  return <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
const BLANK = { service_type: '', party_id: '', assignee_id: '', from: '', to: '' };

function Filters({ f, set, pickers, onReset, dateLabelPrefix }) {
  return (
    <div className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-5`}>
      <Select label="Service type" value={f.service_type} onChange={(v) => set('service_type', v)} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} blank="All services" />
      <Select label="Client" value={f.party_id} onChange={(v) => set('party_id', v)} options={pickers.clients} blank="All clients" />
      <Select label="Employee / contractor" value={f.assignee_id} onChange={(v) => set('assignee_id', v)} options={[...pickers.employees, ...pickers.contractors]} blank="Anyone" />
      <DateInput label={`${dateLabelPrefix} from`} value={f.from} onChange={(v) => set('from', v)} />
      <DateInput label={`${dateLabelPrefix} to`} value={f.to} onChange={(v) => set('to', v)} />
      <div className="flex justify-end sm:col-span-2 lg:col-span-5"><button type="button" className="text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={onReset}>Clear filters</button></div>
    </div>
  );
}

function LeadsReport({ pickers }) {
  const { pushError } = useAlerts();
  const [f, setF] = useState(BLANK);
  const [d, setD] = useState(null);
  useEffect(() => {
    acconcyApi.leadReport(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).then(setD, (e) => pushError(acconcyError(e, 'Could not load the report'), 'Load failed'));
  }, [f, pushError]);
  return (
    <div className="space-y-4">
      <Filters f={f} set={(k, v) => setF((c) => ({ ...c, [k]: v }))} pickers={pickers} onReset={() => setF(BLANK)} dateLabelPrefix="Created" />
      {!d ? <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Leads" value={d.total} /><Kpi label="Won" value={d.won} tone="text-green-700" /><Kpi label="Converted to deals" value={d.converted} /><Kpi label="Conversion (won to deal)" value={pctLabel(d.conversion_pct)} tone="ax-gold" /></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={`${card} overflow-x-auto`}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Leads by service</h3>
              <table className="w-full min-w-[28rem] text-sm"><thead className="text-xs text-tertiary-500"><tr><Th>Service</Th><Th right>Leads</Th><Th right>Open</Th><Th right>Won</Th><Th right>Dropped</Th><Th right>Expected</Th></tr></thead>
                <tbody>{d.by_service.map((r) => <tr key={r.key} className="border-t"><td className="px-3 py-1.5">{r.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.total}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.open}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.won}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.dropped}</td><td className="px-3 py-1.5 text-right"><Money v={r.expected_amount} /></td></tr>)}</tbody></table>
              {d.by_service.length === 0 && <Empty>No leads in this view.</Empty>}
            </section>
            <section className={`${card} overflow-x-auto`}>
              <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Leads by stage</h3>
              <table className="w-full min-w-[16rem] text-sm"><thead className="text-xs text-tertiary-500"><tr><Th>Stage</Th><Th right>Leads</Th></tr></thead>
                <tbody>{d.by_stage.map((r) => <tr key={r.key} className="border-t"><td className="px-3 py-1.5">{LEAD_STAGES.find((s) => s.value === r.key)?.label || r.key}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.total}</td></tr>)}</tbody></table>
            </section>
          </div>
          <section className={`${card} overflow-x-auto`}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Leads by employee / contractor</h3>
            <table className="w-full min-w-[34rem] text-sm"><thead className="text-xs text-tertiary-500"><tr><Th>Person</Th><Th right>Leads</Th><Th right>Open</Th><Th right>Won</Th><Th right>Converted</Th><Th right>Conversion</Th></tr></thead>
              <tbody>{d.by_employee.map((r) => <tr key={r.key} className="border-t"><td className="px-3 py-1.5">{r.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.total}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.open}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.won}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.converted}</td><td className="px-3 py-1.5 text-right">{pctLabel(r.conversion_pct)}</td></tr>)}</tbody></table>
            {d.by_employee.length === 0 && <Empty>No leads in this view.</Empty>}
          </section>
        </>
      )}
    </div>
  );
}

function DealsReport({ pickers, showMoney }) {
  const { pushError } = useAlerts();
  const [f, setF] = useState(BLANK);
  const [d, setD] = useState(null);
  useEffect(() => {
    acconcyApi.dealReport({ status: 'all', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).then(setD, (e) => pushError(acconcyError(e, 'Could not load the report'), 'Load failed'));
  }, [f, pushError]);
  const cols = (rows, label, labelFn) => (
    <section className={`${card} overflow-x-auto`}>
      <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">{label}</h3>
      {rows.length === 0 ? <Empty>No deals in this view.</Empty> : (
        <table className="w-full min-w-[34rem] text-sm"><thead className="text-xs text-tertiary-500"><tr><Th>{label.replace('Deals by ', '')}</Th><Th right>Deals</Th><Th right>Deal amount</Th>{showMoney && <><Th right>Revenue</Th><Th right>Expenses</Th><Th right>Profit</Th></>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key} className="border-t"><td className="px-3 py-1.5">{labelFn ? labelFn(r) : r.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.deals}</td><td className="px-3 py-1.5 text-right"><Money v={r.deal_amount} /></td>{showMoney && <><td className="px-3 py-1.5 text-right"><Money v={r.revenue} /></td><td className="px-3 py-1.5 text-right"><Money v={r.expense} /></td><td className="px-3 py-1.5 text-right"><Money v={r.profit} signed className="font-semibold" /></td></>}</tr>)}</tbody></table>
      )}
    </section>
  );
  return (
    <div className="space-y-4">
      <Filters f={f} set={(k, v) => setF((c) => ({ ...c, [k]: v }))} pickers={pickers} onReset={() => setF(BLANK)} dateLabelPrefix="Started" />
      {!d ? <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Kpi label="Deals" value={d.totals.deals} /><Kpi label="Deal amount" value={<Money v={d.totals.deal_amount} />} />{showMoney && <><Kpi label="Revenue" value={<Money v={d.totals.revenue} />} /><Kpi label="Expenses" value={<Money v={d.totals.expense} />} /><Kpi label="Profit" value={<Money v={d.totals.profit} signed />} tone="ax-gold" /></>}</div>
          <div className="grid gap-4 lg:grid-cols-2">{cols(d.by_service, 'Deals by service')}{cols(d.by_client, 'Deals by client')}</div>
          {cols(d.by_month, 'Deals by start month', (r) => shortMonth(r.key))}
        </>
      )}
    </div>
  );
}

function InvestmentsReport() {
  const { pushError } = useAlerts();
  const [f, setF] = useState({ from: '', to: '', service_type: '' });
  const [d, setD] = useState(null);
  useEffect(() => {
    acconcyApi.investmentReport(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).then(setD, (e) => pushError(acconcyError(e, 'Could not load the report'), 'Load failed'));
  }, [f, pushError]);
  return (
    <div className="space-y-4">
      <div className={`${card} grid gap-3 sm:grid-cols-3`}>
        <Select label="Service type" value={f.service_type} onChange={(v) => setF((c) => ({ ...c, service_type: v }))} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} blank="All services" />
        <DateInput label="Invested from" value={f.from} onChange={(v) => setF((c) => ({ ...c, from: v }))} />
        <DateInput label="Invested to" value={f.to} onChange={(v) => setF((c) => ({ ...c, to: v }))} />
      </div>
      {!d ? <div className="py-8 text-center text-sm text-tertiary-500">Loading...</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Kpi label="Holdings" value={d.count} /><Kpi label="Invested" value={<Money v={d.totals.invested} />} /><Kpi label="Current value" value={<Money v={d.totals.current_value} />} /><Kpi label="Gain / loss" value={<Money v={d.totals.gain_loss} signed />} tone="ax-gold" /><Kpi label="Gain / loss %" value={pctLabel(d.totals.gain_loss_pct)} /></div>
          <section className={`${card} overflow-x-auto`}>
            <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">Investment by type</h3>
            <table className="w-full min-w-[40rem] text-sm"><thead className="text-xs text-tertiary-500"><tr><Th>Type</Th><Th right>Holdings</Th><Th right>Invested</Th><Th right>Current value</Th><Th right>Realised</Th><Th right>Unrealised</Th><Th right>Gain / loss</Th></tr></thead>
              <tbody>{d.by_type.map((r) => <tr key={r.type} className="border-t"><td className="px-3 py-1.5">{INVESTMENT_TYPE_META[r.type]?.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td><td className="px-3 py-1.5 text-right"><Money v={r.invested} /></td><td className="px-3 py-1.5 text-right"><Money v={r.current_value} /></td><td className="px-3 py-1.5 text-right"><Money v={r.realised_gain} signed /></td><td className="px-3 py-1.5 text-right"><Money v={r.unrealised_gain} signed /></td><td className="px-3 py-1.5 text-right"><Money v={r.gain_loss} signed className="font-semibold" /></td></tr>)}</tbody></table>
          </section>
        </>
      )}
    </div>
  );
}

export default function AcconcyReportsPage() {
  const { me, loading } = useAcconcy();
  const pickers = usePickers();
  const [tab, setTab] = useState(null);
  const tabs = useMemo(() => (me ? [
    ...(axCan(me, 'leads') ? [{ key: 'leads', label: 'Leads' }] : []),
    ...(axCan(me, 'deals') ? [{ key: 'deals', label: 'Deals' }] : []),
    ...(axCan(me, 'investments') ? [{ key: 'investments', label: 'Investments' }] : []),
  ] : []), [me]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!tabs.length) return <Navigate to="/acconcy" replace />;
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-tertiary-500">Finance, P&L and valuation reports are under Revenue & Expenses and Financials & Valuation.</p>
      <SectionTabs tabs={tabs} value={current} onChange={setTab} />
      {current === 'leads' && <LeadsReport pickers={pickers} />}
      {current === 'deals' && <DealsReport pickers={pickers} showMoney={axCan(me, 'overview')} />}
      {current === 'investments' && <InvestmentsReport />}
    </div>
  );
}
