import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeftRight, LayoutGrid, Plus, Tags, Users2, ShoppingCart, TrendingUp, Truck } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, dateLabel, isoDate, money, titleCase } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { LiveIndicator } from '../analytics/LiveSalesTab.jsx';
import PartnersTab from './PartnersTab.jsx';
import ItemsRatesTab, { useTradeLookups } from './ItemsRatesTab.jsx';

const POLL_MS = 60000;
const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'partners', label: 'Suppliers & consumers', icon: Users2 },
  { key: 'rates', label: 'Items & rate cards', icon: Tags },
  { key: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
];

function OverviewTab() {
  const { data, updatedAt } = useLiveData(() => apiClient.get('/trading/summary').then((r) => r.data.data), { intervalMs: POLL_MS });
  const funnel = data ? Object.entries(data.onboarding_funnel).map(([stage, count]) => ({ stage: titleCase(stage), count })) : [];
  return (
    <div className="space-y-4">
      <LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Suppliers (active / total)" value={data ? `${data.partners.supplier.active}/${data.partners.supplier.total}` : '-'} hint={data ? `${data.partners.supplier.trading} trading` : undefined} icon={Truck} theme="blue" />
        <KpiCard label="Consumers (active / total)" value={data ? `${data.partners.consumer.active}/${data.partners.consumer.total}` : '-'} hint={data ? `${data.partners.consumer.trading} trading` : undefined} icon={Users2} theme="purple" />
        <KpiCard label="Sales (30 days)" value={money(data?.trailing_30d.sales)} hint={data ? `Purchases ${money(data.trailing_30d.purchases)}` : undefined} icon={TrendingUp} theme="green" />
        <KpiCard label="Gross margin (30 days)" value={money(data?.trailing_30d.gross_margin)} hint={data ? `${data.open_transactions.count} open, ${money(data.open_transactions.amount)}` : undefined} icon={ShoppingCart} theme={(data?.trailing_30d.gross_margin || 0) < 0 ? 'red' : 'orange'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Onboarding funnel" subtitle="Leads to active partners">
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} /><XAxis dataKey="stage" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip contentStyle={chartTooltipStyle} /><Bar dataKey="count" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </ChartCard>
        <ChartCard title="Top partners (30 days)" subtitle="By completed transaction value">
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={(data?.top_partners || []).map((t) => ({ name: t.partner.name, amount: t.amount }))} margin={{ top: 8, right: 8, left: 24, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} /><XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} /><Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} /><Bar dataKey="amount" fill={CHART_COLORS.success} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
        </ChartCard>
      </div>
    </div>
  );
}

function TransactionsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useState({ txn_type: '', status: '' });
  const [drawer, setDrawer] = useState(false);
  const lookups = useTradeLookups(drawer);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const list = useLiveData(() => apiClient.get('/trading/transactions', { params: { ...params, limit: 100 } }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [filters.txn_type, filters.status] });

  async function create(values) {
    try {
      await apiClient.post('/trading/transactions', values);
      pushSuccess('Transaction recorded');
      list.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record transaction'), 'Could not save');
      throw err;
    }
  }
  async function setStatus(row, status) {
    try {
      await apiClient.patch(`/trading/transactions/${row.id}`, { status });
      list.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update'), 'Could not update');
    }
  }

  const cols = [
    { key: 'txn_date', header: 'Date', render: (r) => dateLabel(r.txn_date) },
    { key: 'txn_type', header: 'Type', render: (r) => <Pill tone={r.txn_type === 'sale' ? 'green' : 'blue'}>{titleCase(r.txn_type)}</Pill> },
    { key: 'partner', header: 'Partner', render: (r) => r.partner.name },
    { key: 'item', header: 'Item', render: (r) => r.item.name },
    { key: 'quantity', header: 'Qty', render: (r) => `${r.quantity} ${r.item.unit}` },
    { key: 'rate', header: 'Rate', render: (r) => money(r.rate) },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-medium">{money(r.amount)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'actions', header: '', render: (r) => (r.status === 'open' ? (
      <span className="flex gap-2"><button type="button" className="text-xs font-medium text-green-700 hover:underline" onClick={() => setStatus(r, 'completed')}>Complete</button><button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => setStatus(r, 'cancelled')}>Cancel</button></span>
    ) : null) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-3">
          <select value={filters.txn_type} onChange={(e) => setFilters((f) => ({ ...f, txn_type: e.target.value }))} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Type"><option value="">Purchases and sales</option><option value="purchase">Purchases</option><option value="sale">Sales</option></select>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-xl border px-3 py-1.5 text-sm" aria-label="Status"><option value="">All statuses</option><option value="open">Open (current)</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer(true)}><Plus className="h-4 w-4" />New transaction</button>
      </div>
      <DataTable columns={cols} rows={list.data || []} loading={list.loading} emptyLabel="No transactions" />
      <FormDrawer open={drawer} onClose={() => setDrawer(false)} title="New transaction" submitLabel="Record" onSubmit={create}
        intro="Only active partners can trade. Leave the rate blank to use the partner's rate card for that date. Purchase or sale follows from the partner type."
        fields={[
          { name: 'partner_id', label: 'Partner (active)', type: 'search', options: lookups.activePartnerOptions, required: true },
          { name: 'item_id', label: 'Item', type: 'search', options: lookups.itemOptions, required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0 },
          { name: 'rate', label: 'Rate override', type: 'number', hint: 'optional, defaults to rate card', min: 0 },
          { name: 'txn_date', label: 'Date', type: 'date', required: true, default: isoDate() },
          { name: 'status', label: 'Status', type: 'select', required: true, default: 'open', options: [{ value: 'open', label: 'Open (current)' }, { value: 'completed', label: 'Completed' }] },
          { name: 'reference', label: 'Reference / PO no.' },
        ]} />
    </div>
  );
}

export default function TradingHubPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'overview';
  const section = TABS.some((t) => t.key === requested) ? requested : 'overview';
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} value={section} onChange={(key) => setParams({ section: key })} />
      {section === 'overview' && <OverviewTab />}
      {section === 'partners' && <PartnersTab />}
      {section === 'rates' && <ItemsRatesTab />}
      {section === 'transactions' && <TransactionsTab />}
    </div>
  );
}
