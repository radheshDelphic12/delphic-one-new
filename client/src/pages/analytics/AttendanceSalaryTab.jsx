import { useMemo, useState } from 'react';
import { Banknote, CalendarCheck, TrendingDown, Users } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useDepartmentOptions, useOrgMembershipOptions, useTeamOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { inr } from '../../components/finance/CalculationLockBar.jsx';
import RecordLockButton from '../../components/finance/RecordLockButton.jsx';

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
 * Salary from attendance on each person's company calendar. A present or
 * work-from-home day pays the shift, a half day pays half, and approved paid
 * leave pays by its type. Absent, unmarked, and unpaid leave pay nothing.
 * Project timesheets are not part of this figure. Each employee is locked on
 * their own (Unlocked → Locked): a locked employee shows their locked figures,
 * moves to Live Analytics → Locked, and the payroll run pays exactly that.
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
    { key: 'present', header: 'Present', render: (r) => Math.max(0, (r.breakdown.present_days || 0) - (r.breakdown.half_days || 0)) || '—' },
    { key: 'half', header: 'Half day', render: (r) => r.breakdown.half_days || '—' },
    { key: 'leave', header: 'Paid leave', render: (r) => r.breakdown.paid_leave_days || '—' },
    { key: 'absent', header: 'Absent', render: (r) => r.breakdown.absent_days || '—' },
    { key: 'unmarked', header: 'Unmarked', render: (r) => (r.breakdown.unmarked_days ? <span className="font-medium text-danger-700">{r.breakdown.unmarked_days}</span> : '—') },
    { key: 'unpaid', header: 'Unpaid hours', render: (r) => (r.breakdown.deficit_hours ? <span className="font-medium text-orange-700" title="Absent, unmarked, or unpaid leave. Not missing project hours.">{r.breakdown.deficit_hours}h</span> : '—') },
    { key: 'ot', header: 'OT tickets', render: (r) => (r.breakdown.ot_approved_hours ? <span className="text-purple-700">{r.breakdown.ot_approved_hours}h · {inr(r.breakdown.ot_amount)}</span> : '—') },
    { key: 'ctc', header: 'Monthly CTC', render: (r) => <span className="tabular-nums">{inr(r.ctc)}</span> },
    { key: 'rate', header: 'Per hour', render: (r) => <span className="tabular-nums">{inr(r.breakdown.hourly_rate)}</span> },
    { key: 'earned', header: 'Incurred to date', render: (r) => <span className="font-medium tabular-nums">{inr(r.earned_to_date)}</span> },
    { key: 'net', header: 'Net pay', render: (r) => <span className="font-medium tabular-nums">{inr(r.net)}</span> },
    { key: 'projected', header: 'With pending OT', render: (r) => <span className="tabular-nums text-tertiary-500">{inr(r.projected_net ?? r.net)}</span> },
    ...(showLock ? [{ key: 'lock', header: 'Lock', render: (r) => <RecordLockButton kind="salary_employee" scopeKey={r.org_membership_id} period={period} lock={r.lock} label={`${r.name} salary`} onChanged={() => refresh?.()} /> }] : []),
  ];

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2"><PeriodPicker value={period} onChange={setPeriod} label="Month" /></div>
        {!externalPeople && <PeopleFilters value={people} onChange={setPeople} />}
      </div>
      {showLock && <p className="text-xs text-tertiary-500">Lock each employee&apos;s salary once it is final (after the month ends). Locked salaries move to Live Analytics → Locked, count in Financials, and are what the payroll run pays. {t?.locked ? `${t.locked} of ${t.employees} locked.` : ''}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label={`Incurred to date · ${periodLabel(period)}`} value={inr(t?.earned_to_date)} hint={data?.as_of ? `as of ${data.as_of}` : data?.source === 'locked' ? `locked v${data.locked_version}` : 'whole month'} icon={Banknote} theme="purple" />
        <KpiCard label="Net pay" value={inr(t?.net)} hint={`Overtime ${inr(t?.ot_amount)}. Days still to come are not unpaid yet.`} icon={CalendarCheck} theme="blue" />
        <KpiCard label="With pending overtime" value={inr(t?.projected_net ?? t?.net)} hint={`+ ${inr(t?.pending_amount)} if pending overtime tickets are approved`} icon={TrendingDown} theme="orange" />
        <KpiCard label="Loss of pay" value={inr(t?.deductions)} hint="Absent, unmarked, or unpaid leave" icon={TrendingDown} theme="red" />
        <KpiCard label="Employees" value={t?.employees ?? '…'} hint={data?.skipped?.length ? `${data.skipped.length} skipped (no structure / contractor)` : undefined} icon={Users} theme="cyan" />
      </div>
      <DataTable columns={cols} rows={(data?.lines || []).map((l) => ({ ...l, id: l.org_membership_id }))} loading={loading} emptyLabel="No employees with a salary structure match these filters" />
      <p className="text-xs text-tertiary-500">In-house salary comes from attendance, approved leave, approved overtime, and salary adjustments. A present or paid leave day pays a full day, a half day pays half, and unpaid leave or an absence pays nothing. Project hours are for billing and team visibility. Contractor and vendor pay comes from their project timesheet, not this payroll.</p>
    </div>
  );
}
