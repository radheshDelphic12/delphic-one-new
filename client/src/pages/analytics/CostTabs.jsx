import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Building2, Receipt, Truck } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { CHART_COLORS, chartTooltipStyle } from '../../lib/chartTheme.js';
import { compact, money, shortMonth, titleCase } from '../../lib/format.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import { LiveIndicator } from './LiveSalesTab.jsx';

const POLL_MS = 60000;

function MonthsSelect({ value, onChange }) {
  return (
    <label className="text-xs font-medium text-tertiary-600">
      Months
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="ml-2 rounded-xl border px-2 py-1 text-sm">
        {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  );
}

export function SalaryTab() {
  const [months, setMonths] = useState(6);
  const { data, loading, updatedAt } = useLiveData(() => apiClient.get('/analytics/salary', { params: { months } }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [months] });

  const employeeCols = [
    { key: 'name', header: 'Employee', render: (r) => <Link className="font-medium text-primary-700 hover:underline" to={`/people/${r.membership_id}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link> },
    { key: 'department', header: 'Department', render: (r) => r.department || '-' },
    { key: 'monthly_ctc', header: 'Monthly CTC', render: (r) => money(r.monthly_ctc) },
    { key: 'accrued_cost', header: `Accrued (last ${months} mo)`, render: (r) => money(r.accrued_cost) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3"><LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} /><MonthsSelect value={months} onChange={setMonths} /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Monthly salary bill (CTC)" value={money(data?.total_monthly_ctc)} icon={Banknote} theme="purple" />
        <KpiCard label="Employees on payroll" value={data?.employees.length ?? 0} icon={Building2} theme="blue" to="/payroll" />
        <KpiCard label="Departments" value={data?.by_department.length ?? 0} icon={Building2} theme="cyan" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Salary cost by month" subtitle="Nightly accrual: monthly CTC prorated per day">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={(data?.series || []).map((s) => ({ ...s, label: shortMonth(s.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
                <Line type="monotone" dataKey="cost" name="Salary cost" stroke={CHART_COLORS.purple} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Monthly CTC by department">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.by_department || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
                <Bar dataKey="monthly_ctc" name="Monthly CTC" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
      <DataTable columns={employeeCols} rows={(data?.employees || []).map((e) => ({ ...e, id: e.membership_id }))} loading={loading} emptyLabel="No salary structures yet" />
    </div>
  );
}

export function ExpensesTab() {
  const [months, setMonths] = useState(6);
  const { data, loading, updatedAt } = useLiveData(() => apiClient.get('/analytics/expenses', { params: { months } }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [months] });

  const listCols = (label, key) => [
    { key, header: label, render: (r) => titleCase(r[key]) },
    { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3"><LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} /><MonthsSelect value={months} onChange={setMonths} /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label={`Total spend (${months} mo)`} value={money(data?.total)} icon={Receipt} theme="red" to="/finance?section=expenses" />
        <KpiCard label="Top category" value={titleCase(data?.by_category[0]?.category) || '-'} hint={data?.by_category[0] ? money(data.by_category[0].amount) : undefined} icon={Receipt} theme="orange" />
        <KpiCard label="Top office" value={data?.by_location[0]?.location || '-'} hint={data?.by_location[0] ? money(data.by_location[0].amount) : undefined} icon={Building2} theme="cyan" />
      </div>
      <ChartCard title="Office expenses and vendor payments by month" subtitle="Approved / reimbursed claims and approved / paid vendor payments">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(data?.series || []).map((s) => ({ ...s, label: shortMonth(s.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => money(v)} />
              <Legend />
              <Bar dataKey="office_expenses" name="Office expenses" stackId="a" fill={CHART_COLORS.warning} />
              <Bar dataKey="vendor_payments" name="Vendor payments" stackId="a" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-3">
        <DataTable columns={listCols('Category', 'category')} rows={(data?.by_category || []).map((r) => ({ ...r, id: r.category }))} loading={loading} emptyLabel="No approved claims" />
        <DataTable columns={listCols('Office', 'location')} rows={(data?.by_location || []).map((r) => ({ ...r, id: r.location }))} loading={loading} emptyLabel="No approved claims" />
        <DataTable columns={listCols('Vendor type', 'vendor_type')} rows={(data?.by_vendor_type || []).map((r) => ({ ...r, id: r.vendor_type }))} loading={loading} emptyLabel="No vendor payments" />
      </div>
      <p className="text-xs text-tertiary-500">To act on a claim, open <Link className="text-primary-700 hover:underline" to="/finance?section=expenses">Finance - Expenses</Link>.</p>
    </div>
  );
}

export function VendorsTab() {
  const { data, loading, updatedAt } = useLiveData(() => apiClient.get('/analytics/vendors').then((r) => r.data.data), { intervalMs: POLL_MS });
  const cols = [
    { key: 'vendor_name', header: 'Vendor', render: (r) => <span className="font-medium text-tertiary-900">{r.vendor_name}</span> },
    { key: 'vendor_type', header: 'Type', render: (r) => titleCase(r.vendor_type) },
    { key: 'payments', header: 'Payments' },
    { key: 'paid', header: 'Paid', render: (r) => money(r.paid) },
    { key: 'approved_unpaid', header: 'Approved, unpaid', render: (r) => money(r.approved_unpaid) },
    { key: 'pending', header: 'Pending approval', render: (r) => money(r.pending) },
    { key: 'outstanding', header: 'Outstanding', render: (r) => <span className={r.outstanding ? 'font-medium text-amber-700' : ''}>{money(r.outstanding)}</span> },
    { key: 'last_period', header: 'Last period' },
  ];
  return (
    <div className="space-y-4">
      <LiveIndicator updatedAt={updatedAt} everyMs={POLL_MS} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Paid to vendors" value={money(data?.totals.paid)} icon={Truck} theme="green" />
        <KpiCard label="Outstanding to vendors" value={money(data?.totals.outstanding)} icon={Truck} theme="orange" />
        <KpiCard label="Vendors" value={data?.vendors.length ?? 0} icon={Building2} theme="blue" />
      </div>
      <DataTable columns={cols} rows={(data?.vendors || []).map((v) => ({ ...v, id: `${v.vendor_name}|${v.vendor_type}` }))} loading={loading} emptyLabel="No vendor payments recorded" />
    </div>
  );
}
