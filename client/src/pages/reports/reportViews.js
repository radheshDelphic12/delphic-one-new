import { createElement } from 'react';
import { Link } from 'react-router-dom';
import { rangeForPreset } from '../../lib/datePresets.js';

/**
 * Report view helpers for RD-114 — columns, charts, and role visibility.
 */

// `hidden: true` keeps the report fully functional (routes, columns, charts, export)
// but drops it from the Reports page dropdown. Only the two coverage-gap reports are
// surfaced in the picker right now — the rest stay reachable in code / by direct call.
export const ALL_REPORTS = [
  { key: 'pipeline-explorer', label: 'Pipeline explorer', roles: ['admin', 'sales', 'recruiter', 'bda'], hidden: true },
  { key: 'bda-performance', label: 'BDA performance', roles: ['admin'], hidden: true },
  { key: 'sales-performance', label: 'Sales performance', roles: ['admin'], hidden: true },
  { key: 'recruiter-performance', label: 'Recruiter performance', roles: ['admin', 'sales', 'recruiter'], hidden: true },
  { key: 'vendor-performance', label: 'Vendor performance', roles: ['admin', 'sales'], hidden: true },
  { key: 'client-performance', label: 'Client performance', roles: ['admin', 'sales'], hidden: true },
  { key: 'aging', label: 'Aging / SLA', roles: ['admin', 'sales'], hidden: true },
  { key: 'closure', label: 'Closure report', roles: ['admin', 'sales'], hidden: true },
  { key: 'clients-without-requirements', label: 'Clients w/o requirements', roles: ['admin', 'sales', 'bda'] },
  { key: 'recruiter-vendor-gaps', label: 'Recruiter-vendor gaps', roles: ['admin', 'recruiter'] },
  { key: 'hr', label: 'HR reports', roles: ['admin'] },
  { key: 'joinings', label: 'Joinings', roles: ['admin', 'sales'] },
  { key: 'time-to-submit', label: 'Time to submit', roles: ['admin', 'sales'] },
  { key: 'bda-reports', label: 'BDA reports', roles: ['admin', 'bda'] },
  { key: 'sales-reports', label: 'Sales reports', roles: ['admin', 'sales'] },
];

export function reportsForRole(role) {
  return ALL_REPORTS.filter((r) => !r.hidden && r.roles.includes(role));
}

export function defaultDateRange() {
  const range = rangeForPreset('this_month');
  return { dateFrom: range.date_from, dateTo: range.date_to };
}

function cell(value) {
  if (value == null) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? value : value.toFixed(1);
  return String(value);
}

/**
 * Human-readable date for every date shown in the Reports section, e.g.
 * "08 September 26". Accepts a `YYYY-MM-DD` string (parsed as a local date so it
 * doesn't shift a day across time zones), an ISO string, or a Date.
 */
export function formatReportDate(value) {
  if (!value) return '—';
  let date;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    date = new Date(y, m - 1, d);
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return String(value);
  const dd = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'long' });
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd} ${month} ${yy}`;
}

/** Compact variant for dense chart axes, e.g. "08 Sep 26". */
export function formatReportDateShort(value) {
  return formatReportDate(value).replace(/^(\d{2}) (\w{3})\w* (\d{2})$/, '$1 $2 $3');
}

export function personName(row, key) {
  return row?.[key]?.name || '—';
}

/**
 * Report cell that opens the underlying record. Falls back to plain text when
 * the row carries no id, so a report never shows a dead link.
 * `base` is the route prefix ('/accounts', '/requirements'); `labelKey` picks the text field.
 */
export function entityLink(row, key, base, labelKey = 'name') {
  const entity = row?.[key];
  const label = entity?.[labelKey] || '—';
  if (!entity?.id) return label;
  return createElement(
    Link,
    { to: `${base}/${entity.id}`, className: 'text-primary-600 hover:underline', onClick: (event) => event.stopPropagation() },
    label
  );
}

export function columnsForReport(reportKey) {
  if (reportKey === 'pipeline-explorer') {
    return [
      { key: 'client', header: 'Client', render: (r) => entityLink(r, 'client', '/accounts') },
      { key: 'bda', header: 'BDA', render: (r) => r.bda?.name || '—' },
      { key: 'requirement', header: 'Requirement', render: (r) => entityLink(r, 'requirement', '/requirements', 'title') },
      { key: 'status', header: 'Status', render: (r) => r.requirement?.status || '—' },
      { key: 'sales', header: 'Sales', render: (r) => r.sales_owner?.name || '—' },
      {
        key: 'recruiters',
        header: 'Recruiters',
        render: (r) => (r.recruiters || []).map((person) => person.name).join(', ') || '—',
      },
      { key: 'subs', header: 'Subs', render: (r) => r.submissions?.total ?? 0 },
      { key: 'active', header: 'Active', render: (r) => r.submissions?.active ?? 0 },
      { key: 'closed', header: 'Closed', render: (r) => r.submissions?.closed ?? 0 },
      { key: 'days_open', header: 'Days open', render: (r) => cell(r.aging?.days_open) },
      { key: 'stuck', header: 'Stuck', render: (r) => (r.aging?.is_stuck ? 'Yes' : 'No') },
      {
        key: 'sla',
        header: 'SLA overdue',
        render: (r) => (r.aging?.sla_overdue_by_days > 0 ? r.aging.sla_overdue_by_days : '—'),
      },
    ];
  }
  if (reportKey === 'bda-performance') {
    return [
      { key: 'name', header: 'BDA', render: (r) => personName(r, 'bda') },
      { key: 'leads_created', header: 'Leads' },
      { key: 'leads_in_meeting', header: 'In meeting' },
      { key: 'leads_converted_active', header: 'Converted' },
      { key: 'leads_dropped', header: 'Dropped' },
      { key: 'conversion_rate_percentage', header: 'Conv %', render: (r) => cell(r.conversion_rate_percentage) },
      { key: 'vendors_created', header: 'Vendors added' },
      { key: 'leads_unclassified', header: 'Unclassified' },
      { key: 'leads_via_linkedin', header: 'Via LinkedIn' },
      { key: 'avg_days_lead_to_meeting', header: 'Avg d lead→meeting', render: (r) => cell(r.avg_days_lead_to_meeting) },
      { key: 'clients_active_current', header: 'Active clients (now)' },
      { key: 'vendors_active_current', header: 'Active vendors (now)' },
      { key: 'stuck_leads_current', header: 'Stuck 7d+ (now)' },
    ];
  }
  if (reportKey === 'recruiter-performance') {
    return [
      { key: 'name', header: 'Recruiter', render: (r) => personName(r, 'recruiter') },
      { key: 'profiles_sourced', header: 'Sourced' },
      { key: 'submissions_total', header: 'Subs' },
      { key: 'submissions_in_interview', header: 'Interview' },
      { key: 'submissions_closed', header: 'Closed' },
      { key: 'closures_count', header: 'Joinings' },
      { key: 'backout_rate_percentage', header: 'Backout %', render: (r) => cell(r.backout_rate_percentage) },
      { key: 'avg_days_total_cycle', header: 'Avg cycle d', render: (r) => cell(r.avg_days_total_cycle) },
      { key: 'interviews_total', header: 'Interviews' },
      { key: 'rounds_missing_mandatory_count', header: 'Missing mandatory rounds' },
    ];
  }
  if (reportKey === 'sales-performance') {
    return [
      { key: 'name', header: 'Sales', render: (r) => personName(r, 'sales_person') },
      { key: 'requirements_opened', header: 'Reqs opened' },
      { key: 'requirements_in_progress', header: 'In progress' },
      { key: 'requirements_closed', header: 'Req closed' },
      { key: 'closures_count', header: 'Joinings' },
      { key: 'total_closed_revenue', header: 'Revenue', render: (r) => cell(r.total_closed_revenue) },
      { key: 'total_margin_generated', header: 'Margin', render: (r) => cell(r.total_margin_generated) },
      { key: 'clients_active', header: 'Active clients' },
      { key: 'avg_closure_days', header: 'Avg close d', render: (r) => cell(r.avg_closure_days) },
      { key: 'submissions_missing_hr_cto_ceo_round', header: 'Missing HR/CTO/CEO round' },
    ];
  }
  if (reportKey === 'vendor-performance') {
    return [
      { key: 'name', header: 'Vendor', render: (r) => entityLink(r, 'vendor', '/accounts') },
      { key: 'profiles_submitted', header: 'Submitted' },
      { key: 'profiles_interviewed', header: 'Interviewed' },
      { key: 'profiles_closed', header: 'Closed' },
      { key: 'profiles_backout', header: 'Backout' },
      { key: 'backout_rate_percentage', header: 'Backout %', render: (r) => cell(r.backout_rate_percentage) },
      { key: 'total_margin', header: 'Margin', render: (r) => cell(r.total_margin) },
      { key: 'reliability_score', header: 'Reliability', render: (r) => cell(r.reliability_score) },
    ];
  }
  if (reportKey === 'client-performance') {
    return [
      { key: 'name', header: 'Client', render: (r) => entityLink(r, 'client', '/accounts') },
      { key: 'requirements_total', header: 'Reqs' },
      { key: 'requirements_open', header: 'Open' },
      { key: 'requirements_closed', header: 'Closed' },
      { key: 'submissions_total', header: 'Subs' },
      { key: 'submissions_closed', header: 'Subs closed' },
      { key: 'avg_days_to_close', header: 'Avg d to close', render: (r) => cell(r.avg_days_to_close) },
      { key: 'total_revenue', header: 'Revenue', render: (r) => cell(r.total_revenue) },
      { key: 'total_margin', header: 'Margin', render: (r) => cell(r.total_margin) },
      { key: 'stuck_requirements_count', header: 'Stuck reqs' },
    ];
  }
  if (reportKey === 'closure') {
    return [
      { key: 'group_label', header: 'Group' },
      { key: 'closures_count', header: 'Closures' },
      { key: 'total_revenue', header: 'Revenue', render: (r) => cell(r.total_revenue) },
      { key: 'total_margin', header: 'Margin', render: (r) => cell(r.total_margin) },
      { key: 'avg_cycle_days', header: 'Avg cycle d', render: (r) => cell(r.avg_cycle_days) },
      { key: 'details', header: 'Details', render: (r) => (r.details || []).length },
    ];
  }
  if (reportKey === 'clients-without-requirements') {
    return [
      { key: 'client', header: 'Client', render: (r) => entityLink(r, 'client', '/accounts') },
      { key: 'stage', header: 'Stage', render: (r) => cell(r.stage) },
      { key: 'brought_by', header: 'Brought by', render: (r) => personName(r, 'brought_by') },
      { key: 'sales_poc', header: 'Sales POC', render: (r) => personName(r, 'sales_poc') },
      { key: 'active_requirements_count', header: 'Active requirements', render: (r) => cell(r.active_requirements_count) },
      { key: 'created_at', header: 'Created', render: (r) => formatReportDate(r.created_at) },
      { key: 'days_idle', header: 'Days idle', render: (r) => cell(r.days_idle) },
    ];
  }
  if (reportKey === 'recruiter-vendor-gaps') {
    return [
      { key: 'vendor', header: 'Vendor', render: (r) => entityLink(r, 'vendor', '/accounts') },
      { key: 'our_poc', header: 'Our POC', render: (r) => personName(r, 'our_poc') },
      { key: 'brought_by', header: 'Brought by', render: (r) => personName(r, 'brought_by') },
      { key: 'profiles_sourced', header: 'Sourced' },
      { key: 'profiles_submitted', header: 'Submitted' },
      {
        key: 'last_sourced_at',
        header: 'Last sourced',
        render: (r) => formatReportDate(r.last_sourced_at),
      },
      { key: 'days_since_sourced', header: 'Days since', render: (r) => cell(r.days_since_sourced) },
    ];
  }
  return [];
}

export function tableRowsForReport(reportKey, data) {
  if (!data) return [];
  if (['aging', 'hr', 'joinings', 'time-to-submit'].includes(reportKey)) return [];
  if (reportKey === 'pipeline-explorer') {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    return rows.map((row, index) => ({
      id: row.id || `explorer-${index}`,
      ...row,
    }));
  }
  if (!Array.isArray(data)) return [];
  if (reportKey === 'recruiter-vendor-gaps') {
    return data.map((row, index) => ({
      id: row.vendor?.id || `vendor-${index}`,
      ...row,
    }));
  }
  return data.map((row, index) => ({
    id: row.recruiter?.id || row.sales_person?.id || row.bda?.id || row.vendor?.id || row.client?.id || row.group_label || String(index),
    ...row,
  }));
}

export function agingSections(data) {
  if (!data || typeof data !== 'object') return [];
  return [
    {
      key: 'stuck_leads',
      title: 'Stuck leads',
      columns: [
        { key: 'name', header: 'Account', render: (r) => entityLink(r, 'account', '/accounts') },
        { key: 'stage', header: 'Stage', render: (r) => r.account?.stage },
        { key: 'owner', header: 'BDA', render: (r) => r.owner?.name || r.bda?.name },
        { key: 'requirements_count', header: 'Reqs' },
        { key: 'days_in_stage', header: 'Days in stage' },
      ],
      rows: (data.stuck_leads || []).map((r, i) => ({ id: r.account?.id || `lead-${i}`, ...r })),
    },
    {
      key: 'stuck_requirements',
      title: 'Stuck requirements',
      columns: [
        { key: 'title', header: 'Requirement', render: (r) => entityLink(r, 'requirement', '/requirements', 'title') },
        { key: 'client', header: 'Client', render: (r) => entityLink(r, 'client', '/accounts') },
        { key: 'bda', header: 'BDA', render: (r) => r.bda?.name },
        { key: 'status', header: 'Status', render: (r) => r.requirement?.status },
        { key: 'owner', header: 'Sales', render: (r) => r.sales_owner?.name },
        {
          key: 'recruiters',
          header: 'Recruiters',
          render: (r) => (r.recruiters || []).map((person) => person.name).join(', ') || '—',
        },
        { key: 'days_open', header: 'Days open' },
        { key: 'days_since_last_activity', header: 'Days idle' },
        { key: 'submissions_count', header: 'Subs' },
      ],
      rows: (data.stuck_requirements || []).map((r, i) => ({ id: r.requirement?.id || `req-${i}`, ...r })),
    },
    {
      key: 'stuck_submissions',
      title: 'Stuck submissions',
      columns: [
        { key: 'profile', header: 'Candidate', render: (r) => entityLink(r, 'profile', '/profiles') },
        { key: 'requirement', header: 'Job', render: (r) => entityLink(r, 'requirement', '/requirements', 'title') },
        { key: 'client', header: 'Client', render: (r) => entityLink(r, 'client', '/accounts') },
        { key: 'bda', header: 'BDA', render: (r) => r.bda?.name },
        { key: 'sales', header: 'Sales', render: (r) => r.sales_owner?.name },
        { key: 'stage', header: 'Stage', render: (r) => r.submission?.stage },
        { key: 'recruiter', header: 'Recruiter', render: (r) => r.recruiter?.name },
        { key: 'days_in_current_stage', header: 'Days in stage' },
      ],
      rows: (data.stuck_submissions || []).map((r, i) => ({ id: r.submission?.id || `sub-${i}`, ...r })),
    },
    {
      key: 'past_sla_requirements',
      title: 'Past SLA',
      columns: [
        { key: 'title', header: 'Requirement', render: (r) => entityLink(r, 'requirement', '/requirements', 'title') },
        { key: 'client', header: 'Client', render: (r) => entityLink(r, 'client', '/accounts') },
        { key: 'bda', header: 'BDA', render: (r) => r.bda?.name },
        { key: 'sales', header: 'Sales', render: (r) => r.sales_owner?.name },
        {
          key: 'recruiters',
          header: 'Recruiters',
          render: (r) => (r.recruiters || []).map((person) => person.name).join(', ') || '—',
        },
        { key: 'sla_days', header: 'SLA days', render: (r) => r.requirement?.sla_days },
        { key: 'days_open', header: 'Days open' },
        { key: 'overdue_by_days', header: 'Overdue by' },
      ],
      rows: (data.past_sla_requirements || []).map((r, i) => ({ id: r.requirement?.id || `sla-${i}`, ...r })),
    },
  ];
}

// HR report - server returns { tables: [{ key, title, rows }] }; column defs live here.
const hrDate = (header) => ({ key: 'date', header, render: (r) => formatReportDate(r.date) });

/** "Bench 3 · Vendor 2 · Market 1" from a { label: count } map. */
export function hrTypeSummary(byType) {
  const parts = Object.entries(byType || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} ${n}`);
  return parts.join(' · ') || '—';
}

// Count column carries `by_type` on the row; ReportsPage swaps in a hover cell.
const hrCount = { key: 'count', header: 'Count' };

const HR_COLUMNS = {
  sourcing: [
    { key: 'sourcer', header: 'Sourcer' },
    hrCount,
    hrDate('Sourcing date'),
  ],
  submissions: [
    { key: 'sourcer', header: 'Sourcer' },
    hrCount,
    hrDate('Submission date'),
  ],
  round1_by_sourcer: [
    { key: 'sourcer', header: 'Sourcer' },
    { key: 'scheduled', header: 'Scheduled' },
    { key: 'completed', header: 'Completed' },
    { key: 'shortlisted', header: 'Shortlisted' },
    hrDate('Round date'),
  ],
  round1_by_interviewer: [
    { key: 'interviewer', header: 'Interviewer' },
    { key: 'scheduled', header: 'Scheduled' },
    { key: 'completed', header: 'Completed' },
    { key: 'shortlisted', header: 'Shortlisted' },
    hrDate('Round date'),
  ],
};

export function hrSections(data) {
  if (!data || !Array.isArray(data.tables)) return [];
  return data.tables.map((t) => ({
    key: t.key,
    title: t.title,
    columns: HR_COLUMNS[t.key] || fallbackColumns(t.rows?.[0]),
    rows: (t.rows || []).map((r, i) => ({ id: `${t.key}-${i}`, ...r })),
  }));
}

// --- Joinings + Time to submit ----------------------------------------------
const JOININGS_COLUMNS = {
  by_sourcer: [
    { key: 'month', header: 'Month' },
    { key: 'sourcer', header: 'Sourcer' },
    { key: 'joinings', header: 'Joinings' },
  ],
  by_interviewer: [
    { key: 'month', header: 'Month' },
    { key: 'interviewer', header: 'Interviewer' },
    { key: 'l1', header: 'L1' },
    { key: 'l2', header: 'L2' },
    { key: 'total', header: 'Total' },
  ],
  by_vendor: [
    { key: 'month', header: 'Month' },
    { key: 'vendor', header: 'Vendor' },
    { key: 'joinings', header: 'Joinings' },
  ],
  by_sales_poc: [
    { key: 'month', header: 'Month' },
    { key: 'sales_poc', header: 'Sales POC' },
    { key: 'joinings', header: 'Joinings' },
  ],
};

export function joiningsSections(data) {
  if (!data || !Array.isArray(data.tables)) return [];
  return data.tables.map((t) => ({
    key: t.key,
    title: t.title,
    columns: JOININGS_COLUMNS[t.key] || fallbackColumns(t.rows?.[0]),
    rows: (t.rows || []).map((r, i) => ({ id: `${t.key}-${i}`, ...r })),
  }));
}

// --- BDA + Sales daily activity reports ------------------------------------
const reportDate = (header) => ({ key: 'date', header, render: (r) => formatReportDate(r.date) });

/** "Client 3 · Vendor 1" from a { label: count } map; sorted desc. */
export function countSummary(map) {
  const parts = Object.entries(map || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} ${n}`);
  return parts.join(' · ') || '—';
}

// A count cell that reveals a { label: count } breakdown on hover.
// eslint-disable-next-line react/display-name
const hoverCount = (mapKey) => (r) => {
  const map = r[mapKey];
  if (!map || !Object.keys(map).length) return r.count ?? 0;
  return createElement(
    'span',
    { title: countSummary(map), className: 'cursor-help border-b border-dotted border-tertiary-300' },
    r.count ?? 0
  );
};

const clientLink = (r) =>
  r.client_id
    ? createElement(Link, { to: `/accounts/${r.client_id}`, className: 'text-primary-600 hover:underline' }, r.client)
    : r.client || '—';

const BDA_REPORTS_COLUMNS = {
  accounts_created: [
    { key: 'bda', header: 'BDA' },
    { key: 'count', header: 'Count', render: hoverCount('by_type') },
    reportDate('Date'),
  ],
  meetings_scheduled: [
    { key: 'bda', header: 'BDA' },
    { key: 'meetings_scheduled', header: 'Meetings scheduled' },
    { key: 'converted_to_active', header: 'Converted to active' },
    reportDate('Date'),
  ],
  meetings_conversion: [
    { key: 'bda', header: 'BDA' },
    { key: 'meetings_scheduled', header: 'Meetings scheduled' },
    { key: 'converted_to_active', header: 'Converted to active' },
  ],
  requirements_brought: [
    { key: 'bda', header: 'BDA' },
    { key: 'client', header: 'Client', render: clientLink },
    { key: 'requirement', header: 'Requirement' },
    reportDate('Date'),
  ],
  requirements_brought_counts: [
    { key: 'bda', header: 'BDA' },
    { key: 'count', header: 'Count', render: hoverCount('clients') },
    reportDate('Date'),
  ],
};

const SALES_REPORTS_COLUMNS = {
  requirements_created: [
    { key: 'sales_poc', header: 'Sales POC' },
    { key: 'count', header: 'Count', render: hoverCount('clients') },
    reportDate('Date'),
  ],
  meetings_attended: [
    { key: 'sales_poc', header: 'Sales POC' },
    { key: 'count', header: 'Count' },
    reportDate('Date'),
  ],
  profiles_submitted_to_client: [
    { key: 'sales_poc', header: 'Sales POC' },
    { key: 'count', header: 'Count', render: hoverCount('profiles') },
    reportDate('Date'),
  ],
};

// Per-table tab badge: for the daily aggregate tables the useful headline number
// is the SUM of the count column (e.g. total meetings this month), not the number
// of grouped rows. Detail tables (one row = one record) fall back to row count.
const TAB_BADGE_SUM_FIELD = {
  accounts_created: 'count',
  requirements_brought_counts: 'count',
  requirements_created: 'count',
  meetings_attended: 'count',
  profiles_submitted_to_client: 'count',
  meetings_scheduled: 'meetings_scheduled',
  meetings_conversion: 'meetings_scheduled',
};

export function sectionTabBadge(section) {
  const field = TAB_BADGE_SUM_FIELD[section?.key];
  if (!field) return section?.rows?.length ?? 0;
  return (section.rows || []).reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
}

// A defined column set may not match the rows in hand — e.g. a stale response
// for a previously active report landing after the tab switched. Never let an
// object-valued field (a hover-breakdown map, a details array) reach a <td>
// unrendered; React throws on that and takes the whole page down.
function fallbackColumns(row) {
  return Object.keys(row || {})
    .filter((k) => k !== 'id' && typeof row[k] !== 'object')
    .map((k) => ({ key: k, header: k }));
}

function tablesToSections(columnsByKey, data) {
  if (!data || !Array.isArray(data.tables)) return [];
  return data.tables.map((t) => ({
    key: t.key,
    title: t.title,
    columns: columnsByKey[t.key] || fallbackColumns(t.rows?.[0]),
    rows: (t.rows || []).map((r, i) => ({ id: `${t.key}-${i}`, ...r })),
  }));
}

export function bdaReportsSections(data) {
  return tablesToSections(BDA_REPORTS_COLUMNS, data);
}

export function salesReportsSections(data) {
  return tablesToSections(SALES_REPORTS_COLUMNS, data);
}

const fmtStamp = (iso) => {
  if (!iso) return '—';
  return `${formatReportDate(iso)} ${new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
};

// A duration cell that reveals its lower/upper bound timestamps on hover.
const durCell = (key, fromLabel, toLabel) => {
  // eslint-disable-next-line react/display-name
  return (r) => {
    const cell = r[key] || {};
    const text = cell.label || '—';
    if (!cell.from && !cell.to) return text;
    const title = `${fromLabel}: ${fmtStamp(cell.from)}\n${toLabel}: ${fmtStamp(cell.to)}`;
    return createElement(
      'span',
      { title, className: 'cursor-help border-b border-dotted border-tertiary-300' },
      text
    );
  };
};

export function timeToSubmitColumns() {
  return [
    {
      key: 'requirement_created_at',
      header: 'Req created',
      render: (r) =>
        r.requirement_created_at
          ? `${formatReportDate(r.requirement_created_at)} ${new Date(r.requirement_created_at).toLocaleTimeString(
              'en-US',
              { hour: '2-digit', minute: '2-digit' }
            )}`
          : '—',
    },
    { key: 'requirement', header: 'Requirement' },
    { key: 'client', header: 'Client' },
    { key: 'candidate', header: 'Candidate' },
    { key: 'sourcer', header: 'Sourcer' },
    { key: 'type', header: 'Type' },
    { key: 'vendor_name', header: 'Vendor' },
    {
      key: 'req_to_submission',
      header: 'Requirement → Submission',
      render: durCell('req_to_submission', 'Requirement created', 'Submission created'),
    },
    {
      key: 'req_to_r1',
      header: 'Requirement → R1',
      render: durCell('req_to_r1', 'Requirement created', 'R1 scheduled'),
    },
    {
      key: 'req_to_submitted',
      header: 'Requirement → Submitted to client',
      render: durCell('req_to_submitted', 'Requirement created', 'Submitted to client'),
    },
  ];
}

export function timeToSubmitRows(data) {
  return (data?.rows || []).map((r, i) => ({ id: r.id || `tts-${i}`, ...r }));
}

export function chartDataForReport(reportKey, data) {
  if (reportKey === 'pipeline-explorer' && data && Array.isArray(data.rows)) {
    const stuck = data.rows.filter((row) => row.aging?.is_stuck).length;
    const sla = data.rows.filter((row) => row.aging?.sla_overdue_by_days > 0).length;
    return [
      { label: 'Rows', value: data.rows.length },
      { label: 'Stuck', value: stuck },
      { label: 'Past SLA', value: sla },
    ];
  }
  if (reportKey === 'aging' && data && typeof data === 'object') {
    return [
      { label: 'Stuck leads', value: (data.stuck_leads || []).length },
      { label: 'Stuck reqs', value: (data.stuck_requirements || []).length },
      { label: 'Stuck subs', value: (data.stuck_submissions || []).length },
      { label: 'Past SLA', value: (data.past_sla_requirements || []).length },
    ];
  }
  if (!Array.isArray(data) || data.length === 0) return [];

  if (reportKey === 'bda-performance') {
    return data.map((r) => ({
      label: r.bda?.name || 'BDA',
      leads: r.leads_created || 0,
      meeting: r.leads_in_meeting || 0,
      converted: r.leads_converted_active || 0,
      stuck: r.stuck_leads_current || 0,
    }));
  }
  if (reportKey === 'recruiter-performance') {
    return data.map((r) => ({
      label: r.recruiter?.name || 'Recruiter',
      sourced: r.profiles_sourced || 0,
      submissions: r.submissions_total || 0,
      closed: r.submissions_closed || 0,
      interviews: r.interviews_total || 0,
    }));
  }
  if (reportKey === 'sales-performance') {
    return data.map((r) => ({
      label: r.sales_person?.name || 'Sales',
      requirements: r.requirements_opened || 0,
      closed: r.requirements_closed || 0,
      closures: r.closures_count || 0,
      margin: Number(r.total_margin_generated || 0),
    }));
  }
  if (reportKey === 'vendor-performance') {
    return data.map((r) => ({
      label: r.vendor?.name || 'Vendor',
      submitted: r.profiles_submitted || 0,
      interviewed: r.profiles_interviewed || 0,
      closed: r.profiles_closed || 0,
      margin: Number(r.total_margin || 0),
    }));
  }
  if (reportKey === 'closure') {
    return data.map((r) => ({
      label: r.group_label || 'Group',
      closures: r.closures_count || 0,
      revenue: Number(r.total_revenue || 0),
      margin: Number(r.total_margin || 0),
    }));
  }
  if (reportKey === 'client-performance') {
    return data.map((r) => ({
      label: r.client?.name || 'Client',
      requirements: r.requirements_total || 0,
      closed: r.requirements_closed || 0,
      revenue: Number(r.total_revenue || 0),
    }));
  }
  if (reportKey === 'clients-without-requirements') {
    return countBy(data, (r) => r.sales_poc?.name || 'Unassigned').map(([label, count]) => ({ label, clients: count }));
  }
  if (reportKey === 'recruiter-vendor-gaps') {
    return countBy(data, (r) => r.our_poc?.name || 'Unassigned').map(([label, count]) => ({ label, vendors: count }));
  }
  return [];
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()];
}

export function chartTypeForReport(reportKey) {
  if (reportKey === 'aging' || reportKey === 'pipeline-explorer') return 'pie';
  if (reportKey === 'closure') return 'line';
  return 'bar';
}

export function chartBarsForReport(reportKey) {
  if (reportKey === 'aging' || reportKey === 'pipeline-explorer') {
    return [{ dataKey: 'value', name: 'Count', fill: '#3763f4' }];
  }
  if (reportKey === 'bda-performance') {
    return [
      { dataKey: 'leads', name: 'Leads', fill: '#3763f4' },
      { dataKey: 'meeting', name: 'In meeting', fill: '#0ea5e9' },
      { dataKey: 'converted', name: 'Converted', fill: '#16a34a' },
      { dataKey: 'stuck', name: 'Stuck 7d+', fill: '#d97706' },
    ];
  }
  if (reportKey === 'recruiter-performance') {
    return [
      { dataKey: 'sourced', name: 'Sourced', fill: '#3763f4' },
      { dataKey: 'submissions', name: 'Subs', fill: '#5a87fa' },
      { dataKey: 'closed', name: 'Closed', fill: '#16a34a' },
      { dataKey: 'interviews', name: 'Interviews', fill: '#d97706' },
    ];
  }
  if (reportKey === 'sales-performance') {
    return [
      { dataKey: 'requirements', name: 'Reqs opened', fill: '#3763f4' },
      { dataKey: 'closed', name: 'Req closed', fill: '#5a87fa' },
      { dataKey: 'closures', name: 'Joinings', fill: '#16a34a' },
    ];
  }
  if (reportKey === 'vendor-performance') {
    return [
      { dataKey: 'submitted', name: 'Submitted', fill: '#3763f4' },
      { dataKey: 'interviewed', name: 'Interviewed', fill: '#5a87fa' },
      { dataKey: 'closed', name: 'Closed', fill: '#16a34a' },
    ];
  }
  if (reportKey === 'closure') {
    return [
      { dataKey: 'closures', name: 'Closures', fill: '#3763f4' },
      { dataKey: 'margin', name: 'Margin', fill: '#16a34a' },
    ];
  }
  if (reportKey === 'client-performance') {
    return [
      { dataKey: 'requirements', name: 'Reqs', fill: '#3763f4' },
      { dataKey: 'closed', name: 'Closed', fill: '#16a34a' },
      { dataKey: 'revenue', name: 'Revenue', fill: '#d97706' },
    ];
  }
  if (reportKey === 'clients-without-requirements') {
    return [{ dataKey: 'clients', name: 'Clients w/o reqs', fill: '#d97706' }];
  }
  if (reportKey === 'recruiter-vendor-gaps') {
    return [{ dataKey: 'vendors', name: 'Vendors w/o submissions', fill: '#d97706' }];
  }
  return [];
}
