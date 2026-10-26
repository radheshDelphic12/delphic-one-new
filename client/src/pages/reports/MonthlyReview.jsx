import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { ExcelIcon, PdfIcon } from '../../components/ui/ExportIcons.jsx';
import { formatReportDate } from './reportViews.js';

const field = 'rounded-lg border border-tertiary-200 bg-white px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none';
const label = 'block text-xs font-medium text-tertiary-600';
const FUNCTION_LABEL = { sales: 'Sales', hr: 'HR', it: 'IT', other: 'Other' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthTitle = (m) => `${MONTH_NAMES[m.month - 1]} ${m.year}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** A count that opens the records behind it. */
function CountButton({ value, onClick, title }) {
  return (
    <button type="button" title={title} onClick={onClick} className="min-w-[2rem] rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums text-primary-700 hover:bg-primary-50 hover:underline">
      {value}
    </button>
  );
}

function MonthRow({ person, m, open }) {
  const attendance = (key) => open({ person, m, metric: 'attendance', title: key });
  return (
    <tr className="border-t border-tertiary-100 align-top" data-testid="review-month-row">
      <td className="whitespace-nowrap px-3 py-2 font-medium text-tertiary-900">{monthTitle(m)}</td>
      {m.no_data ? (
        <td colSpan={4} className="px-3 py-2"><Pill tone="amber">Data not available</Pill> <span className="text-xs text-tertiary-500">No attendance was recorded for this month ({m.working_days} working days).</span></td>
      ) : (
        <>
          <td className="px-3 py-2 text-center"><CountButton value={m.working_days} title="Working days (holidays and weekly offs left out)" onClick={() => attendance('Working days')} /></td>
          <td className="px-3 py-2 text-center"><CountButton value={m.present} title="Present days (approved)" onClick={() => attendance('Present days')} /></td>
          <td className="px-3 py-2 text-center"><CountButton value={m.leave} title="Leave days" onClick={() => attendance('Leave days')} /></td>
          <td className="px-3 py-2 text-center"><CountButton value={m.absent} title="Absent days" onClick={() => attendance('Absent days')} /></td>
        </>
      )}
      <td className="px-3 py-2">
        {m.metrics.length === 0 ? <span className="text-xs text-tertiary-400">—</span> : (
          <div className="flex flex-wrap gap-1.5">
            {m.metrics.map((x) => (
              <button
                key={x.key}
                type="button"
                data-testid={`metric-${x.key}`}
                onClick={() => open({ person, m, metric: x.key, title: x.label })}
                className="inline-flex items-center gap-1.5 rounded-full border border-tertiary-200 bg-white px-2.5 py-1 text-xs text-tertiary-700 hover:border-primary-300 hover:bg-primary-50"
              >
                {x.label}<b className="tabular-nums text-primary-700">{x.count}</b>
              </button>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function PersonCard({ person, open }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card" data-testid="review-person">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary-100 bg-tertiary-50 px-4 py-3">
        <div>
          <p className="font-semibold text-tertiary-900">{person.name} <span className="ml-1 text-xs font-normal text-tertiary-500">{person.employee_code || 'No code'}</span></p>
          <p className="text-xs text-tertiary-500">{[person.team || 'No team', person.department].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary-600">
          <Pill tone="blue">{FUNCTION_LABEL[person.function]}</Pill>
          <span>Joined <b>{formatReportDate(person.joined_at)}</b></span>
          {person.last_working_day && <Pill tone={person.status === 'exited' ? 'red' : 'amber'}>LWD {formatReportDate(person.last_working_day)}</Pill>}
        </div>
      </header>
      {person.months.length === 0 ? (
        <p className="px-4 py-4 text-sm text-tertiary-500">No months fall in the chosen range for this person.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-3 py-2 font-medium">Month</th><th className="px-3 text-center font-medium">Working days</th><th className="px-3 text-center font-medium">Present</th><th className="px-3 text-center font-medium">Leave</th><th className="px-3 text-center font-medium">Absent</th><th className="px-3 font-medium">Performance</th></tr>
            </thead>
            <tbody>{person.months.map((m) => <MonthRow key={m.key} person={person} m={m} open={open} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Reports > Monthly performance review: every employee, month by month since they joined, with the counts of their function. */
export default function MonthlyReview() {
  const { pushError } = useAlerts();
  const [filters, setFilters] = useState({ from_month: '', to_month: thisMonth(), function: 'all', team_id: '', status: 'current', search: '', include_billable: true, include_non_billable: false });
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState(null);
  const [exporting, setExporting] = useState(false);

  const set = (k) => (e) => { setPage(1); setFilters((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); };

  const filterParams = useCallback(() => {
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (params[k] === '') delete params[k]; });
    params.include_billable = filters.include_billable ? '1' : '0';
    params.include_non_billable = filters.include_non_billable ? '1' : '0';
    return params;
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filterParams(), page, limit: 10 };
      const res = await apiClient.get('/reports/monthly-review', { params });
      setData(res.data.data);
    } catch (err) {
      setData(null);
      pushError(apiErrorMessage(err, 'Could not load the monthly review'), 'Something went wrong');
    } finally { setLoading(false); }
  }, [filterParams, page, pushError]);
  useEffect(() => { load(); }, [load]);

  async function exportReview(type) {
    setExporting(true);
    try {
      const res = await apiClient.get('/reports/monthly-review/export', { params: { ...filterParams(), type }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monthly-performance-review.${type}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not export the review'), 'Export failed');
    } finally { setExporting(false); }
  }

  async function open({ person, m, metric, title }) {
    setDrill({ person, m, title, loading: true, items: [] });
    try {
      const params = { org_membership_id: person.org_membership_id, metric, year: m.year, month: m.month, include_billable: filters.include_billable ? '1' : '0', include_non_billable: filters.include_non_billable ? '1' : '0' };
      const res = await apiClient.get('/reports/monthly-review/details', { params });
      const KINDS = { 'Working days': ['present', 'half_day', 'leave', 'absent', 'planned'], 'Present days': ['present', 'half_day'], 'Leave days': ['leave'], 'Absent days': ['absent'] };
      const keep = metric === 'attendance' ? KINDS[title] : null;
      const items = keep ? res.data.data.items.filter((it) => keep.includes(it.kind)) : res.data.data.items;
      setDrill({ person, m, title, loading: false, items, summary: res.data.data.summary });
    } catch (err) {
      setDrill(null);
      pushError(apiErrorMessage(err, 'Could not load the details'), 'Something went wrong');
    }
  }

  const showBillingFilter = filters.function === 'all' || filters.function === 'it';
  return (
    <div className="space-y-4" data-testid="monthly-review">
      <div className="flex justify-end gap-2">
        <button type="button" disabled={exporting} onClick={() => exportReview('xlsx')} aria-label="Export Excel" className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-2 text-sm font-medium text-tertiary-700 shadow-soft hover:bg-tertiary-50"><ExcelIcon />Excel</button>
        <button type="button" disabled={exporting} onClick={() => exportReview('pdf')} aria-label="Export PDF" className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-2 text-sm font-medium text-tertiary-700 shadow-soft hover:bg-tertiary-50"><PdfIcon />PDF</button>
      </div>
      <section className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <label className={label}>From month<input type="month" className={`${field} mt-1 w-full`} value={filters.from_month} onChange={set('from_month')} /><span className="text-[11px] font-normal text-tertiary-400">Empty = from each person&apos;s joining month</span></label>
        <label className={label}>To month<input type="month" className={`${field} mt-1 w-full`} value={filters.to_month} onChange={set('to_month')} /></label>
        <label className={label}>Function
          <select className={`${field} mt-1 w-full`} value={filters.function} onChange={set('function')}>
            <option value="all">All</option>{Object.entries(FUNCTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className={label}>Team
          <select className={`${field} mt-1 w-full`} value={filters.team_id} onChange={set('team_id')}>
            <option value="">All teams</option>{(data?.teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className={label}>Status
          <select className={`${field} mt-1 w-full`} value={filters.status} onChange={set('status')}>
            <option value="current">Current (incl. on notice)</option><option value="active">Active</option><option value="notice_period">Serving notice</option><option value="exited">Exited</option><option value="all">All</option>
          </select>
        </label>
        <form className="sm:col-span-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setFilters((f) => ({ ...f, search: searchText.trim() })); }}>
          <span className={label}>Search name or employee code</span>
          <div className="mt-1 flex gap-2"><input className={`${field} w-full`} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="e.g. Dheeraj or DLP-014" /><button type="submit" className="btn-secondary px-3 py-1.5 text-sm">Search</button></div>
        </form>
        {showBillingFilter && (
          <fieldset className="flex items-end gap-4 text-sm text-tertiary-700">
            <legend className={label}>IT projects counted</legend>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={filters.include_billable} onChange={set('include_billable')} />Billable</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={filters.include_non_billable} onChange={set('include_non_billable')} />Non-billable</label>
          </fieldset>
        )}
      </section>

      {loading && !data ? <p className="py-8 text-center text-sm text-tertiary-500">Loading the review…</p> : null}
      {data && data.people.length === 0 && <EmptyState title="No employees match" description="Change the function, team, status or search." />}
      <div className={loading && data ? 'space-y-4 opacity-60' : 'space-y-4'}>
        {data?.people.map((p) => <PersonCard key={p.org_membership_id} person={p} open={open} />)}
      </div>

      {data && data.pages > 1 && (
        <nav className="flex items-center justify-between text-sm text-tertiary-600" aria-label="Pages">
          <span>{data.total} employees · page {data.page} of {data.pages}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" />Previous</button>
            <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight className="h-4 w-4" /></button>
          </div>
        </nav>
      )}

      <Drawer open={Boolean(drill)} onClose={() => setDrill(null)} size="md" tone="info" title={drill ? `${drill.title} · ${monthTitle(drill.m)}` : 'Details'}>
        {drill && (
          <div className="space-y-3" data-testid="review-details">
            <p className="text-sm text-tertiary-600"><b>{drill.person.name}</b>{drill.summary ? ` · ${drill.summary.working_days} working days, ${drill.summary.present} present` : ''}</p>
            {drill.loading ? <p className="text-sm text-tertiary-500">Loading…</p> : drill.items.length === 0 ? <p className="text-sm text-tertiary-500">Nothing recorded for this month.</p> : (
              <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
                {drill.items.map((it, i) => (
                  <li key={`${it.date}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0"><p className="font-medium text-tertiary-900">{it.title}</p>{it.sub && <p className="text-xs text-tertiary-500">{it.sub}</p>}</div>
                    <span className="shrink-0 text-xs text-tertiary-500">{formatReportDate(it.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
