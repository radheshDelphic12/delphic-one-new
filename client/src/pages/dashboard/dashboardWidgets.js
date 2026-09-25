/**
 * Role-specific home dashboard widgets (RD-113).
 * Values come only from GET /dashboard/summary — no invented series.
 */

import {
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  ClipboardList,
  Send,
  Target,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';

export const KPI_THEMES = ['blue', 'green', 'purple', 'orange', 'red', 'cyan'];

const KPI_ICONS = [Target, Briefcase, Send, Calendar, TrendingUp, Building2, Users, UserCheck];

function withKpiMeta(stats) {
  return stats.map((stat, index) => ({
    ...stat,
    icon: stat.icon || KPI_ICONS[index % KPI_ICONS.length],
    theme: stat.theme || KPI_THEMES[index % KPI_THEMES.length],
  }));
}

// Submission stages that count as "active" (everything not terminal) — mirrors the
// dashboard `submissions_active` server query (`stage NOT IN closed/rejected/backout`).
const ACTIVE_SUBMISSION_STAGES =
  'sourced,internal_screening,submitted_to_client,interview_scheduled,interview_result,offer_sent,bgv';

/**
 * Where a KPI tile drills into. The href reproduces the *exact* population the
 * tile counted, so what the user lands on matches the number they clicked:
 *   - role scoping the target list doesn't apply itself (BDA accounts, sales
 *     submissions) is added as an explicit param;
 *   - month/week-bounded tiles pass an IST `*_from` ISO timestamp.
 * ctx: { role, userId, monthStartIso, weekStartIso }.
 */
export function kpiHref(key, ctx = {}) {
  const { role, userId, monthStartIso } = ctx;
  // Accounts list has no role auto-scope — a BDA tile must carry owner_id.
  const acctOwner = role === 'bda' && userId ? `&owner_id=${userId}` : '';
  // Submissions list auto-scopes recruiters only — a sales tile must carry sales_owner_id.
  const subSales = role === 'sales' && userId ? `&sales_owner_id=${userId}` : '';
  const joinedFrom = (iso) => (iso ? `&joined_from=${encodeURIComponent(iso)}` : '');
  const closedFrom = (iso) => (iso ? `&closed_from=${encodeURIComponent(iso)}` : '');

  switch (key) {
    case 'leadsActive':
      return `/accounts?stage=lead${acctOwner}`;
    case 'leadsInMeeting':
      return `/accounts?stage=meeting_scheduled,rescheduled${acctOwner}`;
    case 'clientsActive':
      return `/accounts?type=client&stage=active${acctOwner}`;
    case 'vendorsActive':
      return `/accounts?type=vendor&stage=active${acctOwner}`;
    case 'stuckLeads':
      return `/accounts?stuck=stuck${acctOwner}`;
    case 'requirementsOpen':
      return '/requirements?status=open'; // list auto-scopes sales/recruiter
    case 'requirementsInProgress':
      return '/requirements?status=in_progress';
    case 'requirementsClosed':
      return `/requirements?status=closed${closedFrom(monthStartIso)}`;
    case 'stuckRequirements':
      return '/requirements?stuck=stuck';
    case 'submissionsActive':
      return `/submissions?stage=${ACTIVE_SUBMISSION_STAGES}${subSales}`; // list auto-scopes recruiter
    case 'interviewsThisWeek':
      return '/calendar'; // no list view for "rounds this week" — the calendar is the closest faithful view
    case 'closures':
      return `/submissions?stage=closed${subSales}${joinedFrom(monthStartIso)}`;
    default:
      return '/';
  }
}

export const ROLE_COPY = {
  admin: {
    subtitle: 'Company-wide leads, jobs, pipeline, and aging alerts.',
  },
  bda: {
    subtitle: 'Your owned accounts - leads, meetings, and stuck follow-ups.',
  },
  sales: {
    subtitle: 'Your owned requirements - openings, submissions, and stuck jobs.',
  },
  recruiter: {
    subtitle: 'Assigned jobs and your active submissions / interviews.',
  },
  employee: {
    subtitle: 'Your attendance, leave, timesheets, and payroll in one place.',
  },
};

/**
 * Build KPI cards from real summary fields only.
 */
export function statsForRole(role, summary, ctx = {}) {
  if (!summary) return [];

  // Real totals — the *_count fields; the stuck_* arrays are only the top-5 preview lists.
  const stuckLeads = summary.stuck_leads_count ?? summary.stuck_leads?.length ?? 0;
  const stuckReqs = summary.stuck_requirements_count ?? summary.stuck_requirements?.length ?? 0;

  if (role === 'bda') {
    return withKpiMeta([
      {
        label: 'Active leads',
        value: summary.leads_active ?? 0,
        hint: stuckLeads ? `${stuckLeads} stuck 7d+` : 'In lead stage',
        description:
          'Your owned accounts currently in the "lead" stage (not yet in a scheduled meeting). The badge, when shown, is the count of your lead / meeting-stage accounts with no update for 7+ days.',
        href: kpiHref('leadsActive', { role, ...ctx }),
      },
      {
        label: 'In meeting',
        value: summary.leads_in_meeting ?? 0,
        hint: 'Meeting scheduled',
        description: 'Your owned accounts with a meeting scheduled or rescheduled.',
        href: kpiHref('leadsInMeeting', { role, ...ctx }),
      },
      {
        label: 'Active clients',
        value: summary.clients_active ?? 0,
        hint: 'Stage = active',
        description: 'Your owned client accounts currently at stage = active, as of right now.',
        href: kpiHref('clientsActive', { role, ...ctx }),
      },
      {
        label: 'Active vendors',
        value: summary.vendors_active ?? 0,
        hint: 'Stage = active',
        description: 'Your owned vendor accounts currently at stage = active, as of right now.',
        href: kpiHref('vendorsActive', { role, ...ctx }),
      },
    ]);
  }

  if (role === 'sales') {
    return withKpiMeta([
      {
        label: 'Open requirements',
        value: summary.requirements_open ?? 0,
        hint: stuckReqs ? `${stuckReqs} stuck 7d+` : 'Currently open',
        description:
          'Requirements you own with status = open right now. The badge, when shown, is the count of your open or in-progress requirements with no update for 7+ days (so it can exceed the open-only number above).',
        href: kpiHref('requirementsOpen', { role, ...ctx }),
      },
      {
        label: 'In progress',
        value: summary.requirements_in_progress ?? 0,
        hint: 'Being worked',
        description: 'Requirements you own with status = in_progress right now.',
        href: kpiHref('requirementsInProgress', { role, ...ctx }),
      },
      {
        label: 'Active submissions',
        value: summary.submissions_active ?? 0,
        hint: 'In pipeline',
        description: 'Submissions against your requirements not yet closed, rejected, or backed out.',
        href: kpiHref('submissionsActive', { role, ...ctx }),
      },
      {
        label: 'Interviews this week',
        value: summary.interviews_scheduled_this_week ?? 0,
        hint: 'Scheduled this week',
        description: 'Interview rounds on your requirements completed or scheduled since the start of this week.',
        href: kpiHref('interviewsThisWeek', { role, ...ctx }),
      },
      {
        label: 'Closed this month',
        value: summary.requirements_closed_this_month ?? 0,
        hint: 'Requirements closed',
        description: 'Your requirements whose status became closed since the start of this month.',
        href: kpiHref('requirementsClosed', { role, ...ctx }),
      },
      {
        label: 'Closures this month',
        value: summary.closures_this_month ?? 0,
        hint: 'Joins / seat closures',
        description: 'Submissions on your requirements with an actual joining date this month.',
        href: kpiHref('closures', { role, ...ctx }),
      },
    ]);
  }

  if (role === 'recruiter') {
    return withKpiMeta([
      {
        label: 'Assigned open',
        value: summary.requirements_open ?? 0,
        hint: stuckReqs ? `${stuckReqs} stuck 7d+` : 'Assigned to you',
        description:
          'Requirements assigned to you with status = open right now. The badge, when shown, is the count of your assigned open or in-progress requirements with no update for 7+ days (so it can exceed the open-only number above).',
        href: kpiHref('requirementsOpen', { role, ...ctx }),
      },
      {
        label: 'In progress',
        value: summary.requirements_in_progress ?? 0,
        hint: 'Assigned to you',
        description: 'Requirements assigned to you with status = in_progress right now.',
        href: kpiHref('requirementsInProgress', { role, ...ctx }),
      },
      {
        label: 'Active submissions',
        value: summary.submissions_active ?? 0,
        hint: 'Your pipeline',
        description: 'Submissions you made that are not yet closed, rejected, or backed out.',
        href: kpiHref('submissionsActive', { role, ...ctx }),
      },
      {
        label: 'Interviews this week',
        value: summary.interviews_scheduled_this_week ?? 0,
        hint: 'Scheduled this week',
        description: 'Interview rounds on your submissions completed or scheduled since the start of this week.',
        href: kpiHref('interviewsThisWeek', { role, ...ctx }),
      },
      {
        label: 'Closures this month',
        value: summary.closures_this_month ?? 0,
        hint: 'Joins this month',
        description: 'Your submissions with an actual joining date this month.',
        href: kpiHref('closures', { role, ...ctx }),
      },
    ]);
  }

  return withKpiMeta([
    {
      label: 'Active leads',
      value: summary.leads_active ?? 0,
      hint: 'Company-wide',
      description: 'All accounts company-wide currently in the "lead" stage - any type, including unclassified.',
      icon: Target,
      theme: 'blue',
      href: kpiHref('leadsActive', { role, ...ctx }),
    },
    {
      label: 'Open requirements',
      value: summary.requirements_open ?? 0,
      hint: 'Status = open',
      description: 'All requirements company-wide with status = open right now.',
      icon: Briefcase,
      theme: 'green',
      href: kpiHref('requirementsOpen', { role, ...ctx }),
    },
    {
      label: 'In progress',
      value: summary.requirements_in_progress ?? 0,
      hint: 'Requirements',
      description: 'All requirements company-wide with status = in_progress right now.',
      icon: ClipboardList,
      theme: 'orange',
      href: kpiHref('requirementsInProgress', { role, ...ctx }),
    },
    {
      label: 'Active submissions',
      value: summary.submissions_active ?? 0,
      hint: 'In pipeline',
      description: 'All submissions company-wide not yet closed, rejected, or backed out.',
      icon: Send,
      theme: 'purple',
      href: kpiHref('submissionsActive', { role, ...ctx }),
    },
    {
      label: 'Interviews this week',
      value: summary.interviews_scheduled_this_week ?? 0,
      hint: 'Scheduled this week',
      description: 'Interview rounds completed or scheduled since the start of this week, company-wide.',
      icon: Calendar,
      theme: 'orange',
      href: kpiHref('interviewsThisWeek', { role, ...ctx }),
    },
    {
      label: 'Closures this month',
      value: summary.closures_this_month ?? 0,
      hint: 'Joins this month',
      description: 'All submissions company-wide with an actual joining date this month.',
      icon: TrendingUp,
      theme: 'red',
      href: kpiHref('closures', { role, ...ctx }),
    },
    {
      label: 'Active clients',
      value: summary.clients_active ?? 0,
      hint: 'Stage = active',
      description: 'All client accounts company-wide currently at stage = active, as of right now.',
      icon: Building2,
      theme: 'cyan',
      href: kpiHref('clientsActive', { role, ...ctx }),
    },
    {
      label: 'Active vendors',
      value: summary.vendors_active ?? 0,
      hint: 'Stage = active',
      description: 'All vendor accounts company-wide currently at stage = active, as of right now.',
      icon: Users,
      theme: 'blue',
      href: kpiHref('vendorsActive', { role, ...ctx }),
    },
    {
      label: 'Stuck leads',
      value: stuckLeads,
      hint: 'As of today · 7d+ idle',
      description:
        'Full count of accounts in a lead / meeting-scheduled / rescheduled stage with no update for 7+ days, as of today. This figure is not affected by the dashboard date filter. The panel below lists the 5 oldest.',
      icon: AlertTriangle,
      theme: 'red',
      href: kpiHref('stuckLeads', { role, ...ctx }),
    },
    {
      label: 'Stuck requirements',
      value: stuckReqs,
      hint: 'As of today · 7d+ idle',
      description:
        'Full count of open / in-progress requirements with no update (no stage change or edit) for 7+ days, as of today. This figure is not affected by the dashboard date filter. The panel below lists the 5 most idle.',
      icon: AlertTriangle,
      theme: 'red',
      href: kpiHref('stuckRequirements', { role, ...ctx }),
    },
  ]);
}

/** Friendly labels for funnel stage keys from the API. */
export const FUNNEL_STAGE_LABELS = {
  sourced: 'Sourced',
  screening: 'Screening',
  submitted: 'Submitted',
  interviewing: 'Interview',
  offered: 'Offer',
  bgv: 'BGV',
  closed: 'Closed',
  lead: 'Lead',
  meeting_scheduled: 'Meeting scheduled',
  rescheduled: 'Rescheduled',
  active: 'Active',
  dropped: 'Dropped',
};

export const SUBMISSION_FUNNEL_ORDER = [
  'sourced',
  'screening',
  'submitted',
  'interviewing',
  'offered',
  'bgv',
  'closed',
];

export const ACCOUNT_FUNNEL_ORDER = [
  'lead',
  'meeting_scheduled',
  'rescheduled',
  'active',
  'dropped',
];

/** Dashboard funnel keys → submission list filter values */
export const SUBMISSION_STAGE_FILTER = {
  sourced: 'sourced',
  screening: 'internal_screening',
  submitted: 'submitted_to_client',
  interviewing: 'interview_scheduled',
  offered: 'offer',
  bgv: 'bgv',
  closed: 'closed',
};

export function funnelChartData(funnel, role = 'admin') {
  const order = role === 'bda' ? ACCOUNT_FUNNEL_ORDER : SUBMISSION_FUNNEL_ORDER;
  return order.map((stage) => ({
    stage,
    label: FUNNEL_STAGE_LABELS[stage] || stage,
    count: funnel?.[stage] || 0,
  }));
}

export function stageFilterHref(stage, role) {
  if (role === 'bda') return `/accounts?stage=${encodeURIComponent(stage)}`;
  const filterStage = SUBMISSION_STAGE_FILTER[stage];
  return filterStage ? `/submissions?stage=${encodeURIComponent(filterStage)}` : '/submissions';
}
