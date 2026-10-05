import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, FileText, Pencil, Play, Plus, Printer, SlidersHorizontal, Trash2, Wallet } from 'lucide-react';
import AttendanceSalaryTab, { EMPTY_PEOPLE_FILTERS, PeopleFilters, cleanParams } from '../analytics/AttendanceSalaryTab.jsx';
import SalaryAdjustmentsTab from './SalaryAdjustmentsTab.jsx';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function periodLabel(month, year) {
  return `${MONTHS[month - 1] || month} ${year}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Opens a standalone window with a static, styled payslip and triggers the
 * browser print dialog — "Save as PDF" there is the download action. No
 * server-side PDF generation exists yet (documented plan-doc gap), and
 * printing from a detached window sidesteps the app shell's fixed layout /
 * animated-transform containing blocks entirely, which a same-page
 * @media print rule would otherwise fight with.
 */
// Older payslips were frozen from approved timesheet hours. Current ones are attendance.
function payslipFacts(b, moneyValue) {
  if (b.source === 'approved_timesheets') {
    return [
      ['Working days', b.working_days],
      ['Expected hours', b.expected_hours],
      ['Approved hours paid', b.paid_hours],
      ['Short hours', b.deficit_hours],
      ['Approved overtime (h)', b.ot_approved_hours],
      ['Overtime amount', b.ot_amount == null ? undefined : (moneyValue ? moneyValue(b.ot_amount) : b.ot_amount)],
      ['Hourly rate', b.hourly_rate == null ? undefined : (moneyValue ? moneyValue(b.hourly_rate) : b.hourly_rate)],
    ];
  }
  return [
    ['Working days', b.working_days],
    ['Weekend days', b.weekend_days],
    ['Holidays', b.holiday_days],
    ['Present / work from home', b.present_days != null ? Math.max(0, b.present_days - (b.half_days || 0)) : undefined],
    ['Half days', b.half_days],
    ['Absent', b.absent_days],
    ['Unmarked', b.unmarked_days],
    ['Paid leave', b.paid_leave_days],
    ['Unpaid leave', b.unpaid_leave_days],
    ['Paid hours', b.paid_hours],
    ['Unpaid hours', b.deficit_hours],
    ['Approved overtime (h)', b.ot_approved_hours],
    ['Overtime amount', b.ot_amount == null ? undefined : (moneyValue ? moneyValue(b.ot_amount) : b.ot_amount)],
    ['Hourly rate', b.hourly_rate == null ? undefined : (moneyValue ? moneyValue(b.hourly_rate) : b.hourly_rate)],
  ];
}

function printPayslip(payslip, orgName) {
  const b = payslip.breakdown || {};
  const rows = payslipFacts(b).filter(([, v]) => v !== undefined);

  const win = window.open('', '_blank', 'width=820,height=960');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Payslip — ${escapeHtml(periodLabel(payslip.payroll_run?.period_month, payslip.payroll_run?.period_year))}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 32px; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      td, th { padding: 6px 8px; font-size: 13px; text-align: left; border-bottom: 1px solid #e8ebf2; }
      .totals td { font-weight: 600; font-size: 14px; }
      .totals .net { color: #105aa9; font-size: 16px; }
    </style></head><body>
    <h1>${escapeHtml(orgName || 'Payslip')}</h1>
    <p class="sub">Payslip for ${escapeHtml(periodLabel(payslip.payroll_run?.period_month, payslip.payroll_run?.period_year))} · Generated ${escapeHtml(new Date(payslip.generated_at).toLocaleDateString())}</p>
    <table>
      <tr><td>Gross</td><td style="text-align:right">${escapeHtml(money(payslip.gross))}</td></tr>
      <tr><td>Deductions (loss of pay)</td><td style="text-align:right">-${escapeHtml(money(payslip.deductions))}</td></tr>
      <tr class="totals"><td>Net pay</td><td class="net" style="text-align:right">${escapeHtml(money(payslip.net))}</td></tr>
    </table>
    <table>${rows.map(([label, v]) => `<tr><td>${escapeHtml(label)}</td><td style="text-align:right">${escapeHtml(v)}</td></tr>`).join('')}</table>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function PayslipDrawer({ open, payslip, onClose }) {
  const { user } = useAuth();
  const b = payslip?.breakdown || {};
  return (
    <Drawer open={open} title="Payslip" onClose={onClose} size="md" tone="info" footer={
      payslip && (
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => printPayslip(payslip, user?.active_org?.name)}>
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      )
    }>
      {payslip && (
        <div className="space-y-4">
          <div className="rounded-xl border border-tertiary-100 bg-tertiary-50 p-3">
            <p className="text-xs text-tertiary-500">Period</p>
            <p className="font-heading text-sm font-semibold text-tertiary-900">{periodLabel(payslip.payroll_run?.period_month, payslip.payroll_run?.period_year)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-tertiary-100 p-3">
              <p className="text-[10px] uppercase text-tertiary-400">Gross</p>
              <p className="font-semibold text-tertiary-900">{money(payslip.gross)}</p>
            </div>
            <div className="rounded-xl border border-tertiary-100 p-3">
              <p className="text-[10px] uppercase text-tertiary-400">Deductions</p>
              <p className="font-semibold text-danger-600">-{money(payslip.deductions)}</p>
            </div>
            <div className="rounded-xl border border-primary-100 bg-primary-50 p-3">
              <p className="text-[10px] uppercase text-primary-600">Net pay</p>
              <p className="font-bold text-primary-800">{money(payslip.net)}</p>
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{b.source === 'approved_timesheets' ? 'Timesheet breakdown (older payslip)' : 'Attendance breakdown'}</h4>
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              {payslipFacts(b, money).filter(([, v]) => v !== undefined && v !== null).map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-tertiary-50 pb-1">
                  <dt className="text-tertiary-500">{label}</dt>
                  <dd className="font-medium text-tertiary-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function MyPayslipsTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  function load() {
    setLoading(true);
    apiClient.get('/payroll/payslips/me', { params: { limit: 50 } }).then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load payslips'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function openDetail(row) {
    try {
      const { data } = await apiClient.get(`/payroll/payslips/${row.id}`);
      setSelected(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load payslip'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'period', header: 'Period', render: (row) => periodLabel(row.payroll_run?.period_month, row.payroll_run?.period_year) },
    { key: 'gross', header: 'Gross', render: (row) => money(row.gross) },
    { key: 'deductions', header: 'Deductions', render: (row) => money(row.deductions) },
    { key: 'net', header: 'Net pay', render: (row) => <span className="font-semibold text-primary-700">{money(row.net)}</span> },
    { key: 'generated', header: 'Generated', render: (row) => new Date(row.generated_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-3">
      {!loading && rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No payslips yet" description="Payslips appear here once your organization runs payroll for a period." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No payslips." onRowClick={openDetail} />
      )}
      <PayslipDrawer open={Boolean(selected)} payslip={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function emptyComponent(label = '') { return { label, amount: '' }; }

// Create (no `structure`) and edit (`structure` set) share one form: an edit keeps the
// employee, and changes CTC, the components (base, allowances, and deductions as
// negative lines) and the effective date.
function StructureDrawer({ open, structure, onClose, onSubmit }) {
  const isEditing = Boolean(structure);
  const membershipOptions = useOrgMembershipOptions(open);
  const [orgMembershipId, setOrgMembershipId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [ctc, setCtc] = useState('');
  const [components, setComponents] = useState([emptyComponent('Basic'), emptyComponent('HRA'), emptyComponent('Allowances')]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (structure) {
      setOrgMembershipId(structure.org_membership_id);
      setEffectiveFrom(String(structure.effective_from).slice(0, 10));
      setCtc(String(Number(structure.ctc)));
      setComponents(Object.entries(structure.components || {}).map(([label, amount]) => ({ label, amount: String(amount) })));
      return;
    }
    setOrgMembershipId(''); setEffectiveFrom(new Date().toISOString().slice(0, 10)); setCtc('');
    setComponents([emptyComponent('Basic'), emptyComponent('HRA'), emptyComponent('Allowances')]);
  }, [open, structure]);

  function setComponent(index, key, value) {
    setComponents((current) => current.map((c, i) => (i === index ? { ...c, [key]: value } : c)));
  }

  const total = components.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const ctcNumber = Number(ctc) || 0;
  const balanced = ctcNumber > 0 && Math.abs(total - ctcNumber) < 0.01 && components.every((c) => c.label.trim());

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const componentMap = {};
      for (const c of components) componentMap[c.label.trim()] = Number(c.amount) || 0;
      await onSubmit(isEditing
        ? { effective_from: effectiveFrom, ctc: ctcNumber, components: componentMap }
        : { org_membership_id: orgMembershipId, effective_from: effectiveFrom, ctc: ctcNumber, components: componentMap });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title={isEditing ? `Edit salary structure — ${structure.org_membership?.person?.name || 'employee'}` : 'New salary structure'} onClose={onClose} size="lg" tone={isEditing ? 'edit' : 'create'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="salary-structure-form" className="btn-primary" disabled={saving || !orgMembershipId || !balanced}>{saving ? 'Saving…' : isEditing ? 'Update structure' : 'Save structure'}</button>
      </>
    }>
      <form id="salary-structure-form" onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-tertiary-600">Employee</label>
          {isEditing ? (
            <p className="rounded-xl border bg-tertiary-50 px-3 py-2 text-sm text-tertiary-700">{structure.org_membership?.person?.name || 'Employee'}</p>
          ) : (
            <SearchableSelect value={orgMembershipId} onChange={setOrgMembershipId} options={membershipOptions} placeholder="Select employee" searchPlaceholder="Search employees…" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Effective from<input required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Monthly CTC (gross)<input required type="number" min="0" step="0.01" value={ctc} onChange={(e) => setCtc(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-tertiary-600">Components</p>
          {components.map((c, index) => (
            <div key={index} className="flex items-center gap-2">
              <input required placeholder="Component (e.g. Basic, HRA, Allowances)" value={c.label} onChange={(e) => setComponent(index, 'label', e.target.value)} className="flex-1 rounded-xl border px-3 py-2 text-sm" />
              <input type="number" step="0.01" placeholder="Amount" value={c.amount} onChange={(e) => setComponent(index, 'amount', e.target.value)} className="w-32 rounded-xl border px-3 py-2 text-sm" />
              {components.length > 1 && (
                <button type="button" className="rounded-lg p-2 text-tertiary-400 hover:text-danger-600" onClick={() => setComponents((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
          <button type="button" className="btn-ghost text-xs" onClick={() => setComponents((current) => [...current, emptyComponent()])}>+ Add component</button>
        </div>
        <p className={`text-xs font-medium ${balanced ? 'text-success-700' : 'text-danger-600'}`}>
          Components total {money(total)} · CTC {money(ctcNumber)} {balanced ? '· Balanced' : '· Components must sum exactly to CTC'}
        </p>
        {isEditing && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This changes the structure itself. A payroll run that is still a draft will use the new figures when it is processed; payslips already processed keep the amounts they were generated with.
          </p>
        )}
        <p className="text-xs text-tertiary-400">Use a negative amount for a deduction-type component (e.g. a fixed “Deductions” line of -5000) — CTC is the net of all components.</p>
      </form>
    </Drawer>
  );
}

function SalaryStructuresTab({ filters }) {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const params = cleanParams(filters);

  function load() {
    setLoading(true);
    apiClient.get('/payroll/salary-structures', { params }).then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load salary structures'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function update(payload) {
    try {
      await apiClient.patch(`/payroll/salary-structures/${editing.id}`, payload);
      pushInfo('Salary structure updated');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the salary structure'), 'Something went wrong');
      throw err;
    }
  }

  async function remove(row) {
    const who = row.org_membership?.person?.name || 'this employee';
    if (!window.confirm(`Delete ${who}'s salary structure from ${new Date(row.effective_from).toLocaleDateString()} (${money(row.ctc)})? Payroll falls back to their previous structure. This can't be undone.`)) return;
    try {
      const { data } = await apiClient.delete(`/payroll/salary-structures/${row.id}`);
      const flagged = data.data?.flagged || 0;
      pushInfo(`Salary structure deleted${flagged ? ` — ${flagged} locked month${flagged === 1 ? '' : 's'} flagged for review` : ''}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the salary structure'), 'Something went wrong');
    }
  }

  async function create(payload) {
    try {
      await apiClient.post('/payroll/salary-structures', payload);
      pushInfo('Salary structure saved');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save salary structure'), 'Something went wrong');
      throw err;
    }
  }

  // Total monthly CTC: each active employee's structure in force today, once —
  // the list also holds their past and upcoming versions. Follows the filters.
  const { currentIds, totalCtc, employees } = useMemo(() => {
    const today = new Date();
    const byMember = new Map();
    for (const row of rows) {
      if (new Date(row.effective_from) > today) continue;
      const key = row.org_membership_id || row.org_membership?.id;
      const held = byMember.get(key);
      if (!held || new Date(row.effective_from) > new Date(held.effective_from)) byMember.set(key, row);
    }
    const current = [...byMember.values()].filter((row) => row.org_membership?.employment_status !== 'terminated');
    return {
      currentIds: new Set([...byMember.values()].map((row) => row.id)),
      totalCtc: current.reduce((sum, row) => sum + Number(row.ctc || 0), 0),
      employees: current.length,
    };
  }, [rows]);
  const versionLabel = (row) => {
    if (currentIds.has(row.id)) return ['Current', 'bg-success-50 text-success-700'];
    if (new Date(row.effective_from) > new Date()) return ['Upcoming', 'bg-primary-50 text-primary-700'];
    return ['Past', 'bg-tertiary-100 text-tertiary-500'];
  };

  const columns = [
    { key: 'person', header: 'Employee', render: (row) => <MemberCell membership={row.org_membership} /> },
    {
      key: 'effective',
      header: 'Effective from',
      render: (row) => {
        const [label, tone] = versionLabel(row);
        return <span className="whitespace-nowrap">{new Date(row.effective_from).toLocaleDateString()}<span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>{label}</span></span>;
      },
    },
    { key: 'ctc', header: 'Monthly CTC', render: (row) => <span>{money(row.ctc)}{row.updated_at && <span className="ml-1.5 text-[11px] text-tertiary-400" title={`Edited ${new Date(row.updated_at).toLocaleString()}`}>edited</span>}</span> },
    { key: 'components', header: 'Components', render: (row) => Object.keys(row.components || {}).join(', ') || '—' },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <span className="flex gap-1">
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(row)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
          <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs text-danger-600" onClick={() => remove(row)}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!loading && rows.length > 0 ? (
          <div className="rounded-xl border border-tertiary-100 bg-white px-4 py-2.5">
            <p className="text-xs text-tertiary-500">Total monthly CTC · {employees} employee{employees === 1 ? '' : 's'}</p>
            <p className="font-heading text-lg font-semibold tabular-nums text-tertiary-900">{money(totalCtc)}</p>
            <p className="text-[11px] text-tertiary-400">Each active employee&apos;s current structure, once · annual {money(totalCtc * 12)}</p>
          </div>
        ) : <span />}
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> New structure</button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={FileText} title="No salary structures yet" description="Set a CTC breakdown per employee before running payroll — a run skips anyone without one." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No salary structures." />
      )}
      <StructureDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} />
      <StructureDrawer open={Boolean(editing)} structure={editing} onClose={() => setEditing(null)} onSubmit={update} />
    </div>
  );
}

function NewRunDrawer({ open, onClose, onSubmit }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setMonth(now.getMonth() + 1); setYear(now.getFullYear()); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ period_month: Number(month), period_year: Number(year) });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="New payroll run" onClose={onClose} size="sm" tone="create" footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="payroll-run-form" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create run'}</button>
      </>
    }>
      <form id="payroll-run-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Month<input required type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Year<input required type="number" value={year} onChange={(e) => setYear(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
        <p className="text-xs text-tertiary-500">Creates a draft run for the period. Nothing is paid until it&apos;s processed. Processing uses the attendance-based salary (Payroll → Attendance salary) — the month&apos;s locked version if it has been locked.</p>
      </form>
    </Drawer>
  );
}

function RunPayslipsDrawer({ open, run, filters, onClose, onOpenPayslip }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const params = cleanParams(filters || {});

  useEffect(() => {
    if (!open || !run) return;
    setLoading(true);
    apiClient.get(`/payroll/runs/${run.id}/payslips`, { params }).then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load payslips'), 'Something went wrong')).finally(() => setLoading(false));
  }, [open, run, pushError, JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [
    { key: 'person', header: 'Employee', render: (row) => <MemberCell membership={row.org_membership} /> },
    { key: 'gross', header: 'Gross', render: (row) => money(row.gross) },
    { key: 'deductions', header: 'Deductions', render: (row) => money(row.deductions) },
    { key: 'net', header: 'Net', render: (row) => <span className="font-semibold text-primary-700">{money(row.net)}</span> },
  ];

  return (
    <Drawer open={open} title={run ? `Payslips — ${periodLabel(run.period_month, run.period_year)}` : 'Payslips'} onClose={onClose} size="lg" tone="info">
      {run?.skipped?.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {run.skipped.length} employee(s) skipped — no salary structure effective for this period.
        </div>
      )}
      <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No payslips generated." onRowClick={onOpenPayslip} />
    </Drawer>
  );
}

function PayrollRunsTab({ filters }) {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [viewingRun, setViewingRun] = useState(null);
  const [selectedPayslip, setSelectedPayslip] = useState(null);

  function load() {
    setLoading(true);
    apiClient.get('/payroll/runs').then(({ data }) => setRows(data.data || [])).catch((err) => pushError(apiErrorMessage(err, 'Failed to load payroll runs'), 'Something went wrong')).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create(payload) {
    try {
      await apiClient.post('/payroll/runs', payload);
      pushInfo('Payroll run created');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create payroll run'), 'Something went wrong');
      throw err;
    }
  }

  async function process(row) {
    if (!window.confirm(`Process payroll for ${periodLabel(row.period_month, row.period_year)}? This generates payslips for every eligible employee and can't be re-run for this period.`)) return;
    setProcessingId(row.id);
    try {
      const { data } = await apiClient.post(`/payroll/runs/${row.id}/process`);
      pushInfo(`Processed — ${data.data.payslips_generated} payslip(s) generated${data.data.skipped?.length ? `, ${data.data.skipped.length} skipped` : ''}`);
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to process payroll run'), 'Something went wrong');
    } finally {
      setProcessingId(null);
    }
  }

  async function openPayslip(row) {
    try {
      const { data } = await apiClient.get(`/payroll/payslips/${row.id}`);
      setSelectedPayslip(data.data);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load payslip'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'period', header: 'Period', render: (row) => periodLabel(row.period_month, row.period_year) },
    { key: 'status', header: 'Status', render: (row) => <Badge value={row.status} /> },
    { key: 'run_at', header: 'Processed', render: (row) => (row.run_at ? new Date(row.run_at).toLocaleString() : '—') },
    { key: 'skipped', header: 'Skipped', render: (row) => row.skipped?.length || 0 },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {row.status === 'draft' && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" disabled={processingId === row.id} onClick={() => process(row)}>
              <Play className="h-3.5 w-3.5" /> {processingId === row.id ? 'Processing…' : 'Process'}
            </button>
          )}
          {row.status === 'processed' && (
            <button type="button" className="btn-ghost text-xs" onClick={() => setViewingRun(row)}>View payslips</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}><Plus className="h-4 w-4" /> New run</button>
      </div>
      {!loading && rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No payroll runs yet" description="Create a run for a period, then process it to generate payslips from attendance, leave, and salary structures." />
      ) : (
        <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No payroll runs." />
      )}
      <NewRunDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSubmit={create} />
      <RunPayslipsDrawer open={Boolean(viewingRun)} run={viewingRun} filters={filters} onClose={() => setViewingRun(null)} onOpenPayslip={openPayslip} />
      <PayslipDrawer open={Boolean(selectedPayslip)} payslip={selectedPayslip} onClose={() => setSelectedPayslip(null)} />
    </div>
  );
}

/** Employee name with code / department / team under it. */
function MemberCell({ membership }) {
  if (!membership) return '—';
  const sub = [membership.employee_code, membership.department?.name || membership.person?.department?.name, membership.team?.name].filter(Boolean).join(' · ');
  return <span>{membership.person?.name || '—'}{sub && <span className="block text-xs text-tertiary-500">{sub}</span>}</span>;
}

const BASE_TABS = [{ key: 'my-payslips', label: 'My Payslips', icon: FileText }];
const ADMIN_TABS = [
  // Salary from attendance / check-ins on each employee's calendar — what a
  // run processes (and, once the month is locked, exactly the locked figures).
  { key: 'attendance-salary', label: 'Attendance Salary', icon: CalendarCheck },
  // What each person is paid from (timesheet hours or attendance), compared before switching.
  { key: 'salary-structures', label: 'Salary Structures', icon: Wallet },
  // TDS, OT adjustment, variable pay, reimbursements and the final payable salary.
  { key: 'adjustments', label: 'Adjustments', icon: SlidersHorizontal },
  { key: 'runs', label: 'Payroll Runs', icon: Play },
];

/**
 * Payroll hub — Phase 4 frontend. Self-service payslips for every role;
 * salary-structure configuration and run processing are admin-only, matching
 * the backend's own authorize('admin') gating on those endpoints.
 */
export default function PayrollHubPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'my-payslips';
  const section = tabs.some((t) => t.key === requested) ? requested : 'my-payslips';
  // Employee / Department / Team — one filter bar for every admin tab.
  const [people, setPeople] = useState(EMPTY_PEOPLE_FILTERS);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
              section === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'
            }`}
            onClick={() => setParams({ section: key })}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {isAdmin && section !== 'my-payslips' && (
        <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Payroll filters">
          <PeopleFilters value={people} onChange={setPeople} />
          <div className="flex items-end">
            <button type="button" className="btn-ghost text-xs" onClick={() => setPeople(EMPTY_PEOPLE_FILTERS)} disabled={!Object.values(people).some(Boolean)}>Clear filters</button>
          </div>
        </div>
      )}
      {section === 'my-payslips' && <MyPayslipsTab />}
      {section === 'attendance-salary' && isAdmin && <AttendanceSalaryTab people={people} endpoint="/payroll/attendance-salary" />}
      {section === 'salary-structures' && isAdmin && <SalaryStructuresTab filters={people} />}
      {section === 'adjustments' && isAdmin && <SalaryAdjustmentsTab />}
      {section === 'runs' && isAdmin && <PayrollRunsTab filters={people} />}
    </div>
  );
}
