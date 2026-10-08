import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PeriodPicker, { currentPeriod, periodLabel } from '../../components/finance/PeriodPicker.jsx';
import { cleanParams } from '../analytics/AttendanceSalaryTab.jsx';

const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BASIS = { timesheet: 'Timesheet hours', attendance: 'Attendance' };

/**
 * What each person would be paid under each basis for a month, side by side, and the
 * switch. "Attendance" pays from the check-in / half day / absent marking and approved
 * leave (project timesheets then only feed client billing); "Timesheet hours" is the
 * original rule. Compare first - an unmarked working day is unpaid under attendance.
 */
export default function PayBasisTab({ people }) {
  const { pushError, pushSuccess } = useAlerts();
  const [period, setPeriod] = useState(() => {
    // Default to last month: a month that is over has complete markings to compare.
    const now = currentPeriod();
    return now.period_month === 1 ? { period_month: 12, period_year: now.period_year - 1 } : { period_month: now.period_month - 1, period_year: now.period_year };
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    apiClient.get('/payroll/pay-basis', { params: { ...period, ...cleanParams(people || {}) } })
      .then(({ data: res }) => setData(res.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the comparison'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [period.period_month, period.period_year, JSON.stringify(people)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setBasis(body, what) {
    const reason = window.prompt(`${what}\nGive a reason (required):`);
    if (reason === null) return;
    if (reason.trim().length < 3) { pushError('A reason of at least 3 characters is required', 'Not changed'); return; }
    setBusy(true);
    try {
      const { data: res } = await apiClient.post('/payroll/pay-basis', { ...body, reason: reason.trim() });
      pushSuccess(`${res.data.changed} of ${res.data.considered} switched to ${BASIS[body.pay_basis]}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to change the pay basis'), 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'name', header: 'Employee', render: (r) => <span className="font-medium text-tertiary-900">{r.name}<span className="block text-xs text-tertiary-500">{[r.employee_code, r.department].filter(Boolean).join(' · ')}</span></span> },
    { key: 'basis', header: 'Paid from', render: (r) => <Badge value={r.current_basis === 'attendance' ? 'approved' : 'pending'} label={BASIS[r.current_basis]} /> },
    { key: 'ts', header: 'Timesheet hours', render: (r) => <span className="tabular-nums">{money(r.timesheet_net)}<span className="block text-xs text-tertiary-500">{r.timesheet.approved_hours}h approved · {r.timesheet.deficit_hours}h short</span></span> },
    { key: 'att', header: 'Attendance', render: (r) => <span className="tabular-nums">{money(r.attendance_net)}<span className="block text-xs text-tertiary-500">{r.attendance.present_days} present · {r.attendance.half_days} half · {r.attendance.absent_days} absent{r.attendance.unmarked_days ? <span className="font-medium text-danger-700"> · {r.attendance.unmarked_days} unmarked</span> : ''}</span></span> },
    { key: 'diff', header: 'Attendance − Timesheet', render: (r) => <span className={`tabular-nums font-medium ${r.difference < 0 ? 'text-danger-700' : r.difference > 0 ? 'text-success-700' : ''}`}>{r.difference > 0 ? '+' : ''}{money(r.difference)}</span> },
    {
      key: 'action',
      header: '',
      render: (r) => (r.current_basis === 'attendance'
        ? <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => setBasis({ pay_basis: 'timesheet', org_membership_ids: [r.org_membership_id] }, `Pay ${r.name} from timesheet hours again?`)}>Use timesheet</button>
        : <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => setBasis({ pay_basis: 'attendance', org_membership_ids: [r.org_membership_id] }, `Pay ${r.name} from attendance?`)}>Use attendance</button>),
    },
  ];

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker value={period} onChange={(p) => setPeriod({ period_month: p.period_month, period_year: p.period_year })} label="Compare month" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => setBasis({ pay_basis: 'attendance', it_department: true }, 'Pay everyone in the IT department from attendance?')}>Switch IT to attendance</button>
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => setBasis({ pay_basis: 'timesheet', it_department: true }, 'Pay everyone in the IT department from timesheet hours again?')}>Switch IT back to timesheet</button>
        </div>
      </div>
      <p className="text-xs text-tertiary-500">
        Salary for {periodLabel(period)} under each basis. <strong>Attendance</strong> pays the shift for a day marked present / WFH, half for a half day, nothing for absent; approved leave pays or not by its type.
        A working day with no marking and no leave is <strong>unmarked</strong>: unpaid, and it blocks locking that person&apos;s salary until it is marked. Project timesheets then only feed client billing.
        Locked months keep their locked figures; the switch affects live and later calculations.
      </p>
      {t && (
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-xl border border-tertiary-100 bg-white p-3"><span className="text-xs text-tertiary-500">People</span><p className="font-semibold">{t.employees} <span className="text-xs font-normal text-tertiary-500">({t.on_attendance} on attendance)</span></p></div>
          <div className="rounded-xl border border-tertiary-100 bg-white p-3"><span className="text-xs text-tertiary-500">Total (timesheet basis)</span><p className="font-semibold tabular-nums">{money(t.timesheet_net)}</p></div>
          <div className="rounded-xl border border-tertiary-100 bg-white p-3"><span className="text-xs text-tertiary-500">Total (attendance basis)</span><p className="font-semibold tabular-nums">{money(t.attendance_net)}</p></div>
          <div className={`rounded-xl border p-3 ${t.unmarked_days ? 'border-danger-200 bg-danger-50' : 'border-tertiary-100 bg-white'}`}><span className="text-xs text-tertiary-500">Unmarked working days</span><p className="font-semibold">{t.unmarked_days}</p></div>
        </div>
      )}
      <DataTable columns={columns} rows={(data?.rows || []).map((r) => ({ ...r, id: r.org_membership_id }))} loading={loading} emptyLabel="No employees with a salary structure for this month" />
    </div>
  );
}
