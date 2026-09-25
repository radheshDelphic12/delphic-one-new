import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Clock, FileText, IndianRupee } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, isoDate, money } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';

const POLL_MS = 30000;

export function LiveIndicator({ updatedAt, everyMs }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-tertiary-500">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      Live{updatedAt ? ` - updated ${updatedAt.toLocaleTimeString()}` : ''}
      {everyMs ? ` (every ${Math.round(everyMs / 1000)}s)` : ''}
    </span>
  );
}

export function RangeBar({ from, to, onChange }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-medium text-tertiary-600">From<input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" /></label>
      <label className="text-xs font-medium text-tertiary-600">To<input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} className="mt-1 block rounded-xl border px-3 py-1.5 text-sm" /></label>
    </div>
  );
}

export function monthStartIso() {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

/** Client billing + sales, refreshed every 30s, with clickable per-client revenue. */
export default function LiveSalesTab() {
  const [days, setDays] = useState(30);
  const [range, setRange] = useState({ from: monthStartIso(), to: isoDate() });
  const live = useLiveData(() => apiClient.get('/analytics/live-sales', { params: { days } }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [days] });
  const clients = useLiveData(() => apiClient.get('/analytics/revenue-by-client', { params: range }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [range.from, range.to] });

  const data = live.data;
  const invoiced = (data?.invoices || []).filter((i) => ['sent', 'paid'].includes(i.status)).reduce((s, i) => s + i.amount, 0);
  const draft = (data?.invoices || []).find((i) => i.status === 'draft')?.amount || 0;

  const columns = [
    { key: 'client_name', header: 'Client', render: (row) => <Link className="font-medium text-primary-700 hover:underline" to={`/accounts/${row.account_id}`} onClick={(e) => e.stopPropagation()}>{row.client_name}</Link> },
    { key: 'brought_by', header: 'Brought by', render: (row) => row.brought_by?.name || '-' },
    { key: 'owner', header: 'Owner', render: (row) => row.owner?.name || '-' },
    { key: 'billable_hours', header: 'Hours', render: (row) => row.billable_hours },
    { key: 'revenue', header: 'Revenue', render: (row) => <span className="font-medium">{money(row.revenue)}</span> },
    { key: 'invoiced', header: 'Invoiced', render: (row) => money(row.invoiced) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveIndicator updatedAt={live.updatedAt} everyMs={POLL_MS} />
        <label className="text-xs font-medium text-tertiary-600">
          Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-2 rounded-xl border px-2 py-1 text-sm">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue (month to date)" value={money(data?.month_to_date.revenue)} icon={IndianRupee} theme="green" />
        <KpiCard label="Billable hours (MTD)" value={data?.month_to_date.hours ?? 0} icon={Clock} theme="blue" />
        <KpiCard label="Invoiced (sent + paid)" value={money(invoiced)} icon={FileText} theme="purple" />
        <KpiCard label="Not yet invoiced (draft)" value={money(draft)} icon={Activity} theme="orange" />
      </div>

      <ChartCard title="Daily billed revenue" subtitle="Approved billable hours x applicable client rate">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data?.series || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primarySoft} fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Revenue by client <span className="font-normal text-tertiary-500">- click a client to open the account</span></h2>
        <RangeBar from={range.from} to={range.to} onChange={setRange} />
      </div>
      <DataTable columns={columns} rows={(clients.data?.clients || []).map((c) => ({ ...c, id: c.account_id }))} loading={clients.loading} emptyLabel="No billed revenue in this range" />

      <div className="grid gap-4 lg:grid-cols-2">
        {[['Revenue by who brought the client', clients.data?.by_brought_by], ['Revenue by current owner', clients.data?.by_owner]].map(([title, rows]) => (
          <ChartCard key={title} title={title}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(rows || []).map((r) => ({ name: r.user?.name || 'Unassigned', revenue: r.revenue }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
                  <Bar dataKey="revenue" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        ))}
      </div>
    </div>
  );
}
