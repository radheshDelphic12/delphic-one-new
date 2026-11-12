import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { downloadCsv, printReport } from '../../lib/groupExport.js';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { useOpsPickers } from '../../lib/novarex/opsPickers.js';
import { rangeLabel } from '../../lib/novarex/periods.js';
import DataTable from '../../components/ui/DataTable.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import NxFilterBar, { useNxFilters } from '../../components/novarex/NxFilters.jsx';
import { Kpi, Money, inputCls, titleOf } from '../../components/novarex/ops/common.jsx';

const short = (v) => { const n = Number(v || 0); const a = Math.abs(n); return a >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n)); };
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const FILTER_FIELDS = ['outlet_id', 'ownership_kind', 'warehouse_id', 'product_id', 'product_category_id', 'customer_id', 'supplier_id', 'partner_id', 'invoice_status', 'state', 'city'];

/** Line chart (only line charts are used in Novarex): one line per series over the months in view. */
function Lines({ data, lines, height = 260 }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={short} width={56} />
          <Tooltip formatter={(v, n) => [Number(v).toLocaleString('en-IN'), n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map(([key, name, color, dashed]) => <Line key={key} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '5 4' : undefined} dot={data.length < 14} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Dashboard({ filters, pickers }) {
  const params = useMemo(() => { const { q: _q, product_category_id: pc, ...rest } = filters.params; return { ...rest, ...(pc ? { category_id: pc } : {}) }; }, [filters.params]);
  const { data: d, loading } = useLiveData(() => nxApi.ops.dashboard(params), { deps: [JSON.stringify(params)], intervalMs: 60000 });
  const navigate = useNavigate();
  if (loading && !d) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!d) return <div className="py-10 text-center text-sm text-tertiary-500">No data.</div>;
  const k = d.kpis;
  const series = d.series.map((r) => ({ ...r, label: monthLabel(r.month) }));
  const whLine = d.stock.value_by_warehouse.map((r) => ({ label: r.label, value: r.value }));
  const prodLine = d.top_products.map((r) => ({ label: r.product, revenue: r.revenue }));
  void pickers;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Sales revenue" value={<Money v={k.sales_revenue} />} hint="Invoiced without GST, less credit notes" />
        <Kpi label="Cost of goods sold" value={<Money v={k.cost_of_goods} />} hint="Batch cost of what was sold. Purchases are not a cost" />
        <Kpi label="Gross profit" value={<Money v={k.gross_profit} signed />} hint={k.gross_margin_pct === null ? 'No sales' : `Margin ${k.gross_margin_pct}%`} />
        <Kpi label="Cash collected" value={<Money v={k.cash_collected} />} hint="Customer receipts in the period" />
        <Kpi label="Receivables" value={<Money v={k.receivables} />} hint={`Overdue ${k.receivables_overdue}`} tone={k.receivables_overdue > 0 ? 'text-amber-700' : undefined} onClick={() => navigate('/novarex/invoices')} />
        <Kpi label="Payables to suppliers" value={<Money v={k.payables} />} hint="Open purchase invoices" />
        <Kpi label="Inventory value" value={<Money v={k.inventory_value} />} hint={`Near expiry ${k.near_expiry_value} · expired ${k.expired_stock_value}`} />
        <Kpi label="Purchases" value={<Money v={k.purchases} />} hint="Goods bought in the period (inventory)" />
        <Kpi label="Franchise fees and royalties" value={<Money v={k.franchise_fees} />} hint="Invoiced in the period" />
        <Kpi label="Logistics cost" value={<Money v={k.logistics_cost} />} hint={`Freight variance ${d.delivery.freight_variance}`} />
        <Kpi label="On-time deliveries" value={d.delivery.on_time_pct === null ? '-' : `${d.delivery.on_time_pct}%`} hint={`${d.delivery.on_time} of ${d.delivery.delivered} delivered`} />
        <Kpi label="Stock alerts" value={d.stock.alerts.expired + d.stock.alerts.near_expiry + d.stock.alerts.below_reorder + d.stock.alerts.recalled} hint={`${d.stock.alerts.expired} expired · ${d.stock.alerts.near_expiry} near expiry · ${d.stock.alerts.below_reorder} low stock`} tone={d.stock.alerts.expired ? 'text-red-600' : undefined} onClick={() => navigate('/novarex/stock')} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Sales, cost of goods and gross profit" subtitle="By month for the chosen period and filters"><Lines data={series} lines={[['sales', 'Sales revenue', '#0F766E'], ['cogs', 'Cost of goods', '#9b3b4b'], ['gross_profit', 'Gross profit', '#2563A8', true]]} /></ChartCard>
        <ChartCard title="Purchases, collections and logistics" subtitle="Money bought in, received and spent on freight"><Lines data={series} lines={[['purchases', 'Purchases', '#B08D57'], ['collections', 'Cash collected', '#5f8f6b'], ['logistics', 'Logistics', '#7c3aed'], ['franchise_fees', 'Franchise fees', '#2563A8', true]]} /></ChartCard>
        <ChartCard title="Inventory value by location" subtitle="Quantity x batch cost, now (a line over the locations)">{whLine.length ? <Lines data={whLine} lines={[['value', 'Inventory value', '#0F766E']]} /> : <p className="py-8 text-center text-sm text-tertiary-500">No stock.</p>}</ChartCard>
        <ChartCard title="Top products by sales" subtitle="Revenue without GST (a line over the products)">{prodLine.length ? <Lines data={prodLine} lines={[['revenue', 'Sales revenue', '#2563A8']]} /> : <p className="py-8 text-center text-sm text-tertiary-500">No sales in this period.</p>}</ChartCard>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <DataTable embedded columns={[{ key: 'o', header: 'Outlet', render: (r) => <span className="font-medium text-tertiary-900">{r.outlet}</span> }, { key: 'w', header: 'Ownership', render: (r) => r.ownership || '-' }, { key: 'n', header: 'Orders', render: (r) => r.orders }, { key: 'r', header: 'Sales', render: (r) => <Money v={r.revenue} /> }, { key: 'c', header: 'Cost of goods', render: (r) => <Money v={r.cogs} /> }, { key: 'g', header: 'Gross profit', render: (r) => <Money v={r.gross_profit} signed /> }, { key: 'f', header: 'Fees', render: (r) => <Money v={r.franchise_fees} /> }, { key: 'l', header: 'Logistics', render: (r) => <Money v={r.logistics} /> }, { key: 'rc', header: 'Receivable', render: (r) => <Money v={r.receivable} /> }]} rows={d.outlets.map((r, i) => ({ ...r, id: r.outlet_id || `none-${i}` }))} emptyLabel="No outlet activity in this period." />
        <p className="border-t px-4 py-2 text-[11px] text-tertiary-500">Franchise and third-party outlets show only what Novarex sold or invoiced to them. Their own retail sales, salaries and expenses are never counted as Novarex income or cost. Transfers between company locations are not sales.</p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Orders</h4><div className="flex flex-wrap gap-1">{Object.entries(d.order_status).map(([s, n]) => <Pill key={s} tone="blue">{titleOf(s)}: {n}</Pill>)}{!Object.keys(d.order_status).length && <span className="text-tertiary-400">None</span>}</div></div>
        <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">Shipments</h4><div className="flex flex-wrap gap-1">{Object.entries(d.shipment_status).map(([s, n]) => <Pill key={s} tone="purple">{titleOf(s)}: {n}</Pill>)}{!Object.keys(d.shipment_status).length && <span className="text-tertiary-400">None</span>}</div></div>
      </div>
    </div>
  );
}

function Reports({ filters }) {
  const { pushError } = useAlerts();
  const [list, setList] = useState([]);
  const [name, setName] = useState('sales_monthly');
  const [data, setData] = useState(null);
  const params = useMemo(() => { const { q, product_category_id: pc, ...rest } = filters.params; return { ...rest, ...(pc ? { category_id: pc } : {}), ...(q ? { q } : {}) }; }, [filters.params]);
  useEffect(() => { nxApi.ops.reportList().then(setList, () => setList([])); }, []);
  useEffect(() => { setData(null); nxApi.ops.report(name, params).then(setData, (e) => { setData({ columns: [], rows: [] }); pushError(novarexError(e, 'Could not load the report'), 'Report failed'); }); }, [name, params, pushError]);
  const label = list.find((r) => r.key === name)?.label || name;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-tertiary-600">Report<select className={`${inputCls} mt-1 block min-w-[18rem]`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Report">{list.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" disabled={!data?.rows?.length} onClick={() => downloadCsv(`novarex-${name}-${params.from || ''}-${params.to || ''}.csv`, data.columns, data.rows)}>CSV</button>
          <button type="button" className="btn-secondary" disabled={!data?.rows?.length} onClick={() => { if (!printReport(label, `Novarex Pharmaceuticals · ${rangeLabel(params)}`, data.columns, data.rows)) pushError('Allow pop-ups to export the PDF', 'Export blocked'); }}>PDF</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500"><tr>{(data?.columns || []).map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
          <tbody>
            {!data && <tr><td className="px-3 py-6 text-center text-tertiary-500">Loading...</td></tr>}
            {data && data.rows.length === 0 && <tr><td className="px-3 py-6 text-center text-tertiary-500" colSpan={Math.max(1, data.columns.length)}>No rows for these filters.</td></tr>}
            {data?.rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="px-3 py-1.5 tabular-nums">{typeof c === 'number' ? c.toLocaleString('en-IN') : c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Operations dashboard (sales, stock, receivables, franchise, logistics) and the operations reports, with one set of live filters. */
export default function NovarexOperationsPage() {
  const { me, loading } = useNovarex();
  const nxp = useNxPickers({ people: false });
  const ops = useOpsPickers();
  const pickers = { ...nxp, ...ops };
  const filters = useNxFilters({ preset: 'current_month' });
  const [tab, setTab] = useState('dashboard');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'opsReports')) return <Navigate to="/novarex" replace />;
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={[{ key: 'dashboard', label: 'Operations dashboard' }, { key: 'reports', label: 'Operations reports' }]} value={tab} onChange={setTab} />
      <NxFilterBar filters={filters} pickers={pickers} fields={FILTER_FIELDS} searchPlaceholder="Search (reports)..." />
      {tab === 'dashboard' ? <Dashboard filters={filters} pickers={pickers} /> : <Reports filters={filters} />}
    </div>
  );
}
