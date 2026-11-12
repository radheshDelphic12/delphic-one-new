import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { downloadCsv, printReport } from '../../lib/groupExport.js';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { REPORT_LIST, inr } from '../../lib/novarex/meta.js';
import { rangeLabel } from '../../lib/novarex/periods.js';
import { useState } from 'react';
import NxFilterBar, { useNxFilters } from '../../components/novarex/NxFilters.jsx';
import { Empty, Money, card } from '../../components/novarex/ui.jsx';

const COLS = [
  ['opening_balance', 'Opening balance', 'cash'], ['new_investments', 'New investments'], ['principal_returned', 'Principal repaid'], ['investment_earnings', 'Investment earnings'],
  ['other_income', 'Other income'], ['total_income', 'Total income', 'bold'], ['operating_expenses', 'Operating expenses'], ['salary_expenses', 'Salary expenses', 'payroll'],
  ['other_expenses', 'Other expenses'], ['total_expenses', 'Total expenses', 'bold'], ['net_result', 'Net income / result', 'bold'],
  ['receivables', 'Receivables'], ['payables', 'Payables'], ['cash_in', 'Cash inflow'], ['cash_out', 'Cash outflow'], ['closing_balance', 'Closing balance', 'cash'],
  ['projected_income', 'Projected income'], ['projected_expenses', 'Projected expenses'], ['income_variance', 'Income variance'], ['expense_variance', 'Expense variance'],
];

/** The monthly financial report (every month of the period, with the projected figures and variances) and the other reports, with CSV / PDF export. */
export default function NovarexReportsPage() {
  const { me, loading } = useNovarex();
  const { pushError } = useAlerts();
  const pickers = useNxPickers({ people: true });
  const [report, setReport] = useState('monthly');
  const filters = useNxFilters({ preset: 'last_6', fyStart: me?.fy_start_month || 4 });
  const { f, params, key } = filters;
  const { data, loading: busy, error } = useLiveData(() => nxApi.report({ ...params, report }), { enabled: Boolean(me), deps: [report, key] });
  const monthly = useLiveData(() => (report === 'monthly' ? nxApi.monthlyReport(params) : Promise.resolve(null)), { enabled: Boolean(me) && report === 'monthly', deps: [report, key] });
  useEffect(() => { if (error) pushError(novarexError(error, 'Could not load the report'), 'Load failed'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'reports')) return <Navigate to="/novarex" replace />;
  const canExport = nxCan(me, 'export');
  const canSalary = nxCan(me, 'payroll');
  const reports = REPORT_LIST.filter(([k]) => canSalary || k !== 'salaries');
  const sub = rangeLabel(f);
  const m = monthly.data;
  const cols = COLS.filter(([, , t]) => (t !== 'payroll' || canSalary) && (t !== 'cash' || m?.opening_set));
  const cell = (r, k) => (r[k] === null || r[k] === undefined ? '-' : <Money v={r[k]} signed={k === 'net_result' || k.endsWith('variance')} />);

  const exportable = () => {
    if (report === 'monthly' && m) return { head: ['Month', ...cols.map(([, l]) => l)], rows: [...m.rows.map((r) => [r.month, ...cols.map(([k]) => r[k] ?? '')]), ['Total', ...cols.map(([k]) => (m.totals[k] === undefined ? '' : m.totals[k]))]] };
    if (data?.columns) return { head: data.columns, rows: data.rows };
    return null;
  };
  const ex = exportable();

  return (
    <div className="mt-4 space-y-4">
      <section className={`${card} flex flex-wrap items-end gap-3`}>
        <label className="text-xs font-medium text-tertiary-600">
          Report
          <select className="mt-1 block min-w-[18rem] rounded-xl border px-3 py-2 text-sm" value={report} onChange={(e) => setReport(e.target.value)} aria-label="Report">
            {reports.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {canExport ? (
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary" disabled={!ex} onClick={() => downloadCsv(`novarex-${report}-${f.from}-to-${f.to}.csv`, ex.head, ex.rows)}>CSV</button>
            <button type="button" className="btn-secondary" disabled={!ex} onClick={() => { if (!printReport(REPORT_LIST.find(([k]) => k === report)[1], `Novarex Pharmaceuticals · ${sub}`, ex.head, ex.rows)) pushError('Allow pop-ups to export the PDF', 'Export blocked'); }}>PDF</button>
          </div>
        ) : <p className="ml-auto text-xs text-tertiary-400">Export is available to finance and admin.</p>}
      </section>
      <NxFilterBar filters={filters} pickers={pickers} fields={['outlet_id', 'ownership_type_id', 'format_id', 'investment_category_id', 'investment_status', 'income_category_id', 'expense_category_id', 'payment_status', ...(canSalary ? ['person_id'] : [])]} searchPlaceholder="Search..." />

      {report === 'monthly' ? (
        !m ? <div className="py-8 text-center text-sm text-tertiary-500">{monthly.loading ? 'Loading...' : 'No data.'}</div> : (
          <section className={`${card} overflow-x-auto ${monthly.loading ? 'opacity-60' : ''}`} aria-label="Monthly financial report">
            <h2 className="mb-1 font-heading text-lg font-semibold text-tertiary-900">Monthly financial report</h2>
            <p className="mb-3 text-xs text-tertiary-500">Income and expenses are the recognised figures; cash inflow / outflow count only money actually received or paid. Principal returned and capital placed are not income or expenses. {m.payroll_hidden && 'Salary figures are restricted.'} {!m.opening_set && 'Set an opening balance in setup to see opening and closing balances.'}</p>
            {m.rows.length === 0 ? <Empty>No months in this period.</Empty> : (
              <table className="w-full min-w-[60rem] text-sm">
                <thead className="text-left text-xs text-tertiary-500"><tr><th className="sticky left-0 bg-white py-2 pr-3 font-medium">Month</th>{cols.map(([k, label, t]) => <th key={k} className={`px-2 py-2 text-right font-medium ${t === 'bold' ? 'text-tertiary-800' : ''}`}>{label}</th>)}</tr></thead>
                <tbody>
                  {m.rows.map((r) => <tr key={r.month} className="border-t"><td className="sticky left-0 bg-white py-2 pr-3 font-medium text-tertiary-900">{r.month}</td>{cols.map(([k, , t]) => <td key={k} className={`px-2 py-2 text-right tabular-nums ${t === 'bold' ? 'font-semibold' : ''}`}>{cell(r, k)}</td>)}</tr>)}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold"><td className="sticky left-0 bg-white py-2 pr-3">Total</td>{cols.map(([k]) => <td key={k} className="px-2 py-2 text-right tabular-nums">{m.totals[k] === undefined ? '' : <Money v={m.totals[k]} signed={k === 'net_result'} />}</td>)}</tr>
                </tfoot>
              </table>
            )}
          </section>
        )
      ) : !data ? <div className="py-8 text-center text-sm text-tertiary-500">{busy ? 'Loading...' : 'No data.'}</div> : (
        <section className={`${card} overflow-x-auto ${busy ? 'opacity-60' : ''}`}>
          <h2 className="mb-3 font-heading text-lg font-semibold text-tertiary-900">{data.title}</h2>
          {data.rows.length === 0 ? <Empty>Nothing matches these filters.</Empty> : (
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-left text-xs text-tertiary-500"><tr>{data.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i} className="border-t">{r.map((v, j) => <td key={j} className={`px-3 py-2 ${typeof v === 'number' ? 'text-right tabular-nums' : ''}`}>{typeof v === 'number' ? (/%/.test(data.columns[j]) ? `${v}%` : inr(v)) : v === '' || v === null ? '-' : v}</td>)}</tr>)}</tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
