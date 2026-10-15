import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { INVESTMENT_STATUS_META } from '../../lib/novarex/meta.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Pill from '../../components/ui/Pill.jsx';
import ChartCard from '../../components/ui/ChartCard.jsx';
import NxFilterBar, { useNxFilters } from '../../components/novarex/NxFilters.jsx';
import InvestmentDrawer from '../../components/novarex/InvestmentDrawer.jsx';
import { InvestmentReturnsChart } from '../../components/novarex/NxCharts.jsx';
import { Kpi, Money } from '../../components/novarex/ui.jsx';

export default function NovarexInvestmentsPage() {
  const { me, loading } = useNovarex();
  const { pushError } = useAlerts();
  const [params, setParams] = useSearchParams();
  const pickers = useNxPickers({ people: false });
  // Investments are filtered by when they were placed; with no period chosen, every investment is listed.
  const filters = useNxFilters({ preset: 'custom', extra: {} });
  const { f, key } = filters;
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [drawer, setDrawer] = useState({ open: params.get('new') === '1', investment: null });
  const query = useCallback(() => ({ q: f.q, from: f.from, to: f.to, category_id: f.investment_category_id, status: f.investment_status, outlet_id: f.outlet_id, ownership_type_id: f.ownership_type_id, format_id: f.format_id, page, limit: 25 }), [f, page]);
  const load = useCallback(() => nxApi.investments(query()).then(setData, (e) => pushError(novarexError(e, 'Could not load the investments'), 'Load failed')), [query, pushError]);
  useEffect(() => { setPage(1); }, [key]);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'investments')) return <Navigate to="/novarex" replace />;
  const close = () => { setDrawer({ open: false, investment: null }); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };
  const t = data?.totals;

  async function remove(r) {
    if (!window.confirm(`Delete ${r.code}? This is only possible while no return is recorded.`)) return;
    try { await nxApi.deleteInvestment(r.id); load(); pickers.refresh(); } catch (e) { pushError(novarexError(e, 'Could not delete'), 'Not deleted'); }
  }
  const columns = [
    { key: 'name', header: 'Investment', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.code}{r.category ? ` · ${r.category.name}` : ''}{r.investor ? ` · ${r.investor}` : ''}</span></span> },
    { key: 'outlet', header: 'Outlet', render: (r) => (r.outlet ? <span className="text-tertiary-800">{r.outlet.name}<span className="block text-xs text-tertiary-500">{r.outlet.code}</span></span> : <span className="text-tertiary-400">Company level</span>) },
    { key: 'date', header: 'Date', render: (r) => dateLabel(r.investment_date) },
    { key: 'amount', header: 'Invested', render: (r) => <Money v={r.amount} /> },
    { key: 'pr', header: 'Principal returned', render: (r) => <Money v={r.principal_returned} /> },
    { key: 'earn', header: 'Earnings', render: (r) => <Money v={r.earnings} /> },
    { key: 'out', header: 'Outstanding principal', render: (r) => <Money v={r.outstanding_principal} /> },
    { key: 'exp', header: 'Expected return', render: (r) => (r.expected_return_amount === null ? '-' : <span><Money v={r.expected_return_amount} /><span className="block text-xs text-tertiary-500">{r.expected_return_date ? `by ${dateLabel(r.expected_return_date)}` : ''}</span></span>) },
    { key: 'var', header: 'Received vs expected', render: (r) => (r.return_variance === null ? '-' : <span className={r.return_variance < 0 ? 'text-amber-700' : 'text-emerald-700'}><Money v={r.return_variance} signed /></span>) },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={INVESTMENT_STATUS_META[r.status]?.tone}>{INVESTMENT_STATUS_META[r.status]?.label || r.status}</Pill> },
    { key: 'a', header: '', render: (r) => (nxCan(me, 'delete') && !r.returns.length ? <button type="button" className="text-xs font-medium text-danger-600 hover:underline" onClick={(e) => { e.stopPropagation(); remove(r); }}>Delete</button> : null) },
  ];

  return (
    <div className="mt-4 space-y-4">
      <NxFilterBar filters={filters} pickers={pickers} showPeriod={false} fields={['outlet_id', 'ownership_type_id', 'format_id', 'investment_category_id', 'investment_status']} searchPlaceholder="Search name, code, investor...">
        {nxCan(me, 'investmentsEdit') && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ open: true, investment: null })}><Plus className="h-4 w-4" />New investment</button>}
      </NxFilterBar>
      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Capital invested" value={<Money v={t.invested} />} hint="Active investments only" />
          <Kpi label="Principal returned" value={<Money v={t.principal_returned} />} hint="Not income" />
          <Kpi label="Earnings received" value={<Money v={t.earnings} />} tone="text-emerald-700" />
          <Kpi label="Outstanding principal" value={<Money v={t.outstanding_principal} />} />
          <Kpi label="Overdue" value={t.overdue} hint="Expected date passed, money outstanding" tone={t.overdue ? 'text-red-600' : undefined} />
        </div>
      )}
      {data && data.data.length > 0 && <ChartCard title="Expected versus actual returns" subtitle="Per investment on this page"><InvestmentReturnsChart rows={data.data} /></ChartCard>}
      <DataTable columns={columns} rows={data?.data || []} loading={!data} emptyLabel="No investments yet. Add one to start tracking capital, principal and earnings." onRowClick={(r) => setDrawer({ open: true, investment: r })} maxHeight="60vh" />
      {data && (
        <div className="flex items-center justify-between text-xs text-tertiary-500">
          <span>{data.pagination.total} investment{data.pagination.total === 1 ? '' : 's'} · totals above follow the filters</span>
          <span className="flex items-center gap-2">
            <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {data.pagination.page} of {data.pagination.pages}</span>
            <button type="button" className="btn-secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </span>
        </div>
      )}
      <InvestmentDrawer open={drawer.open} investment={drawer.investment} categories={pickers.investmentCategories} outlets={pickers.outlets} me={me} onClose={close} onChanged={() => { load(); pickers.refresh(); }} />
    </div>
  );
}
