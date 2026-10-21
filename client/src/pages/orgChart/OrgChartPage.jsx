import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import TeamChart, { regroupForTeamChart } from './TeamChart.jsx';

/**
 * Seniority tiers for visual grouping. There is no rank/level field on
 * Designation today — this is a client-side heuristic over the free-text
 * designation name (falling back to the system role when no designation is
 * set), used only for card accent color and sibling ordering. It never
 * changes the actual reporting line, which is still `manager_id` — see the
 * note rendered under the view toggle.
 */
const ROLE_TIERS = [
  { key: 'executive', label: 'Executive / Board', match: /chief executive|\bceo\b|\bfounder\b|\bchairman\b|\bchairperson\b|\bboard\b/i, border: 'border-l-violet-600', text: 'text-violet-800' },
  { key: 'clevel', label: 'C-Level / Director', match: /\bc[a-z]{1,3}o\b|\bchief\b|\bdirector\b/i, border: 'border-l-indigo-600', text: 'text-indigo-800' },
  { key: 'vp', label: 'VP / Dept. Head', match: /\bvp\b|vice president|head of|department head/i, border: 'border-l-blue-600', text: 'text-blue-800' },
  { key: 'manager', label: 'Team Lead / Manager', match: /\blead\b|\bmanager\b|\bmgr\b/i, border: 'border-l-teal-600', text: 'text-teal-800' },
  { key: 'senior', label: 'Senior / Associate', match: /\bsenior\b|\bsr\.?\b|\bassociate\b/i, border: 'border-l-slate-500', text: 'text-slate-700' },
  { key: 'junior', label: 'Junior', match: /\bjunior\b|\bjr\.?\b|\bintern\b|\btrainee\b/i, border: 'border-l-tertiary-300', text: 'text-tertiary-600' },
];
const DEFAULT_TIER_INDEX = 4; // Senior / Associate — neutral individual-contributor default
const ROLE_FALLBACK_TIER_INDEX = { admin: 1, sales: 4, recruiter: 4, bda: 4 };
const ROLE_LABEL = { admin: 'Administrator', sales: 'Sales', recruiter: 'Recruiter', bda: 'Business Development' };

function tierIndexFor(node) {
  const title = node.designation?.name;
  if (title) {
    const idx = ROLE_TIERS.findIndex((t) => t.match.test(title));
    if (idx !== -1) return idx;
  }
  return ROLE_FALLBACK_TIER_INDEX[node.role] ?? DEFAULT_TIER_INDEX;
}

function flattenTree(roots) {
  const flat = [];
  const walk = (node) => {
    flat.push(node);
    node.direct_reports?.forEach(walk);
  };
  roots.forEach(walk);
  return flat;
}

function getRoleTitle(node) {
  return node.designation?.name || ROLE_LABEL[node.role] || 'Team member';
}

/** Role / Department views draw the same team chart; only the grouping changes. */
function chartDataFor(data, viewMode) {
  if (viewMode === 'role') {
    return regroupForTeamChart(data, {
      keyOf: (n) => n.designation?.id || `role:${getRoleTitle(n)}`,
      labelOf: (n) => getRoleTitle(n),
      orderOf: (n) => tierIndexFor(n),
    });
  }
  if (viewMode === 'department') {
    return regroupForTeamChart(data, {
      keyOf: (n) => n.department?.id || '__unassigned__',
      labelOf: (n) => n.department?.name || 'Unassigned',
      orderOf: (n) => (n.department?.id ? 0 : 1),
    });
  }
  return data;
}
const HINTS = {
  role: 'Grouped by designation. Reporting lines are unchanged: each group hangs off the manager of its most senior member.',
  department: 'Grouped by department. Reporting lines are unchanged: each department hangs off the manager of its most senior member.',
};

/**
 * How many people sit in each category of the current view: per department,
 * per seniority tier, or per HR team (plus contractors / not in a team).
 */
function categoryCounts(roots, viewMode, teams = []) {
  const people = flattenTree(roots);
  const tally = new Map();
  const add = (key, label, order = 0) => {
    const row = tally.get(key) || { key, label, count: 0, order };
    row.count += 1;
    tally.set(key, row);
  };
  if (viewMode === 'department') {
    for (const p of people) add(p.department?.id || '__none__', p.department?.name || 'Unassigned', p.department ? 0 : 1);
  } else if (viewMode === 'role') {
    for (const p of people) {
      const i = tierIndexFor(p);
      add(ROLE_TIERS[i].key, ROLE_TIERS[i].label, i);
    }
  } else {
    return teamCounts(people, teams);
  }
  return [...tally.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * Team view: per HR team, who is on it now vs who is still to come —
 *   current   — people on the team (lead included), terminated excluded
 *   new_hires — of those, not joined yet (pending onboarding)
 *   open      — the team's open positions (HR Settings → Teams)
 *   target    — current + open, the team's size once hiring is done
 * Contractors and people in no team are listed with current / new hires only.
 */
function teamCounts(people, teams) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const leadTeam = new Map(teams.filter((t) => t.lead_membership_id).map((t) => [t.lead_membership_id, t]));
  const tally = new Map(teams.map((t) => [t.id, { key: t.id, label: t.name, order: t.sort_order ?? 0, current: 0, new_hires: 0, open: t.open_positions || 0, isTeam: true }]));
  const row = (key, label, order) => {
    if (!tally.has(key)) tally.set(key, { key, label, order, current: 0, new_hires: 0, open: 0, isTeam: false });
    return tally.get(key);
  };
  for (const p of people) {
    if (p.employment_status === 'terminated') continue;
    const team = teamById.get(p.team_id) || leadTeam.get(p.id);
    const r = team ? tally.get(team.id) : p.worker_type === 'contractor' ? row('__contractor__', 'Contractors', 1e6) : row('__none__', 'Not in a team', 1e6 + 1);
    r.current += 1;
    if (p.employment_status === 'pending_onboarding') r.new_hires += 1;
  }
  return [...tally.values()]
    .filter((r) => r.current > 0 || r.open > 0)
    .map((r) => ({ ...r, count: r.current, target: r.current + r.open }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function TeamCounts({ rows }) {
  const teamRows = rows.filter((r) => r.isTeam);
  const other = rows.filter((r) => !r.isTeam);
  const sum = (k) => teamRows.reduce((s, r) => s + r[k], 0);
  const cell = 'px-3 py-1.5 text-right tabular-nums';
  return (
    <div className="overflow-x-auto rounded-xl border border-tertiary-200 bg-white">
      <table className="min-w-full text-xs" aria-label="Headcount and hiring per team">
        <thead className="bg-tertiary-50 text-tertiary-500">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Team</th>
            <th className={`${cell} font-medium`} title="People on the team now, lead included">Current</th>
            <th className={`${cell} font-medium`} title="Of the current people, not joined yet (pending onboarding)">New hires</th>
            <th className={`${cell} font-medium`} title="Open positions still to fill (HR Settings → Teams)">Open</th>
            <th className={`${cell} font-medium`} title="Current + open: the team size once hiring is done">Target</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-tertiary-100 text-tertiary-700">
          {teamRows.map((r) => (
            <tr key={r.key}>
              <td className="px-3 py-1.5 font-medium text-tertiary-900">{r.label}</td>
              <td className={cell}>{r.current}</td>
              <td className={cell}>{r.new_hires || <span className="text-tertiary-300">0</span>}</td>
              <td className={`${cell} ${r.open ? 'font-semibold text-violet-700' : ''}`}>{r.open || <span className="text-tertiary-300">0</span>}</td>
              <td className={`${cell} font-semibold text-tertiary-900`}>{r.target}</td>
            </tr>
          ))}
          {other.map((r) => (
            <tr key={r.key} className="text-tertiary-500">
              <td className="px-3 py-1.5">{r.label}</td>
              <td className={cell}>{r.current}</td>
              <td className={cell}>{r.new_hires || <span className="text-tertiary-300">0</span>}</td>
              <td className={cell}>—</td>
              <td className={cell}>—</td>
            </tr>
          ))}
        </tbody>
        {teamRows.length > 1 && (
          <tfoot className="border-t border-tertiary-200 bg-tertiary-50 font-semibold text-tertiary-900">
            <tr>
              <td className="px-3 py-1.5">All teams</td>
              <td className={cell}>{sum('current')}</td>
              <td className={cell}>{sum('new_hires')}</td>
              <td className={cell}>{sum('open')}</td>
              <td className={cell}>{sum('target')}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function CategoryCounts({ roots, viewMode, teams }) {
  const rows = categoryCounts(roots, viewMode, teams);
  if (!rows.length) return null;
  if (viewMode === 'team') return <TeamCounts rows={rows} />;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="People per category">
      {rows.map((r) => (
        <span key={r.key} className="inline-flex items-center gap-1.5 rounded-full border border-tertiary-200 bg-white px-2.5 py-1 text-xs text-tertiary-700">
          {r.label}
          <span className="rounded-full bg-primary-50 px-1.5 text-[11px] font-semibold tabular-nums text-primary-700">{r.count}</span>
        </span>
      ))}
    </div>
  );
}

const VIEW_MODES = [
  { key: 'team', label: 'Team View' },
  { key: 'role', label: 'Designation / Role View' },
  { key: 'department', label: 'Department View' },
];

/**
 * Org-level chart. When `groupOrgs` is passed (Group Overview), renders one
 * combined tree rooted at the holding group, branching into each subsidiary,
 * each branching into that company's own reporting tree, instead of fetching
 * /org-chart itself. Otherwise fetches the current org's tree and roots it
 * under a synthetic company node, so there is always exactly one top node —
 * even when several employees have no manager set (this repo's own seed
 * data is exactly that case). Every branch — company, department, or person
 * — can be collapsed to keep a deep chart readable, and a Designation/Role
 * vs. Department toggle re-groups the same underlying data without another
 * network call.
 */
export default function OrgChartPage({ groupOrgs }) {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [includeTerminated, setIncludeTerminated] = useState(false);
  // Team view (teams, leads, direct-reports boxes) is the default everywhere; at group level it draws one company at a time.
  const viewModes = VIEW_MODES;
  const [viewMode, setViewMode] = useState('team');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!groupOrgs);

  useEffect(() => {
    if (groupOrgs) return;
    let cancelled = false;
    setLoading(true);
    apiClient
      .get('/org-chart', { params: { include_terminated: includeTerminated } })
      .then(({ data: res }) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err) => {
        if (!cancelled) pushError(apiErrorMessage(err, 'Failed to load org chart'), 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [includeTerminated, groupOrgs, pushError]);

  const viewToggle = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-tertiary-200 bg-white p-0.5 shadow-sm">
        {viewModes.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setViewMode(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === key ? 'bg-primary-600 text-white shadow-sm' : 'text-tertiary-600 hover:bg-tertiary-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (groupOrgs) {
    if (groupOrgs.length === 0) {
      return <EmptyState icon={UserRound} title="No subsidiaries yet" description="Org charts appear here once a company has employees." />;
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-tertiary-500">
          {user?.name} manages every company of the group. Each company shows its teams and people above its name.
        </p>
        <TeamChart group={{ companies: groupOrgs, adminName: user?.name || 'Group Super Admin' }} hint="Group Super Admin at the bottom, then each company, then its teams and people." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {viewToggle}
        <div className="flex items-center gap-3">
          <p className="text-sm text-tertiary-500">{data ? `${data.headcount} people` : ''}</p>
          <label className="flex items-center gap-2 text-sm text-tertiary-700">
            <input type="checkbox" checked={includeTerminated} onChange={(e) => setIncludeTerminated(e.target.checked)} />
            Include terminated
          </label>
        </div>
      </div>
      {loading && <Skeleton className="h-40 w-full" />}
      {!loading && data?.roots.length > 0 && <CategoryCounts roots={data.roots} viewMode={viewMode} teams={data.teams || []} />}
      {!loading && data?.roots.length === 0 && (
        <EmptyState icon={UserRound} title="No org chart yet" description="Set a manager on employee records (People → Directory) to build the reporting tree." />
      )}
      {!loading && data?.roots.length > 0 && (
        <TeamChart data={chartDataFor(data, viewMode)} companyName={user?.active_org?.name || 'Company'} hint={HINTS[viewMode]} />
      )}
    </div>
  );
}
