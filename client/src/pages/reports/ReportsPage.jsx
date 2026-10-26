import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Briefcase,
  Building2,
  CircleAlert,
  ClipboardCheck,
  FileText,
  LayoutGrid,
  Send,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { fetchAllPages } from '../../lib/fetchAllPages.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { usePermissions, userCan, Can } from '../../lib/permissions.js';
import { hasNeed, isPermissionMode } from '../../lib/access.js';
import { CHART_COLORS, CHART_PALETTE, chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import { rangeForPreset } from '../../lib/datePresets.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { ExcelIcon, PdfIcon } from '../../components/ui/ExportIcons.jsx';
import DrilldownDrawer from './DrilldownDrawer.jsx';
import MonthlyReview from './MonthlyReview.jsx';
import {
  agingSections,
  chartBarsForReport,
  chartDataForReport,
  chartTypeForReport,
  columnsForReport,
  defaultDateRange,
  drillMetrics,
  drillParams,
  formatReportDate,
  formatReportDateShort,
  hrSections,
  hrTypeSummary,
  joiningsSections,
  bdaReportsSections,
  salesReportsSections,
  recruiterReportsSections,
  sectionTabBadge,
  reportsForPermissions,
  reportsForRole,
  tableRowsForReport,
  timeToSubmitColumns,
  timeToSubmitRows,
} from './reportViews.js';

const HR_SOURCE_OPTIONS = [
  { value: 'direct', label: 'Bench' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'linkedin', label: 'Market' },
];

// `/accounts` caps `limit` at 100, so page through it to get EVERY account for a
// picker (BDA/Sales report filters).
async function fetchAllAccountOptions(extraParams = {}) {
  const rows = await fetchAllPages('/accounts', { ...extraParams, sort_by: 'name', sort_order: 'asc' });
  return rows.map((a) => ({ value: a.id, label: a.name }));
}

const HR_TAB_META = {
  sourcing: { hint: 'Profiles sourced per day (excludes on-bench)', Icon: UserPlus },
  submissions: { hint: 'Submissions created per day (excludes on-bench)', Icon: Send },
  submitted_to_client: { hint: 'Profiles submitted to the client per day, by sourcer (excludes on-bench)', Icon: Send },
  round1_by_sourcer: { hint: 'Internal round 1 per day, grouped by the sourcer', Icon: ClipboardCheck },
  round1_by_interviewer: { hint: 'Internal round 1 per day, grouped by the interviewer', Icon: UserCheck },
};

const HR_DAY_PX = 46; // horizontal space per day; the chart scrolls when it overflows

// Daily HR trend chart. One point per day across the whole selected range; the
// plot area scrolls horizontally so every day is reachable. Round tables ->
// multi-line (scheduled / completed / shortlisted); sourcing / submissions ->
// stacked bars by source (Bench / Vendor / Market).
function HrChart({ section }) {
  const { data, series, isRound } = useMemo(() => {
    const round = section?.key.startsWith('round1');
    const byDate = new Map();
    for (const r of section?.rows || []) {
      const d = r.date || '—';
      if (!byDate.has(d)) byDate.set(d, { date: d });
      const bucket = byDate.get(d);
      if (round) {
        bucket.scheduled = (bucket.scheduled || 0) + (r.scheduled || 0);
        bucket.completed = (bucket.completed || 0) + (r.completed || 0);
        bucket.shortlisted = (bucket.shortlisted || 0) + (r.shortlisted || 0);
      } else {
        for (const [label, n] of Object.entries(r.by_type || {})) {
          bucket[label] = (bucket[label] || 0) + n;
        }
      }
    }
    const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const typeKeys = round
      ? []
      : [...new Set((section?.rows || []).flatMap((r) => Object.keys(r.by_type || {})))].sort();
    const s = round
      ? [
          { key: 'scheduled', name: 'Scheduled', color: CHART_COLORS.info },
          { key: 'completed', name: 'Completed', color: CHART_COLORS.success },
          { key: 'shortlisted', name: 'Shortlisted', color: CHART_COLORS.purple },
        ]
      : typeKeys.map((t, i) => ({ key: t, name: t, color: CHART_PALETTE[i % CHART_PALETTE.length] }));
    for (const row of rows) for (const ser of s) row[ser.key] = row[ser.key] || 0;
    return { data: rows, series: s, isRound: round };
  }, [section]);

  if (!section || !data.length) return null;

  const minWidth = Math.max(560, data.length * HR_DAY_PX);
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
      <XAxis dataKey="date" tickFormatter={formatReportDateShort} tick={{ fontSize: 11 }} interval={0} />
      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
      <Tooltip contentStyle={chartTooltipStyle} labelFormatter={formatReportDate} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </>
  );

  return (
    <ChartCard
      title={section.title}
      subtitle={
        isRound ? 'Scheduled / completed / shortlisted per day — scroll for more' : 'By day, by source — scroll for more'
      }
    >
      <div className="overflow-x-auto">
        <div style={{ minWidth, height: 256 }}>
          <ResponsiveContainer width="100%" height="100%">
            {isRound ? (
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                {axis}
                {series.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                {axis}
                {series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId="src" radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </ChartCard>
  );
}

function ReportChart({ reportKey, chartRows, chartBars }) {
  const type = chartTypeForReport(reportKey);
  if (!chartRows.length) return null;

  if (type === 'pie') {
    return (
      <ChartCard title="Overview" subtitle="Distribution">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartRows} dataKey="value" nameKey="label" innerRadius={50} outerRadius={90} paddingAngle={3}>
                {chartRows.map((row, index) => (
                  <Cell key={row.label} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    );
  }

  if (type === 'line') {
    return (
      <ChartCard title="Overview" subtitle="Trend over groups">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="closures" name="Closures" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primarySoft} />
              <Line type="monotone" dataKey="margin" name="Margin" stroke={CHART_COLORS.success} strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Overview" subtitle="Bar comparison">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {chartBars.map((bar) => (
              <Bar key={bar.dataKey} dataKey={bar.dataKey} name={bar.name} fill={bar.fill} radius={[8, 8, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** A report count that opens the records behind it. Plain text when there is nothing to open. */
function DrillCount({ onClick, children }) {
  return (
    <button
      type="button"
      title="Show the records behind this count"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="font-semibold text-primary-600 underline decoration-dotted underline-offset-2 hover:text-primary-800"
    >
      {children}
    </button>
  );
}

function DetailField({ label, value }) {
  return (
    <div className="rounded-xl bg-tertiary-50 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-tertiary-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-tertiary-900">{value ?? '—'}</div>
    </div>
  );
}

/** account id for a coverage row (clients-without-requirements = client, recruiter-vendor-gaps = vendor). */
function coverageRowAccountId(row) {
  return row?.client?.id || row?.vendor?.id || null;
}

/** Union {id,name} people from any number of lists, de-duped by id, sorted by name. */
function mergePeople(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const p of list || []) {
      if (p && p.id && !map.has(p.id)) map.set(p.id, { id: p.id, name: p.name });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Inline person picker for a coverage-report cell. Superadmin-only — changes the
 * account's owner (Sales POC / Our POC) or origin_owner (Brought by) in place.
 */
function CoveragePersonCell({ row, field, people, saving, onSave }) {
  const current = field === 'origin_owner_id' ? row.brought_by : row.sales_poc || row.our_poc;
  const options = current?.id && !people.some((p) => p.id === current.id)
    ? [{ id: current.id, name: `${current.name} (current)` }, ...people]
    : people;
  return (
    <select
      value={current?.id || ''}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        onSave(coverageRowAccountId(row), field, e.target.value);
      }}
      className="max-w-[11rem] rounded-md border border-tertiary-200 bg-white px-2 py-1 text-sm text-tertiary-800 disabled:opacity-50"
    >
      {!current?.id && <option value="">—</option>}
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const { can } = usePermissions(user);
  const available = useMemo(() => {
    const byRole = reportsForRole(user?.role || 'recruiter');
    if (!isPermissionMode(user) || user.access.level !== 'employee') return byRole;
    const byPermission = reportsForPermissions((key) => hasNeed(user, key));
    return [...byPermission, ...byRole.filter((r) => !byPermission.some((p) => p.key === r.key))];
  }, [user]);
  const defaults = useMemo(() => defaultDateRange(), []);

  const [active, setActive] = useState(available[0]?.key || 'recruiter-performance');
  const [datePreset, setDatePreset] = useState('this_month');
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [thresholdDays, setThresholdDays] = useState('7');
  const [groupBy, setGroupBy] = useState('month');
  const [departmentId, setDepartmentId] = useState('');
  const [individualId, setIndividualId] = useState('');
  // bda-reports: Account (any type) + account-type filter for "Accounts brought".
  const [bdaReportsAccountId, setBdaReportsAccountId] = useState('');
  const [bdaReportsAccountType, setBdaReportsAccountType] = useState('');
  const [bdaReportsAccounts, setBdaReportsAccounts] = useState([]);
  // sales-reports: Client filter.
  const [salesReportsAccountId, setSalesReportsAccountId] = useState('');
  const [salesReportsAccounts, setSalesReportsAccounts] = useState([]);
  // clients-without-requirements: Sales POC = account owner (bda_id), Brought by = origin_owner_id.
  const [coveragePocId, setCoveragePocId] = useState('');
  const [coverageBroughtById, setCoverageBroughtById] = useState('');
  // CWR tab: current requirement situation of each active client
  // (all | with_requirements | no_active | without_active_requirements | closed_only).
  const [coverageBucket, setCoverageBucket] = useState('all');
  const [coveragePeople, setCoveragePeople] = useState([]);
  const [savingCoverageId, setSavingCoverageId] = useState(null);
  // recruiter-vendor-gaps: filter by vendor account, the vendor's POC from our end,
  // and who brought the vendor in.
  const [rvgVendorId, setRvgVendorId] = useState('');
  const [rvgPocId, setRvgPocId] = useState('');
  const [rvgBroughtById, setRvgBroughtById] = useState('');
  const [rvgVendors, setRvgVendors] = useState([]);
  // RVG: active = every active-stage vendor; inactive = no live submission;
  // has_live = Active − Inactive (has a live candidate).
  const [rvgActivity, setRvgActivity] = useState('active');
  const [hrSourcerId, setHrSourcerId] = useState('');
  const [hrInterviewerId, setHrInterviewerId] = useState('');
  const [hrSource, setHrSource] = useState('');
  const [hrPeople, setHrPeople] = useState([]);
  const [hrTab, setHrTab] = useState('sourcing');
  const [joiningsTab, setJoiningsTab] = useState('by_sourcer');
  const [bdaReportsTab, setBdaReportsTab] = useState('accounts_created');
  const [salesReportsTab, setSalesReportsTab] = useState('requirements_created');
  const [recruiterReportsTab, setRecruiterReportsTab] = useState('profiles_submitted_to_client');
  const [ttsClientId, setTtsClientId] = useState('');
  const [ttsRequirementId, setTtsRequirementId] = useState('');
  const [ttsSourcerId, setTtsSourcerId] = useState('');
  const [ttsSearch, setTtsSearch] = useState('');
  const [ttsSearchApplied, setTtsSearchApplied] = useState('');
  const [ttsClients, setTtsClients] = useState([]);
  const [ttsRequirements, setTtsRequirements] = useState([]);
  const [explorerStuckOnly, setExplorerStuckOnly] = useState(false);
  const [explorerPastSlaOnly, setExplorerPastSlaOnly] = useState(false);
  const [explorerSearch, setExplorerSearch] = useState('');
  const [explorerStatus, setExplorerStatus] = useState('');
  const [departments, setDepartments] = useState([]);
  const [individuals, setIndividuals] = useState([]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  // A stale response landing after `active` has moved on would otherwise get
  // rendered with the wrong report's column config (raw hover-breakdown objects
  // as cells -> React crash / blank screen). Only apply the response still
  // matching the latest request.
  const reportRequestId = useRef(0);
  const [exporting, setExporting] = useState(false);
  const [drawerRow, setDrawerRow] = useState(null);
  // The count the user clicked: { params, label } for GET /reports/drilldown.
  const [drill, setDrill] = useState(null);

  const isExplorer = active === 'pipeline-explorer';
  const isHr = active === 'hr';
  const isJoinings = active === 'joinings';
  const isTimeToSubmit = active === 'time-to-submit';
  const isBdaReports = active === 'bda-reports';
  const isSalesReports = active === 'sales-reports';
  const isRecruiterReports = active === 'recruiter-reports';
  const isDateOnly =
    isHr || isJoinings || isTimeToSubmit || isBdaReports || isSalesReports || isRecruiterReports; // reports that take only a date range
  const isCoverage = active === 'clients-without-requirements' || active === 'recruiter-vendor-gaps';
  const isClientsWithoutReqs = active === 'clients-without-requirements';
  const isRvg = active === 'recruiter-vendor-gaps';
  const showDept = can('filterByDepartment');
  const INDIVIDUAL_ROLE_BY_REPORT = {
    'recruiter-performance': 'recruiter',
    'sales-performance': 'sales',
    'bda-performance': 'bda',
    'recruiter-vendor-gaps': 'recruiter',
    'bda-reports': 'bda',
    'sales-reports': 'sales',
    'recruiter-reports': 'recruiter',
  };
  // bda-reports / sales-reports self-scope a bda/sales caller server-side regardless
  // of this filter, so hide it for them — only useful to an admin looking across people.
  const showIndividual =
    can('filterByIndividual') &&
    Boolean(INDIVIDUAL_ROLE_BY_REPORT[active]) &&
    !((active === 'bda-reports' && user?.role === 'bda') || (active === 'sales-reports' && user?.role === 'sales') ||
      (active === 'recruiter-reports' && user?.role === 'recruiter'));
  const showCoveragePeople = can('filterByIndividual') && isClientsWithoutReqs;
  const canEditCoverage = (isClientsWithoutReqs || isRvg) && userCan(user, 'editBroughtBy');

  // The filter dropdowns must contain EVERY name that can appear in the matching
  // column — including inactive users and roles outside the "expected" set (an
  // account owner / origin owner can be anyone). So each list is the full user
  // roster unioned with the people actually present in the current report rows.
  const rowPeople = useMemo(() => {
    const rows = Array.isArray(payload) ? payload : [];
    const pick = (field) =>
      rows.flatMap((r) => {
        const v = r[field];
        return Array.isArray(v) ? v : v ? [v] : [];
      });
    return { brought_by: pick('brought_by'), sales_poc: pick('sales_poc'), our_poc: pick('our_poc') };
  }, [payload]);

  const broughtByPeople = useMemo(
    () => mergePeople(coveragePeople, rowPeople.brought_by),
    [coveragePeople, rowPeople]
  );
  const salesPocPeople = useMemo(
    () => mergePeople(coveragePeople, rowPeople.sales_poc),
    [coveragePeople, rowPeople]
  );
  const ourPocPeople = useMemo(
    () => mergePeople(coveragePeople, rowPeople.our_poc),
    [coveragePeople, rowPeople]
  );

  useEffect(() => {
    if (!available.some((r) => r.key === active) && available[0]) {
      setActive(available[0].key);
    }
  }, [available, active]);

  useEffect(() => {
    if (!isHr && !isTimeToSubmit) return;
    apiClient
      .get('/users/directory')
      .then(({ data }) =>
        setHrPeople(
          (data.data || []).map((u) => ({
            value: u.id,
            label: u.active === false ? `${u.name} (inactive)` : u.name,
          }))
        )
      )
      .catch(() => setHrPeople([]));
  }, [isHr, isTimeToSubmit]);

  useEffect(() => {
    if (!isTimeToSubmit) return;
    apiClient
      .get('/accounts', { params: { type: 'client', limit: 100, sort_by: 'name', sort_order: 'asc' } })
      .then(({ data }) => setTtsClients((data.data || []).map((a) => ({ value: a.id, label: a.name }))))
      .catch(() => setTtsClients([]));
    apiClient
      .get('/requirements', { params: { limit: 100, sort_by: 'created_at', sort_order: 'desc' } })
      .then(({ data }) =>
        setTtsRequirements(
          (data.data || []).map((r) => ({ value: r.id, label: `${r.title}${r.account?.name ? ` · ${r.account.name}` : ''}` }))
        )
      )
      .catch(() => setTtsRequirements([]));
  }, [isTimeToSubmit]);

  useEffect(() => {
    if (!isBdaReports) {
      setBdaReportsAccounts([]);
      return undefined;
    }
    let cancelled = false;
    // Accounts brought can be a client or a vendor, so this list is unrestricted by type.
    fetchAllAccountOptions()
      .then((opts) => !cancelled && setBdaReportsAccounts(opts))
      .catch(() => !cancelled && setBdaReportsAccounts([]));
    return () => {
      cancelled = true;
    };
  }, [isBdaReports]);

  useEffect(() => {
    if (!isSalesReports) {
      setSalesReportsAccounts([]);
      return undefined;
    }
    let cancelled = false;
    fetchAllAccountOptions({ type: 'client' })
      .then((opts) => !cancelled && setSalesReportsAccounts(opts))
      .catch(() => !cancelled && setSalesReportsAccounts([]));
    return () => {
      cancelled = true;
    };
  }, [isSalesReports]);

  useEffect(() => {
    if (datePreset === 'custom') return;
    const range = rangeForPreset(datePreset);
    setDateFrom(range.date_from);
    setDateTo(range.date_to);
    if (datePreset === 'this_quarter' || datePreset === 'last_quarter') setGroupBy('quarter');
    else setGroupBy('month');
  }, [datePreset]);

  useEffect(() => {
    if (!showDept) return undefined;
    apiClient
      .get('/departments')
      .then(({ data }) => setDepartments(data.data || []))
      .catch(() => setDepartments([]));
    return undefined;
  }, [showDept]);

  useEffect(() => {
    if (!showIndividual) {
      setIndividuals([]);
      return undefined;
    }
    // *-performance / recruiter-vendor-gaps genuinely list one role. bda-reports /
    // sales-reports filter by "brought by" / "sales POC", which can be ANY user
    // (roles change, admins bring accounts) — so pull the whole roster, inactive
    // included, rather than role=bda / role=sales.
    const roleScoped = active !== 'bda-reports' && active !== 'sales-reports';
    const role = INDIVIDUAL_ROLE_BY_REPORT[active] || 'recruiter';
    apiClient
      .get('/users/directory', { params: roleScoped ? { role } : {} })
      .then(({ data }) => setIndividuals((data.data || []).map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => setIndividuals([]));
    return undefined;
  }, [showIndividual, active]);

  useEffect(() => {
    if (!showCoveragePeople && !canEditCoverage && !isRvg) {
      setCoveragePeople([]);
      return undefined;
    }
    apiClient
      // Directory: every role can read it, inactive users included (a "Brought by"
      // / "POC" value can be an inactive user).
      .get('/users/directory')
      .then(({ data }) =>
        setCoveragePeople(
          [...(data.data || [])]
            .map((u) => ({ id: u.id, name: u.name, role: u.role }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setCoveragePeople([]));
    return undefined;
  }, [showCoveragePeople, canEditCoverage, isRvg]);

  useEffect(() => {
    if (!isRvg) {
      setRvgVendors([]);
      return undefined;
    }
    apiClient
      .get('/accounts', { params: { type: 'vendor', limit: 100 } })
      .then(({ data }) =>
        setRvgVendors(
          [...(data.data || [])]
            .map((a) => ({ id: a.id, name: a.name }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setRvgVendors([]));
    return undefined;
  }, [isRvg]);

  async function saveCoverageField(clientId, field, value) {
    if (!value) return;
    setSavingCoverageId(clientId);
    try {
      await apiClient.patch(`/accounts/${clientId}`, { [field]: value });
      await runReport();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update account'), 'Something went wrong');
    } finally {
      setSavingCoverageId(null);
    }
  }

  function buildParams() {
    const params = {};
    if (active === 'aging') {
      params.threshold_days = thresholdDays || 7;
    } else if (isCoverage) {
      // CWR / RVG are present-state only — no date range.
    } else if (isHr) {
      params.date_from = dateFrom;
      params.date_to = dateTo;
      if (hrSourcerId) params.sourcer_id = hrSourcerId;
      if (hrInterviewerId) params.interviewer_id = hrInterviewerId;
      if (hrSource) params.source = hrSource;
    } else if (isJoinings) {
      params.date_from = dateFrom;
      params.date_to = dateTo;
    } else if (isTimeToSubmit) {
      params.date_from = dateFrom;
      params.date_to = dateTo;
      if (ttsClientId) params.client_id = ttsClientId;
      if (ttsRequirementId) params.requirement_id = ttsRequirementId;
      if (ttsSourcerId) params.sourcer_id = ttsSourcerId;
      if (ttsSearchApplied.trim()) params.search = ttsSearchApplied.trim();
    } else if (isExplorer) {
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (explorerSearch.trim()) params.search = explorerSearch.trim();
      if (explorerStatus) params.requirement_status = explorerStatus;
      if (explorerStuckOnly) params.stuck_only = 'true';
      if (explorerPastSlaOnly) params.past_sla_only = 'true';
      params.threshold_days = thresholdDays || 7;
      params.limit = 100;
    } else {
      params.date_from = dateFrom;
      params.date_to = dateTo;
      if (active === 'closure') params.group_by = groupBy;
    }
    if (departmentId && !isCoverage) params.department_id = departmentId;
    if (individualId && active === 'recruiter-performance') params.recruiter_id = individualId;
    if (individualId && active === 'sales-performance') params.sales_id = individualId;
    if (individualId && active === 'bda-performance') params.bda_id = individualId;
    if (individualId && active === 'recruiter-vendor-gaps') params.recruiter_id = individualId;
    if (individualId && active === 'bda-reports') params.bda_id = individualId;
    if (individualId && active === 'sales-reports') params.sales_id = individualId;
    if (individualId && active === 'recruiter-reports') params.recruiter_id = individualId;
    if (isBdaReports && bdaReportsAccountId) params.client_id = bdaReportsAccountId;
    if (isBdaReports && bdaReportsAccountType) params.account_type = bdaReportsAccountType;
    if (isSalesReports && salesReportsAccountId) params.client_id = salesReportsAccountId;
    if (isClientsWithoutReqs && coveragePocId) params.bda_id = coveragePocId;
    if (isClientsWithoutReqs && coverageBroughtById) params.origin_owner_id = coverageBroughtById;
    // Both toggle buckets are active-client views — always send stage=active.
    if (isClientsWithoutReqs) {
      params.stage = 'active';
      params.bucket = coverageBucket || 'all';
    }
    if (isRvg && rvgVendorId) params.vendor_id = rvgVendorId;
    if (isRvg && rvgPocId) params.owner_id = rvgPocId;
    if (isRvg && rvgBroughtById) params.origin_owner_id = rvgBroughtById;
    if (isRvg) params.vendor_activity = rvgActivity;
    return params;
  }

  // silent = a background refresh: no spinner, and a failed refresh keeps what is on screen instead of blanking it.
  async function runReport({ silent = false } = {}) {
    if (active === 'monthly-review') return; // its own screen loads its own data
    const requestId = ++reportRequestId.current;
    if (!silent) setLoading(true);
    try {
      const { data } = await apiClient.get(`/reports/${active}`, { params: buildParams() });
      if (requestId !== reportRequestId.current) return;
      setPayload(data.data);
    } catch (err) {
      if (requestId !== reportRequestId.current) return;
      if (silent) return;
      setPayload(null);
      pushError(apiErrorMessage(err, 'Failed to load report'), 'Something went wrong');
    } finally {
      if (requestId === reportRequestId.current && !silent) setLoading(false);
    }
  }

  // Live data: the open report refreshes itself every 30 seconds and when the tab is shown again, with the filters
  // that are on screen, so the numbers follow what the team is doing without pressing anything.
  const runReportRef = useRef(runReport);
  runReportRef.current = runReport;
  useEffect(() => {
    if (!available.length) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') runReportRef.current({ silent: true }); };
    const timer = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [available.length]);

  useEffect(() => {
    if (available.length) runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.role,
    active,
    dateFrom,
    dateTo,
    departmentId,
    individualId,
    thresholdDays,
    groupBy,
    coveragePocId,
    coverageBroughtById,
    coverageBucket,
    rvgVendorId,
    rvgPocId,
    rvgBroughtById,
    rvgActivity,
    explorerStuckOnly,
    explorerPastSlaOnly,
    explorerStatus,
    explorerSearch,
    hrSourcerId,
    hrInterviewerId,
    hrSource,
    ttsClientId,
    ttsRequirementId,
    ttsSourcerId,
    ttsSearchApplied,
    bdaReportsAccountId,
    bdaReportsAccountType,
    salesReportsAccountId,
  ]);

  async function exportReport(type) {
    setExporting(true);
    try {
      const { data: blob } = await apiClient.get('/reports/export', {
        params: { type, report: active, ...buildParams() },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${active}.${type === 'xlsx' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      let message = err.message || 'Export failed';
      if (err.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await err.response.data.text());
          message = parsed.message || message;
        } catch {
          // response wasn't JSON — keep the generic message
        }
      } else if (err.response?.data?.message) {
        message = err.response.data.message;
      }
      pushError(message, 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // Current report filters the drill-down must repeat so its list matches the clicked count.
  function drillFilters() {
    const filters = isCoverage ? {} : { date_from: dateFrom, date_to: dateTo };
    if (isHr && hrSource) filters.source = hrSource;
    if (isBdaReports && bdaReportsAccountId) filters.client_id = bdaReportsAccountId;
    if (isBdaReports && bdaReportsAccountType) filters.account_type = bdaReportsAccountType;
    if (isSalesReports && salesReportsAccountId) filters.client_id = salesReportsAccountId;
    return filters;
  }

  function drillLabel(row, col) {
    // Rows name their subject as plain text (HR / BDA / Sales / Joinings) or as { id, name } (coverage reports).
    const nameOf = (value) => (value && typeof value === 'object' ? value.name : value);
    const who =
      [row.vendor, row.client, row.sourcer, row.interviewer, row.bda, row.sales_poc, row.recruiter].map(nameOf).find(Boolean) || '';
    const when = row.date ? formatReportDate(row.date) : row.month || '';
    return [col.header, who, when].filter(Boolean).join(' · ');
  }

  /** Turn the count columns of a report table into links that open the records behind each count. */
  function withDrill(columns, tableKey = 'main') {
    const metrics = drillMetrics(active, tableKey);
    if (!metrics.length) return columns;
    return columns.map((col) => {
      if (!metrics.includes(col.key)) return col;
      return {
        ...col,
        render: (row) => {
          const inner = col.render ? col.render(row) : (row[col.key] ?? 0);
          const params = drillParams(active, tableKey, col.key, row, drillFilters());
          if (!params || !Number(row[col.key])) return inner;
          return (
            <DrillCount onClick={() => setDrill({ title: drillLabel(row, col), lists: [{ params }] })}>{inner}</DrillCount>
          );
        },
      };
    });
  }

  /**
   * Row click: open the panel with the records behind every count of that row (plus the row's
   * own fields). Rows with nothing to drill into keep the plain summary panel.
   */
  function openRow(row, tableKey, tableColumns) {
    const lists = drillMetrics(active, tableKey)
      .filter((metric) => Number(row[metric]) > 0)
      .map((metric) => {
        const params = drillParams(active, tableKey, metric, row, drillFilters());
        const header = tableColumns.find((c) => c.key === metric)?.header || metric;
        return params ? { params, heading: `${header}: ${row[metric]}` } : null;
      })
      .filter(Boolean);
    if (!lists.length) {
      setDrawerRow(row);
      return;
    }
    // One list carries its own title; several need the count they belong to.
    if (lists.length === 1) lists[0].heading = undefined;
    const fields = Object.entries(row).filter(
      ([key, value]) => key !== 'id' && key !== 'details' && key !== 'sort' && !key.endsWith('_id') && value != null && typeof value !== 'object'
    );
    setDrill({
      title: drillLabel(row, { header: '' }) || 'Records',
      summary: (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.slice(0, 12).map(([key, value]) => (
            <DetailField
              key={key}
              label={key.replace(/_/g, ' ')}
              value={/(_at|date)$/.test(key) ? formatReportDate(value) : String(value)}
            />
          ))}
        </div>
      ),
      lists,
    });
  }

  const tableRows = tableRowsForReport(active, payload);
  const baseColumns = columnsForReport(active);
  const columns = canEditCoverage
    ? baseColumns.map((col) => {
        if (col.key === 'sales_poc' || col.key === 'our_poc') {
          return {
            ...col,
            render: (row) => (
              <CoveragePersonCell
                row={row}
                field="owner_id"
                people={coveragePeople}
                saving={savingCoverageId === coverageRowAccountId(row)}
                onSave={saveCoverageField}
              />
            ),
          };
        }
        if (col.key === 'brought_by') {
          return {
            ...col,
            render: (row) => (
              <CoveragePersonCell
                row={row}
                field="origin_owner_id"
                people={coveragePeople}
                saving={savingCoverageId === coverageRowAccountId(row)}
                onSave={saveCoverageField}
              />
            ),
          };
        }
        return col;
      })
    : baseColumns;
  const chartRows = chartDataForReport(active, payload);
  // The coverage charts count every row of the selected view, so name the bars after that
  // view instead of a fixed "…w/o reqs / submissions" label that is wrong for the other views.
  const COVERAGE_BAR_NAME = {
    all: 'Active clients',
    with_requirements: 'Clients with requirements',
    no_active: 'Clients without requirements',
    active: 'Active vendors',
    inactive: 'Inactive vendors',
    has_live: 'Vendors with live submissions',
  };
  const chartBars = chartBarsForReport(active).map((bar) =>
    isClientsWithoutReqs
      ? { ...bar, name: COVERAGE_BAR_NAME[coverageBucket] || bar.name }
      : isRvg
        ? { ...bar, name: COVERAGE_BAR_NAME[rvgActivity] || bar.name }
        : bar
  );
  const sections =
    active === 'aging'
      ? agingSections(payload)
      : active === 'hr'
        ? hrSections(payload)
        : active === 'joinings'
          ? joiningsSections(payload)
          : active === 'bda-reports'
            ? bdaReportsSections(payload)
            : active === 'sales-reports'
              ? salesReportsSections(payload)
              : active === 'recruiter-reports'
                ? recruiterReportsSections(payload)
                : [];
  const hrSection = isHr ? sections.find((s) => s.key === hrTab) || sections[0] : null;
  const joiningsSection = isJoinings ? sections.find((s) => s.key === joiningsTab) || sections[0] : null;
  const bdaReportsSection = isBdaReports ? sections.find((s) => s.key === bdaReportsTab) || sections[0] : null;
  const salesReportsSection = isSalesReports
    ? sections.find((s) => s.key === salesReportsTab) || sections[0]
    : null;
  const recruiterReportsSection = isRecruiterReports
    ? sections.find((s) => s.key === recruiterReportsTab) || sections[0]
    : null;
  const tablesSection = isBdaReports
    ? bdaReportsSection
    : isRecruiterReports
      ? recruiterReportsSection
      : salesReportsSection;
  // Count cell reveals the per-source split (Bench 3 · Vendor 2 · Market 1) on hover.
  const hrColumns = (hrSection?.columns || []).map((col) =>
    col.key === 'count'
      ? {
          ...col,
          render: (r) => (
            <span
              className="cursor-help underline decoration-dotted decoration-tertiary-300 underline-offset-2"
              title={hrTypeSummary(r.by_type)}
            >
              {r.count}
            </span>
          ),
        }
      : col
  );

  const drawerTitle =
    drawerRow?.requirement?.title ||
    drawerRow?.recruiter?.name ||
    drawerRow?.sales_person?.name ||
    drawerRow?.vendor?.name ||
    drawerRow?.client?.name ||
    drawerRow?.bda?.name ||
    drawerRow?.sales_poc ||
    drawerRow?.group_label ||
    'Row details';

  if (active === 'monthly-review') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SearchableSelect
            className="w-56"
            ariaLabel="Report type"
            value={active}
            onChange={(v) => { setActive(v); setPayload(null); setDrawerRow(null); setDrill(null); }}
            searchPlaceholder="Search reports�"
            options={available.map((r) => ({ value: r.key, label: r.label }))}
          />
        </div>
        <MonthlyReview />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
          <SearchableSelect
            className="w-56"
            ariaLabel="Report type"

            value={active}
            onChange={(v) => {
              setActive(v);
              // Clear immediately: the next render (before the new report's fetch
              // resolves) would otherwise build this report's columns from the
              // previous report's still-in-state rows — mismatched shapes crash
              // React the moment an object-valued field (a hover-breakdown map)
              // lands in a plain cell.
              setPayload(null);
              setIndividualId('');
              setCoveragePocId('');
              setCoverageBroughtById('');
              setCoverageBucket('all');
              setRvgVendorId('');
              setRvgPocId('');
              setRvgBroughtById('');
              setRvgActivity('active');
              setHrSourcerId('');
              setHrInterviewerId('');
              setHrSource('');
              setHrTab('sourcing');
              setJoiningsTab('by_sourcer');
              setTtsClientId('');
              setTtsRequirementId('');
              setTtsSourcerId('');
              setTtsSearch('');
              setTtsSearchApplied('');
              setBdaReportsAccountId('');
              setBdaReportsAccountType('');
              setSalesReportsAccountId('');
              setDrawerRow(null);
              setDrill(null);
            }}
            searchPlaceholder="Search reports…"
            options={available.map((r) => ({ value: r.key, label: r.label }))}
          />
          <Can user={user} capability="exportReports">
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-2 text-sm font-medium text-tertiary-700 shadow-soft transition-colors hover:bg-canvas-muted disabled:opacity-50"
                onClick={() => exportReport('xlsx')}
                disabled={exporting}
                aria-label="Export Excel"
              >
                <ExcelIcon />
                Excel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-tertiary-100 bg-white px-3 py-2 text-sm font-medium text-tertiary-700 shadow-soft transition-colors hover:bg-canvas-muted disabled:opacity-50"
                onClick={() => exportReport('pdf')}
                disabled={exporting}
                aria-label="Export PDF"
              >
                <PdfIcon />
                PDF
              </button>
            </>
          </Can>
      </div>

      <FilterBar
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        showDatePresets={active !== 'aging' && !isCoverage}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={(v) => {
          setDatePreset('custom');
          setDateFrom(v);
        }}
        onDateToChange={(v) => {
          setDatePreset('custom');
          setDateTo(v);
        }}
        showDepartment={showDept && !isExplorer && !isCoverage && !isDateOnly}
        departments={departments}
        departmentId={departmentId}
        onDepartmentChange={setDepartmentId}
        showIndividual={showIndividual}
        individuals={individuals}
        individualId={individualId}
        onIndividualChange={setIndividualId}
      >
        {isHr && (
          <>
            <SearchableSelect
              className="w-40"
              allowClear
              ariaLabel="Filter by sourcing type"
              value={hrSource}
              onChange={setHrSource}
              placeholder="Type: All"
              searchPlaceholder="Search type…"
              options={HR_SOURCE_OPTIONS}
            />
            <SearchableSelect
              className="w-48"
              allowClear
              ariaLabel="Filter by sourcer"
              value={hrSourcerId}
              onChange={setHrSourcerId}
              placeholder="Sourcer: All"
              searchPlaceholder="Search people…"
              options={hrPeople}
            />
            <SearchableSelect
              className="w-48"
              allowClear
              ariaLabel="Filter by interviewer"
              value={hrInterviewerId}
              onChange={setHrInterviewerId}
              placeholder="Interviewer: All"
              searchPlaceholder="Search people…"
              options={hrPeople}
            />
          </>
        )}
        {isTimeToSubmit && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setTtsSearchApplied(ttsSearch.trim());
              }}
              className="flex"
            >
              <input
                value={ttsSearch}
                onChange={(e) => setTtsSearch(e.target.value)}
                placeholder="Candidate name…"
                className="w-44 rounded-l-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-sm text-tertiary-800 placeholder:text-tertiary-400 focus:border-primary-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
              <button
                type="submit"
                className="rounded-r-lg border border-l-0 border-tertiary-100 bg-[#EEF5FC] px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#D8E8F6]"
              >
                Search
              </button>
            </form>
            <SearchableSelect
              className="w-48"
              allowClear
              ariaLabel="Filter by client"
              value={ttsClientId}
              onChange={setTtsClientId}
              placeholder="Client: All"
              searchPlaceholder="Search clients…"
              options={ttsClients}
            />
            <SearchableSelect
              className="w-56"
              allowClear
              ariaLabel="Filter by requirement"
              value={ttsRequirementId}
              onChange={setTtsRequirementId}
              placeholder="Requirement: All"
              searchPlaceholder="Search requirements…"
              options={ttsRequirements}
            />
            <SearchableSelect
              className="w-48"
              allowClear
              ariaLabel="Filter by sourcer"
              value={ttsSourcerId}
              onChange={setTtsSourcerId}
              placeholder="Sourcer: All"
              searchPlaceholder="Search people…"
              options={hrPeople}
            />
          </>
        )}
        {isBdaReports && (
          <>
            <SearchableSelect
              className="w-48"
              allowClear
              ariaLabel="Filter by account"
              value={bdaReportsAccountId}
              onChange={setBdaReportsAccountId}
              placeholder="Account: All"
              searchPlaceholder="Search accounts…"
              options={bdaReportsAccounts}
            />
            <SearchableSelect
              className="w-40"
              allowClear
              ariaLabel="Filter by account type"
              value={bdaReportsAccountType}
              onChange={setBdaReportsAccountType}
              placeholder="Type: All"
              searchPlaceholder="Search type…"
              options={[
                { value: 'client', label: 'Client' },
                { value: 'vendor', label: 'Vendor' },
                { value: 'unclassified', label: 'Unclassified' },
              ]}
            />
          </>
        )}
        {isSalesReports && (
          <SearchableSelect
            className="w-48"
            allowClear
            ariaLabel="Filter by client"
            value={salesReportsAccountId}
            onChange={setSalesReportsAccountId}
            placeholder="Client: All"
            searchPlaceholder="Search clients…"
            options={salesReportsAccounts}
          />
        )}
        {showCoveragePeople && (
          <>
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by Brought by"
              value={coverageBroughtById}
              onChange={setCoverageBroughtById}
              placeholder="All (brought by)"
              searchPlaceholder="Search people…"
              options={broughtByPeople.map((person) => ({ value: person.id, label: person.name }))}
            />
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by Sales POC"
              value={coveragePocId}
              onChange={setCoveragePocId}
              placeholder="All (Sales POC)"
              searchPlaceholder="Search people…"
              options={salesPocPeople.map((person) => ({ value: person.id, label: person.name }))}
            />
          </>
        )}
        {isRvg && (
          <>
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by vendor"
              value={rvgVendorId}
              onChange={setRvgVendorId}
              placeholder="All vendors"
              searchPlaceholder="Search vendors…"
              options={rvgVendors.map((v) => ({ value: v.id, label: v.name }))}
            />
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by our POC"
              value={rvgPocId}
              onChange={setRvgPocId}
              placeholder="All (our POC)"
              searchPlaceholder="Search people…"
              options={ourPocPeople.map((person) => ({ value: person.id, label: person.name }))}
            />
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by Brought by"
              value={rvgBroughtById}
              onChange={setRvgBroughtById}
              placeholder="All (brought by)"
              searchPlaceholder="Search people…"
              options={broughtByPeople.map((person) => ({ value: person.id, label: person.name }))}
            />
          </>
        )}
        {active === 'aging' && (
          <label className="flex items-center gap-2 text-xs text-tertiary-500">
            Threshold days
            <input
              type="number"
              min="1"
              value={thresholdDays}
              onChange={(e) => setThresholdDays(e.target.value)}
              className="w-20 rounded-xl border px-2 py-1.5 text-sm"
            />
          </label>
        )}
        {isExplorer && (
          <>
            <input
              value={explorerSearch}
              onChange={(e) => setExplorerSearch(e.target.value)}
              placeholder="Search requirement or client…"
              className="rounded-xl border bg-white px-3 py-2 text-sm text-tertiary-700"
            />
            <SearchableSelect
              className="w-40"
              allowClear
              ariaLabel="Requirement status"
              value={explorerStatus}
              onChange={setExplorerStatus}
              placeholder="All statuses"
              searchPlaceholder="Search status…"
              options={[
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'on_hold', label: 'On hold' },
                { value: 'closed', label: 'Closed' },
                { value: 'dropped', label: 'Dropped' },
              ]}
            />
            <label className="flex items-center gap-2 text-xs text-tertiary-500">
              <input
                type="checkbox"
                checked={explorerStuckOnly}
                onChange={(e) => setExplorerStuckOnly(e.target.checked)}
              />
              Stuck only
            </label>
            <label className="flex items-center gap-2 text-xs text-tertiary-500">
              <input
                type="checkbox"
                checked={explorerPastSlaOnly}
                onChange={(e) => setExplorerPastSlaOnly(e.target.checked)}
              />
              Past SLA only
            </label>
            <label className="flex items-center gap-2 text-xs text-tertiary-500">
              Threshold days
              <input
                type="number"
                min="1"
                value={thresholdDays}
                onChange={(e) => setThresholdDays(e.target.value)}
                className="w-20 rounded-xl border px-2 py-1.5 text-sm"
              />
            </label>
          </>
        )}
        {active === 'closure' && (
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="rounded-xl border bg-white px-3 py-2 text-sm text-tertiary-700"
            aria-label="Group by"
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
            <option value="client">Client</option>
            <option value="recruiter">Recruiter</option>
          </select>
        )}
      </FilterBar>

      {isClientsWithoutReqs && (
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-soft sm:p-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-tertiary-500">View</p>
              <p className="mt-0.5 text-sm text-tertiary-600">
                Clients in the active stage, by whether they have an open requirement
              </p>
            </div>
            {!loading && (
              <span className="rounded-full bg-canvas-muted px-2.5 py-1 text-xs font-medium text-tertiary-600">
                {tableRows.length} shown
              </span>
            )}
          </div>
          <div
            className="grid gap-2 grid-cols-1 sm:grid-cols-3"
            role="tablist"
            aria-label="Active client coverage"
          >
            {[
              {
                key: 'all',
                label: 'All active clients',
                hint: 'Every client in the active stage',
                Icon: LayoutGrid,
              },
              {
                key: 'with_requirements',
                label: 'Has requirements',
                hint: '≥1 requirement open, in progress or on hold',
                Icon: Briefcase,
              },
              {
                key: 'no_active',
                label: 'No requirements',
                hint: 'No active requirement - closed / dropped only, or never had one',
                Icon: CircleAlert,
              },
            ].map(({ key, label, hint, Icon }) => {
              const selected = coverageBucket === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setCoverageBucket(key)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                    selected
                      ? 'border-primary-300 bg-primary-50 shadow-soft ring-1 ring-primary-200'
                      : 'border-tertiary-100 bg-canvas-muted/40 hover:border-tertiary-200 hover:bg-white'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      selected ? 'bg-primary-600 text-white' : 'bg-white text-tertiary-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold ${
                        selected ? 'text-primary-800' : 'text-tertiary-800'
                      }`}
                    >
                      {label}
                    </span>
                    <span className={`mt-0.5 block text-xs ${selected ? 'text-primary-700/80' : 'text-tertiary-500'}`}>
                      {hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isRvg && (
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-soft sm:p-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-tertiary-500">View</p>
              <p className="mt-0.5 text-sm text-tertiary-600">
                Active-stage vendors; &quot;inactive&quot; = no candidate currently in a live submission
              </p>
            </div>
            {!loading && (
              <span className="rounded-full bg-canvas-muted px-2.5 py-1 text-xs font-medium text-tertiary-600">
                {tableRows.length} shown
              </span>
            )}
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3" role="tablist" aria-label="Vendor gap activity">
            {[
              {
                key: 'active',
                label: 'Active vendors',
                hint: 'Every vendor account in the active stage',
                Icon: Building2,
              },
              {
                key: 'inactive',
                label: 'Inactive vendors',
                hint: 'No candidate currently in an open submission (sourced → BGV)',
                Icon: CircleAlert,
              },
              {
                key: 'has_live',
                label: 'With live submissions',
                hint: 'Difference: active-stage vendors that currently have a live candidate',
                Icon: FileText,
              },
            ].map(({ key, label, hint, Icon }) => {
              const selected = rvgActivity === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setRvgActivity(key)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                    selected
                      ? 'border-primary-300 bg-primary-50 shadow-soft ring-1 ring-primary-200'
                      : 'border-tertiary-100 bg-canvas-muted/40 hover:border-tertiary-200 hover:bg-white'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      selected ? 'bg-primary-600 text-white' : 'bg-white text-tertiary-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold ${
                        selected ? 'text-primary-800' : 'text-tertiary-800'
                      }`}
                    >
                      {label}
                    </span>
                    <span className={`mt-0.5 block text-xs ${selected ? 'text-primary-700/80' : 'text-tertiary-500'}`}>
                      {hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {chartRows.length > 0 && <ReportChart reportKey={active} chartRows={chartRows} chartBars={chartBars} />}

      {isHr ? (
        <div className="space-y-4">
          <div
            className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            role="tablist"
            aria-label="HR report tables"
          >
            {sections.map((section) => {
              const selected = hrSection?.key === section.key;
              const { hint, Icon } = HR_TAB_META[section.key] || {};
              return (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setHrTab(section.key)}
                  className={`relative flex items-start gap-3 rounded-xl border px-3 py-3 pr-14 text-left transition-colors ${
                    selected
                      ? 'border-primary-300 bg-primary-50 shadow-soft ring-1 ring-primary-200'
                      : 'border-tertiary-100 bg-canvas-muted/40 hover:border-tertiary-200 hover:bg-white'
                  }`}
                >
                  {Icon && (
                    <span
                      className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        selected ? 'bg-primary-600 text-white' : 'bg-white text-tertiary-500'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold ${selected ? 'text-primary-800' : 'text-tertiary-800'}`}
                    >
                      {section.title}
                    </span>
                    <span className={`mt-0.5 block text-xs ${selected ? 'text-primary-700/80' : 'text-tertiary-500'}`}>
                      {hint}
                    </span>
                  </span>
                  <span
                    className={`absolute right-2 top-2 min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${
                      selected ? 'bg-primary-600 text-white' : 'bg-tertiary-100 text-tertiary-700'
                    }`}
                  >
                    {sectionTabBadge(section)}
                  </span>
                </button>
              );
            })}
          </div>

          {!loading && <HrChart section={hrSection} />}

          <DataTable
            columns={withDrill(hrColumns, hrSection?.key)}
            rows={hrSection?.rows || []}
            loading={loading}
            emptyLabel="No rows for this range"
            onRowClick={(row) => openRow(row, hrSection?.key, hrColumns)}
          />
        </div>
      ) : isJoinings ? (
        <div className="space-y-4">
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3" role="tablist" aria-label="Joinings tables">
            {sections.map((section) => {
              const selected = joiningsSection?.key === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setJoiningsTab(section.key)}
                  className={`relative rounded-xl border px-3 py-2.5 pr-12 text-left text-sm font-semibold transition-colors ${
                    selected
                      ? 'border-primary-300 bg-primary-50 text-primary-800 shadow-soft ring-1 ring-primary-200'
                      : 'border-tertiary-100 bg-canvas-muted/40 text-tertiary-800 hover:border-tertiary-200 hover:bg-white'
                  }`}
                >
                  {section.title}
                  <span
                    className={`absolute right-2 top-2 min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${
                      selected ? 'bg-primary-600 text-white' : 'bg-tertiary-100 text-tertiary-700'
                    }`}
                  >
                    {section.count ?? section.rows.length}
                  </span>
                </button>
              );
            })}
          </div>
          <DataTable
            columns={withDrill(joiningsSection?.columns || [], joiningsSection?.key)}
            rows={joiningsSection?.rows || []}
            loading={loading}
            emptyLabel="No joinings in this range"
            onRowClick={(row) => openRow(row, joiningsSection?.key, joiningsSection?.columns || [])}
          />
        </div>
      ) : isBdaReports || isSalesReports || isRecruiterReports ? (
        <div className="space-y-4">
          <div
            className="grid gap-2 grid-cols-1 sm:grid-cols-3 lg:grid-cols-5"
            role="tablist"
            aria-label={
              isBdaReports ? 'BDA report tables' : isRecruiterReports ? 'Recruiter report tables' : 'Sales report tables'
            }
          >
            {sections.map((section) => {
              const activeSection = tablesSection;
              const selected = activeSection?.key === section.key;
              const setTab = isBdaReports
                ? setBdaReportsTab
                : isRecruiterReports
                  ? setRecruiterReportsTab
                  : setSalesReportsTab;
              return (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(section.key)}
                  className={`relative rounded-xl border px-3 py-2.5 pr-12 text-left text-sm font-semibold transition-colors ${
                    selected
                      ? 'border-primary-300 bg-primary-50 text-primary-800 shadow-soft ring-1 ring-primary-200'
                      : 'border-tertiary-100 bg-canvas-muted/40 text-tertiary-800 hover:border-tertiary-200 hover:bg-white'
                  }`}
                >
                  {section.title}
                  <span
                    className={`absolute right-2 top-2 min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${
                      selected ? 'bg-primary-600 text-white' : 'bg-tertiary-100 text-tertiary-700'
                    }`}
                  >
                    {sectionTabBadge(section)}
                  </span>
                </button>
              );
            })}
          </div>
          <DataTable
            columns={withDrill(
              tablesSection?.columns || [],
              tablesSection?.key
            )}
            rows={tablesSection?.rows || []}
            loading={loading}
            emptyLabel="No rows for this range"
            onRowClick={(row) =>
              openRow(
                row,
                tablesSection?.key,
                tablesSection?.columns || []
              )
            }
          />
        </div>
      ) : isTimeToSubmit ? (
        <DataTable
          columns={timeToSubmitColumns()}
          rows={timeToSubmitRows(payload)}
          loading={loading}
          emptyLabel="No candidates sourced in this range"
        />
      ) : active === 'aging' ? (
        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.key} className="space-y-2">
              <h2 className="font-heading text-sm font-semibold text-tertiary-800">
                {section.title}
                <span className="ml-2 text-xs font-normal text-tertiary-500">{section.rows.length}</span>
              </h2>
              <DataTable
                columns={section.columns}
                rows={section.rows}
                loading={loading}
                emptyLabel="None"
                onRowClick={setDrawerRow}
              />
            </section>
          ))}
        </div>
      ) : (
        <DataTable
          columns={withDrill(columns)}
          rows={tableRows}
          loading={loading}
          emptyLabel="No rows for this range"
          onRowClick={(row) => openRow(row, 'main', columns)}
        />
      )}

      <DrilldownDrawer request={drill} onClose={() => setDrill(null)} />

      <Drawer open={Boolean(drawerRow)} title={drawerTitle} onClose={() => setDrawerRow(null)} size="md" tone="info">
        {drawerRow && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(drawerRow)
                .filter(([key, value]) => key !== 'id' && key !== 'details' && typeof value !== 'object')
                .slice(0, 16)
                .map(([key, value]) => (
                  <DetailField
                    key={key}
                    label={key.replace(/_/g, ' ')}
                    value={/(_at|date)$/.test(key) ? formatReportDate(value) : String(value)}
                  />
                ))}
            </div>
            {Array.isArray(drawerRow.details) && drawerRow.details.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-tertiary-800">Detail rows</h3>
                <ul className="space-y-2">
                  {drawerRow.details.map((detail, index) => (
                    <li key={detail.profile?.id || index} className="rounded-xl border px-3 py-2 text-sm">
                      <div className="font-medium text-tertiary-900">{detail.profile?.name || 'Profile'}</div>
                      <div className="text-xs text-tertiary-500">
                        {detail.requirement?.title} · {detail.client?.name} · {detail.recruiter?.name}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Can user={user} capability="exportReports">
              <p className="text-xs text-tertiary-400">
                Edit flows stay on entity detail pages. This panel is for report drill-down.
              </p>
            </Can>
          </div>
        )}
      </Drawer>
    </div>
  );
}
