import { useMemo, useState } from 'react';
import { Building2, IndianRupee, Truck, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useVendorAccountOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import StatusBadge from '../../components/finance/StatusBadge.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import CalculationLockBar, { inr } from '../../components/finance/CalculationLockBar.jsx';
import { cleanParams } from './AttendanceSalaryTab.jsx';

/**
 * Live Analytics → Vendors: what each vendor is owed for its contractors'
 * APPROVED timesheets — the contractor's monthly vendor rate spread over the
 * project calendar's working days (same structure as billing and salary),
 * plus overtime where the project allows it. Locking the month creates the
 * vendor payments below (pending), one per vendor.
 */
export default function VendorPaymentsTab() {
  const [period, setPeriod] = useState(currentPeriod());
  const [vendorId, setVendorId] = useState('');
  const vendorOptions = useVendorAccountOptions(true);
  const params = useMemo(() => cleanParams({ ...period, vendor_account_id: vendorId }), [period, vendorId]);
  const { data, loading, refresh } = useLiveData(() => apiClient.get('/analytics/vendor-payments', { params }).then((r) => r.data.data), { deps: [JSON.stringify(params)], intervalMs: 60000 });
  const records = useLiveData(() => apiClient.get('/analytics/vendor-payments/records', { params: period }).then((r) => r.data.data), { deps: [period.period_month, period.period_year] });

  const lineCols = [
    { key: 'vendor', header: 'Vendor', render: (l) => l.vendor?.name || 'No vendor set' },
    { key: 'contractor', header: 'Contractor', render: (l) => <span className="font-medium text-tertiary-900">{l.contractor}</span> },
    { key: 'project', header: 'Project', render: (l) => <span>{l.project.name}<span className="block text-xs text-tertiary-500">{l.project.code}</span></span> },
    { key: 'rate', header: 'Rate × allocation', render: (l) => <span className="text-xs">{inr(l.monthly_vendor_rate, l.currency)}/mo × {l.allocation_percent}% · {l.working_days} WD</span> },
    { key: 'hours', header: 'Approved hours', render: (l) => `${l.approved_hours}h${l.overtime_hours ? ` + ${l.overtime_hours} OT` : ''}` },
    { key: 'amount', header: 'Amount', render: (l) => <span className="font-medium tabular-nums">{inr(l.amount, l.currency)}{l.currency !== 'INR' ? <span className="block text-xs text-tertiary-500">{inr(l.amount_inr)}</span> : null}</span> },
    { key: 'approval', header: 'Approval', render: (l) => (
      <span>
        <StatusBadge status={l.approval_status} size="xs" />
        {l.last_approved_by && <span className="block text-[11px] text-tertiary-500">by {l.last_approved_by.name}{l.last_approved_at ? `, ${new Date(l.last_approved_at).toLocaleString()}` : ''}</span>}
      </span>
    ) },
  ];
  const vendorCols = [
    { key: 'vendor', header: 'Vendor', render: (v) => <span className="font-medium text-tertiary-900">{v.vendor?.name || 'No vendor set'}</span> },
    { key: 'contractors', header: 'Contractors', render: (v) => v.contractors.join(', ') },
    { key: 'amount', header: 'Amount (INR)', render: (v) => <span className="font-medium tabular-nums">{inr(v.amount_inr)}</span> },
    { key: 'pending', header: 'Unapproved entries', render: (v) => (v.pending_entries || v.rejected_entries ? <StatusBadge status={v.rejected_entries ? 'rejected' : 'pending'} label={`${v.pending_entries} pending · ${v.rejected_entries} rejected`} size="xs" /> : <StatusBadge status="approved" label="All approved" size="xs" />) },
  ];
  const recordCols = [
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_name },
    { key: 'period', header: 'Period', render: (r) => periodLabel(r) },
    { key: 'amount', header: 'Amount', render: (r) => inr(r.amount, r.currency) },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'created', header: 'Generated', render: (r) => new Date(r.created_at).toLocaleString() },
  ];
  const t = data?.totals;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2"><PeriodPicker value={period} onChange={setPeriod} label="Month" /></div>
        <label className="block text-xs font-medium text-tertiary-600">Vendor<div className="mt-1"><SearchableSelect value={vendorId} onChange={setVendorId} options={vendorOptions} placeholder="All vendors" allowClear /></div></label>
      </div>
      <CalculationLockBar kind="vendor_payment" period={period} title="Vendor payments" onChanged={() => { refresh?.(); records.refresh?.(); }} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label={`Owed to vendors · ${periodLabel(period)}`} value={inr(t?.amount_inr)} hint={data?.source === 'locked' ? `locked v${data.locked_version}` : 'live'} icon={IndianRupee} theme="orange" />
        <KpiCard label="Vendors" value={t?.vendors ?? '…'} icon={Building2} theme="blue" />
        <KpiCard label="Contractors" value={t?.contractors ?? '…'} icon={Users} theme="cyan" />
      </div>
      <DataTable columns={vendorCols} rows={(data?.vendors || []).map((v, i) => ({ ...v, id: v.vendor?.id || `none-${i}` }))} loading={loading} emptyLabel="No contractor work in this month" />
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">By contractor and project</h2>
        <DataTable columns={lineCols} rows={(data?.lines || []).map((l) => ({ ...l, id: `${l.org_membership_id}|${l.project.id}` }))} loading={loading} emptyLabel="No contractors assigned to projects" />
      </section>
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Truck className="h-4 w-4" /> Vendor payments generated from locked months</h2>
        <DataTable columns={recordCols} rows={records.data || []} loading={records.loading} emptyLabel="Lock the month to generate its vendor payments" />
      </section>
    </div>
  );
}
