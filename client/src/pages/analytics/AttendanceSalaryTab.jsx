import { useMemo, useState } from 'react';
import { Banknote, CalendarCheck, TrendingDown, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useDepartmentOptions, useOrgMembershipOptions, useTeamOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import CalculationLockBar, { inr } from '../../components/finance/CalculationLockBar.jsx';

/** Employee / Department / Team filters — combinable (Payroll + Live Analytics). */
export function PeopleFilters({ value, onChange }) {
  const members = useOrgMembershipOptions(true);
  const departments = useDepartmentOptions(true);
  const teams = useTeamOptions(true);
  const set = (key, v) => onChange({ ...value, [key]: v });
  return (
    <>
      <label className="block text-xs font-medium text-tertiary-600">Employee<div className="mt-1"><SearchableSelect value={value.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={members} placeholder="All employees" allowClear /></div></label>
      <label className="block text-xs font-medium text-tertiary-600">Department<div className="mt-1"><SearchableSelect value={value.department_id} onChange={(v) => set('department_id', v)} options={departments} placeholder="All departments" allowClear /></div></label>
      <label className="block text-xs font-medium text-tertiary-600">Team<div className="mt-1"><SearchableSelect value={value.team_id} onChange={(v) => set('team_id', v)} options={teams} placeholder="All teams" allowClear /></div></label>
    </>
  );
}

export const EMPTY_PEOPLE_FILTERS = { org_membership_id: '', department_id: '', team_id: '' };

export function cleanParams(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== 'all'));
}

/**
 * Salary from APPROVED timesheet hours (never check-in / check-out): each
 * employee's monthly CTC over their expected hours (company working days ×
 * shift), paid for approved hours up to the shift each day (paid leave = a
 * full day) plus approved overtime. Actual uses approved records only;
 * Projected adds pending hours / overtime. Locking freezes the month; the
 * payroll run then uses the locked figures.
 */
export default function AttendanceSalaryTab({ showLock = true, people: externalPeople = null, endpoint = '/analytics/salary-attendance' }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [ownPeople, setPeople] = useState(EMPTY_PEOPLE_FILTERS);
  // Payroll passes its page-level Employee / Department / Team filters in.
  const people = externalPeople || ownPeople;
  const params = useMemo(() => cleanParams({ ...period, ...people }), [period, people]);
  const { data, loading, refresh } = useLiveData(() => apiClient.get(endpoint, { params }).then((r) => r.data.data), { deps: [JSON.stringify(params)], intervalMs: 60000 });

  const cols = [
    { key: 'name', header: 'Employee', render: (r) => <span><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{[r.employee_code, r.department, r.team].filter(Boolean).join(' · ')}</span></span> },
    { key: 'calendar', header: 'Calendar', render: (r) => <span className="text-xs">{r.calendar || '—'}</span> },
    { key: 'wd', header: 'Working days', render: (r) => `${r.breakdown.working_days} × ${r.breakdown.shift_hours ?? 9}h` },
    { key: 'expected', header: 'Expected', render: (r) => `${r.breakdown.expected_hours ?? '—'}h` },
    { key: 'approved', header: 'Approved', render: (r) => <span className="text-success-700">{r.breakdown.paid_hours ?? '—'}h</span> },
    { key: 'pending', header: 'Pending', render: (r) => (r.breakdown.pending_hours ? <span className="text-warning-700">{r.breakdown.pending_hours}h</span> : '—') },
    { key: 'short', header: 'Short', render: (r) => (r.breakdown.deficit_hours ? <span className="font-medium text-orange-700">{r.breakdown.deficit_hours}h</span> : '—') },
    { key: 'ot', header: 'OT approved', render: (r) => (r.breakdown.ot_approved_hours ? <span className="text-purple-700">{r.breakdown.ot_approved_hours}h · {inr(r.breakdown.ot_amount)}</span> : '—') },
    { key: 'ctc', header: 'Monthly CTC', render: (r) => <span className="tabular-nums">{inr(r.ctc)}</span> },
    { key: 'rate', header: 'Per hour', render: (r) => <span className="tabular-nums">{inr(r.breakdown.hourly_rate)}</span> },
    { key: 'earned', header: 'Incurred to date', render: (r) => <span className="font-medium tabular-nums">{inr(r.earned_to_date)}</span> },
    { key: 'net', header: 'Actual (approved)', render: (r) => <span className="font-medium tabular-nums">{inr(r.net)}</span> },
    { key: 'projected', header: 'Projected (+ pending)', render: (r) => <span className="tabular-nums text-tertiary-500">{inr(r.projected_net ?? r.net)}</span> },
  ];

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2"><PeriodPicker value={period} onChange={setPeriod} label="Month" /></div>
        {!externalPeople && <PeopleFilters value={people} onChange={setPeople} />}
      </div>
      {showLock && <CalculationLockBar kind="salary" period={period} title="Salary" onChanged={() => refresh?.()} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={`Incurred to date · ${periodLabel(period)}`} value={inr(t?.earned_to_date)} hint={data?.as_of ? `as of ${data.as_of}` : data?.source === 'locked' ? `locked v${data.locked_version}` : 'whole month'} icon={Banknote} theme="purple" />
        <KpiCard label="Actual payroll (approved)" value={inr(t?.net)} hint={`OT ${inr(t?.ot_amount)} · days to come counted as worked`} icon={CalendarCheck} theme="blue" />
        <KpiCard label="Projected payroll" value={inr(t?.projected_net ?? t?.net)} hint={`+ ${inr(t?.pending_amount)} pending approval`} icon={TrendingDown} theme="orange" />
        <KpiCard label="Short-hours deductions" value={inr(t?.deductions)} icon={TrendingDown} theme="red" />
        <KpiCard label="Employees" value={t?.employees ?? '…'} hint={data?.skipped?.length ? `${data.skipped.length} skipped (no structure / contractor)` : undefined} icon={Users} theme="cyan" />
      </div>
      <DataTable columns={cols} rows={(data?.lines || []).map((l) => ({ ...l, id: l.org_membership_id }))} loading={loading} emptyLabel="No employees with a salary structure match these filters" />
      <p className="text-xs text-tertiary-500">Per hour = monthly CTC ÷ expected hours (working days of the employee&apos;s company calendar × shift). Actual pays approved timesheet hours (up to the shift per day; paid leave = a full day) plus approved overtime — pending hours and pending OT appear only in Projected; check-in / check-out never counts. Weekends and holidays are paid non-working days. Contractors are paid through their vendor (see Vendors), never payroll.</p>
    </div>
  );
}
