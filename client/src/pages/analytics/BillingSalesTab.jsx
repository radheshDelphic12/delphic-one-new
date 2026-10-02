import { useEffect, useMemo, useState } from 'react';
import { Clock, IndianRupee, Lock, Timer } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import { categoryLabel } from '../../lib/projectCategories.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import CalculationLockBar, { inr } from '../../components/finance/CalculationLockBar.jsx';
import RecordLockButton from '../../components/finance/RecordLockButton.jsx';
import { ClientInvoiceDrawer, ClientInvoicesTable, GenerateInvoiceButton } from './ClientInvoices.jsx';
import BillingAdjustmentDrawer from './BillingAdjustmentDrawer.jsx';

const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const hrs = (n) => (n ? `${n}h` : '0');

function Filter({ label, children, className = '' }) {
  return <label className={`block text-xs font-medium text-tertiary-600 ${className}`}>{label}<div className="mt-1">{children}</div></label>;
}

function Approvers({ approvers }) {
  if (!approvers?.length) return <span className="text-tertiary-400">—</span>;
  return (
    <span className="text-xs text-tertiary-600">
      {approvers.map((a) => `${a.name}${a.at ? ` · ${new Date(a.at).toLocaleString()}` : ''}`).join('; ')}
    </span>
  );
}

/** One project's month: date rows with every entry, approver and time, plus its lock and invoice. */
function ProjectMonthDrawer({ row, filters, onClose, onChanged, onInvoice }) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const period = row ? { period_month: row.period_month, period_year: row.period_year } : null;

  function load() {
    if (!row) return;
    apiClient.get(`/analytics/billing/projects/${row.project.id}`, { params: { ...period, ...filters } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the project month'), 'Something went wrong'));
  }
  useEffect(() => { setData(null); load(); }, [row?.id, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    { key: 'date', header: 'Date', render: (d) => <span className={d.is_working_day ? '' : 'text-tertiary-400'}>{dayLabel(d.date)}{d.holiday ? <span className="block text-[11px] text-tertiary-500">{d.holiday}</span> : null}</span> },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} size="xs" /> },
    {
      key: 'entries',
      header: 'Entries (resource · hours · approval)',
      render: (d) => (d.entries.length ? (
        <ul className="space-y-0.5 text-xs">
          {d.entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-tertiary-800">{e.name}</span>
              <span>{e.hours}h{e.overtime_hours ? ` + ${e.overtime_hours}h OT` : ''}</span>
              <StatusBadge status={e.status === 'rejected' && e.resolved ? 'dismissed' : e.status} label={e.status === 'rejected' && e.resolved ? 'Rejected (re-submitted)' : undefined} size="xs" />
              {e.approved_by && <span className="text-tertiary-500">{e.status === 'approved' ? 'approved' : 'decided'} by {e.approved_by.name}{e.approved_at ? ` · ${new Date(e.approved_at).toLocaleString()}` : ''}</span>}
              {e.status === 'rejected' && e.decision_reason && <span className="text-danger-700">“{e.decision_reason}”</span>}
            </li>
          ))}
        </ul>
      ) : <span className="text-tertiary-400">—</span>),
    },
    { key: 'base', header: 'Base', render: (d) => <span className="tabular-nums">{inr(d.base_amount, data?.currency)}</span> },
    { key: 'ot', header: 'Overtime', render: (d) => <span className="tabular-nums">{inr(d.overtime_amount, data?.currency)}</span> },
    { key: 'amount', header: 'Amount', render: (d) => <span className="font-medium tabular-nums">{inr(d.amount, data?.currency)}</span> },
  ];

  // Closed: render nothing from the last project. Its data can still be in
  // state for a render after the row clears, and reading row.project then
  // crashed the whole page.
  if (!row) return <Drawer open={false} title="" onClose={onClose} size="xl" />;

  return (
    <Drawer open title={`${row.project.code ? `${row.project.code} · ` : ''}${row.project.name} — ${periodLabel(row)}`} onClose={onClose} size="xl">
      {!data ? <p className="text-sm text-tertiary-500">Loading…</p> : (
        <div className="space-y-4">
          <CalculationLockBar kind="billing" scopeKey={row.project.id} period={period} title="Billing" onChanged={() => { load(); onChanged(); }}>
            {data.supported && data.billing_type && <GenerateInvoiceButton compact onClick={() => onInvoice({ account_id: row.project.id, ...period })} />}
          </CalculationLockBar>
          <p className="text-xs text-tertiary-500">
            {!data.supported ? data.note : (
              <>
                {data.billing_type === 'monthly'
                  ? `Monthly contract ${inr(data.rate, data.currency)} over this project's ${data.working_days} working days (${data.calendar?.name || 'default calendar'}): every working day inside the agreement bills ${inr(data.rate / Math.max(data.working_days, 1), data.currency)}, whatever hours were logged — a full month bills exactly the rate.`
                  : data.billing_type === 'hourly' ? `Hourly: approved hours × ${inr(data.rate, data.currency)}.` : 'No billing rate set for this project.'}
                {data.minimum && ` Committed minimum ${data.minimum.hours}h/month: ${data.minimum.met ? 'met' : `${data.minimum.shortfall_hours}h short so far`} (billing is still approved hours × rate).`}
                {data.estimate && ` Client estimate: ${data.estimate.hours}h × ${inr(data.rate, data.currency)} = ${inr(data.estimate.amount, data.currency)}; actual so far ${data.estimate.actual_hours}h = ${inr(data.estimate.actual_amount, data.currency)} (${data.estimate.hours_variance >= 0 ? '+' : ''}${data.estimate.hours_variance}h). Forecast only — not billed.`}
                {' '}Overtime is {data.overtime.enabled ? `billed at ${data.overtime.multiplier}× the hourly-equivalent rate (approved overtime only)` : 'not billable on this project'}.
                {data.source === 'locked' && ' Showing the locked version.'}
              </>
            )}
          </p>
          <DataTable columns={columns} rows={data.days.map((d) => ({ ...d, id: d.date }))} emptyLabel="No dates in range" />
        </div>
      )}
    </Drawer>
  );
}

/**
 * Live Analytics → Billing & Sales. What each project/contract bills for the
 * period from its CONTRACT on its own calendar (monthly: the working-day
 * share of the rate; hourly: approved hours × rate), date by date, with
 * approval states and the per-project Generate invoice → Lock workflow.
 * Generated invoices are listed under the invoice area; a locked project
 * month is shown from its locked version.
 */
export default function BillingSalesTab() {
  const [period, setPeriod] = useState({ ...currentPeriod(), period: 'month' });
  const [filters, setFilters] = useState({ project_type: 'all', client_account_id: '', account_id: '', org_membership_id: '', status: 'all', invoice_status: 'all', billing_type: 'all', include_overtime: 'true', date_from: '', date_to: '' });
  const [openRow, setOpenRow] = useState(null);
  const [invoiceFor, setInvoiceFor] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);
  const [invoicesKey, setInvoicesKey] = useState(0);
  const [projects, setProjects] = useState([]);
  const memberOptions = useOrgMembershipOptions(true);

  useEffect(() => {
    apiClient.get('/calendars/projects').then(({ data }) => setProjects(data.data || [])).catch(() => setProjects([]));
  }, []);
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.code ? `${p.name} · ${p.code}` : p.name, hint: p.client_name || undefined }));
  const clientOptions = useMemo(() => {
    const map = new Map();
    for (const p of projects) if (p.client_account_id) map.set(p.client_account_id, p.client_name || 'Client');
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [projects]);

  const params = useMemo(() => {
    const p = { period: period.period, period_month: period.period_month, period_year: period.period_year };
    for (const [k, v] of Object.entries(filters)) if (v && v !== 'all') p[k] = v;
    if (filters.status) p.status = filters.status;
    return p;
  }, [period, filters]);
  const { data, loading, refresh } = useLiveData(() => apiClient.get('/analytics/billing', { params }).then((r) => r.data.data), { deps: [JSON.stringify(params)], intervalMs: 60000 });
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const projectCols = [
    { key: 'project', header: 'Project / contract', render: (r) => (
      <button type="button" className="text-left" onClick={() => setOpenRow(r)}>
        <span className="font-medium text-primary-700 hover:underline">{r.project.name}</span>
        <span className="block text-xs text-tertiary-500">{[r.project.code, r.project.client_name, period.period === 'quarter' ? periodLabel(r) : null].filter(Boolean).join(' · ')}</span>
      </button>
    ) },
    { key: 'type', header: 'Type', render: (r) => (r.supported ? categoryLabel(r.project.service_category) || 'Managed services' : <span className="text-xs text-amber-800" title={r.note}>{categoryLabel(r.project.service_category)} · not enabled</span>) },
    { key: 'billing', header: 'Billing', render: (r) => (r.billing_type ? <span className="text-xs">{r.resource_rates?.length ? 'Mixed - ' : ''}{r.billing_type === 'monthly' ? 'Monthly' : 'Hourly'} {inr(r.rate, r.currency)} · {r.working_days} WD{r.overtime.enabled ? ` · OT ${r.overtime.multiplier}×` : ' · no OT'}</span> : <span className="text-xs text-tertiary-400">Not set</span>) },
    { key: 'hours', header: 'Approved / pending / rejected', render: (r) => <span className="text-xs tabular-nums">{hrs(r.totals.approved_hours)}{r.totals.overtime_hours ? ` +${r.totals.overtime_hours}h OT` : ''} · {hrs(r.totals.pending_hours)} · {hrs(r.totals.rejected_hours)}</span> },
    { key: 'amount', header: 'Amount', render: (r) => (
      <span className="tabular-nums">
        <span className="font-medium">{inr(r.amount, r.currency)}</span>
        {r.adjustment_amount ? <span className="block text-xs text-tertiary-500" title="Admin adjustment included in the final amount">incl. {r.adjustment_amount > 0 ? '+' : ''}{inr(r.adjustment_amount, r.currency)} adjustment</span> : null}
        {r.currency !== 'INR' && r.amount_inr !== null && <span className="block text-xs text-tertiary-500">{inr(r.amount_inr)}</span>}
        {r.live_amount !== null && r.live_amount !== undefined && <span className="block text-xs text-danger-700">Live now {inr(r.live_amount, r.currency)}</span>}
        {r.estimate && (
          <span className="block text-xs text-tertiary-500" title="Client's approximate hours × hourly rate — a forecast, not billed">
            Est. {inr(r.estimate.amount, r.currency)} · {r.estimate.hours}h
          </span>
        )}
        {r.minimum && !r.minimum.met && (
          <span className="block text-xs font-medium text-warning-700" title="Approved hours are below the project's committed minimum">
            {r.minimum.shortfall_hours}h below {r.minimum.hours}h min.
          </span>
        )}
      </span>
    ) },
    { key: 'approval', header: 'Approval', render: (r) => <StatusBadge status={r.totals.rejected_days ? 'rejected' : r.totals.pending_days ? 'pending' : r.totals.approved_days ? 'approved' : 'no_entries'} size="xs" /> },
    { key: 'lock', header: 'Lock', render: (r) => <RecordLockButton kind="billing" scopeKey={r.project.id} period={{ period_month: r.period_month, period_year: r.period_year }} lock={r.lock} label={`${r.project.name} billing`} onChanged={() => refresh?.()} /> },
    { key: 'adjust', header: 'Adjust', render: (r) => (r.supported && r.billing_type ? <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setAdjustFor(r)}>± Adjust</button> : <span className="text-xs text-tertiary-400">—</span>) },
    { key: 'invoice_state', header: 'Invoice status', render: (r) => (r.invoice?.generated ? <span className="text-xs">{r.invoice.number || 'Generated'}<span className="block text-tertiary-500">{r.invoice.sent ? 'Sent' : 'Unsent'} · {r.invoice.paid ? 'Paid' : 'Unpaid'}</span></span> : <span className="text-xs text-tertiary-400">Not generated</span>) },
    { key: 'invoice', header: 'Invoice', render: (r) => (r.supported && r.billing_type ? <GenerateInvoiceButton compact onClick={() => setInvoiceFor({ account_id: r.project.id, period_month: r.period_month, period_year: r.period_year })} /> : <span className="text-xs text-tertiary-400">—</span>) },
  ];

  const dayCols = [
    { key: 'date', header: 'Date', render: (d) => <span className={d.is_working_day ? '' : 'text-tertiary-400'}>{dayLabel(d.date)}{d.holiday ? <span className="block text-[11px]">{d.holiday}</span> : null}</span> },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} size="xs" /> },
    { key: 'approved', header: 'Approved hrs', render: (d) => <span className="tabular-nums">{d.hours.approved}{d.hours.overtime_approved ? ` + ${d.hours.overtime_approved} OT` : ''}</span> },
    { key: 'pending', header: 'Pending', render: (d) => <span className={`tabular-nums ${d.hours.pending ? 'font-medium text-danger-700' : ''}`}>{d.hours.pending}</span> },
    { key: 'rejected', header: 'Rejected', render: (d) => <span className={`tabular-nums ${d.hours.rejected ? 'font-medium text-danger-700' : ''}`}>{d.hours.rejected}</span> },
    { key: 'base', header: 'Base', render: (d) => <span className="tabular-nums">{inr(d.base_inr)}</span> },
    { key: 'ot', header: 'Overtime', render: (d) => <span className="tabular-nums">{inr(d.overtime_inr)}</span> },
    { key: 'amount', header: 'Amount (INR)', render: (d) => <span className="font-medium tabular-nums">{inr(d.amount_inr)}</span> },
    { key: 'approvers', header: 'Approved by', render: (d) => <Approvers approvers={d.approvers} /> },
  ];

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="sm:col-span-2"><PeriodPicker value={period} onChange={setPeriod} allowQuarter /></div>
        <Filter label="Project type">
          <select value={filters.project_type} onChange={(e) => set('project_type', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="all">All types</option>
            <option value="managed_services">Managed services</option>
            <option value="project">Fixed price / project</option>
            <option value="none">Not set</option>
          </select>
        </Filter>
        <Filter label="Client"><SearchableSelect value={filters.client_account_id} onChange={(v) => set('client_account_id', v)} options={clientOptions} placeholder="All clients" allowClear /></Filter>
        <Filter label="Project"><SearchableSelect value={filters.account_id} onChange={(v) => set('account_id', v)} options={projectOptions} placeholder="All projects" allowClear /></Filter>
        <Filter label="Resource"><SearchableSelect value={filters.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={memberOptions} placeholder="All resources" allowClear /></Filter>
        <Filter label="Approval">
          <select value={filters.status} onChange={(e) => set('status', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        </Filter>
        <Filter label="Invoice">
          <select value={filters.invoice_status} onChange={(e) => set('invoice_status', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="generated">Invoice generated</option>
            <option value="not_generated">Invoice not generated</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="sent">Sent</option>
            <option value="unsent">Unsent</option>
          </select>
        </Filter>
        <Filter label="Billing type">
          <select value={filters.billing_type} onChange={(e) => set('billing_type', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="monthly">Monthly</option>
            <option value="hourly">Hourly</option>
            <option value="mixed">Mixed (per resource)</option>
          </select>
        </Filter>
        <Filter label="Overtime">
          <select value={filters.include_overtime} onChange={(e) => set('include_overtime', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="true">Included</option>
            <option value="false">Excluded</option>
          </select>
        </Filter>
        <Filter label="From date"><input type="date" value={filters.date_from} onChange={(e) => set('date_from', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm" /></Filter>
        <Filter label="To date"><input type="date" value={filters.date_to} onChange={(e) => set('date_to', e.target.value)} className="w-full rounded-xl border px-3 py-1.5 text-sm" /></Filter>
      </div>

      <section className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-heading text-sm font-semibold text-tertiary-900">Invoices · {periodLabel(period)}</h2>
            <p className="text-xs text-tertiary-500">Generate a project&apos;s invoice (editable invoice number) — it is built from the project&apos;s contract and billing rate, in the project&apos;s own currency. Generated invoices appear below.</p>
          </div>
          <GenerateInvoiceButton onClick={() => setInvoiceFor({ account_id: filters.account_id || '', period_month: period.period_month, period_year: period.period_year })} />
        </div>
        <ClientInvoicesTable period={period} refreshKey={invoicesKey} onEdit={(inv) => setInvoiceFor({ account_id: inv.client_account_id, period_month: inv.period_month, period_year: inv.period_year, invoice: inv })} />
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={`Billing · ${period.period === 'quarter' ? 'quarter' : periodLabel(period)}`} value={inr(t?.amount_inr)} hint={t?.estimated_projects ? `Estimated (client hours, ${t.estimated_projects} hourly): ${inr(t.estimated_inr)}` : undefined} icon={IndianRupee} theme="green" />
        <KpiCard label="of which overtime" value={inr(t?.overtime_inr)} hint={filters.include_overtime === 'false' ? 'excluded by filter' : 'only projects that pay overtime'} icon={Timer} theme="purple" />
        <KpiCard label="Approved hours" value={t ? `${t.approved_hours}h` : '…'} hint={t?.overtime_hours ? `+ ${t.overtime_hours}h overtime` : undefined} icon={Clock} theme="blue" />
        <KpiCard label="Pending / rejected hours" value={t ? `${t.pending_hours}h / ${t.rejected_hours}h` : '…'} hint="not billed until approved" icon={Clock} theme="red" />
        <KpiCard label="Locked projects" value={t ? `${t.locked_projects} / ${t.projects}` : '…'} icon={Lock} theme="cyan" />
      </div>
      {data?.missing_rates?.length > 0 && <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800">Set the {data.missing_rates.join(', ')} exchange rate (Finance → Projects) — those projects are left out of the INR totals.</p>}

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Projects &amp; contracts <span className="font-normal text-tertiary-500">— generate each project&apos;s invoice, then lock its billing; open one to review its dates</span></h2>
        <DataTable columns={projectCols} rows={data?.projects || []} loading={loading} emptyLabel="No projects match these filters" />
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Date-wise <span className="font-normal text-tertiary-500">— every date of the period; nothing billable shows as zero</span></h2>
        <DataTable columns={dayCols} rows={(data?.days || []).map((d) => ({ ...d, id: d.date }))} loading={loading} emptyLabel="No dates" maxHeight="28rem" />
      </section>

      <ProjectMonthDrawer
        row={openRow}
        filters={{ org_membership_id: filters.org_membership_id || undefined, include_overtime: filters.include_overtime, status: filters.status, date_from: filters.date_from || undefined, date_to: filters.date_to || undefined }}
        onClose={() => setOpenRow(null)}
        onChanged={() => refresh?.()}
        onInvoice={setInvoiceFor}
      />
      <BillingAdjustmentDrawer target={adjustFor} onClose={() => setAdjustFor(null)} onChanged={() => { refresh?.(); setInvoicesKey((k) => k + 1); }} />
      <ClientInvoiceDrawer open={Boolean(invoiceFor)} initial={invoiceFor || {}} onClose={() => setInvoiceFor(null)} onGenerated={() => setInvoicesKey((k) => k + 1)} />
    </div>
  );
}
