import { useEffect, useState } from 'react';
import { AlertTriangle, Building2, ChevronDown, ChevronRight, Layers, Network, Sparkles, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Avatar from '../../components/ui/Avatar.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import TeamChart from './TeamChart.jsx';

function formatDate(value) {
  return value ? new Date(`${value}`.slice(0, 10)).toLocaleDateString() : null;
}

/** New-hire / notice-period indicators live directly on employment_status + notice_end_date. */
function LifecycleBadge({ node }) {
  if (node.employment_status === 'pending_onboarding') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
        <Sparkles className="h-3 w-3" /> New hire
      </span>
    );
  }
  if (node.employment_status === 'notice_period') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        Notice{node.notice_end_date ? ` · ends ${formatDate(node.notice_end_date)}` : ''}
      </span>
    );
  }
  if (node.employment_status === 'on_leave') {
    return <span className="inline-flex items-center rounded-full bg-tertiary-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-tertiary-600">On leave</span>;
  }
  if (node.employment_status === 'terminated') {
    return <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700">Terminated</span>;
  }
  return null;
}

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

/** Highest-ranking first, then alphabetical by name — applied to every sibling group in both view modes. */
function sortByTier(nodes) {
  return [...nodes].sort((a, b) => {
    const diff = tierIndexFor(a) - tierIndexFor(b);
    return diff !== 0 ? diff : (a.person?.name || '').localeCompare(b.person?.name || '');
  });
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

function countDescendants(node, getChildren) {
  const children = getChildren(node) || [];
  return children.reduce((sum, child) => sum + 1 + countDescendants(child, getChildren), 0);
}

/**
 * Department-wise view: the same people, regrouped under a branch per
 * department instead of the org-wide reporting line. A department's own
 * manager_id relationships are preserved *within* that department — anyone
 * whose real manager sits in a different department (or has none) becomes a
 * root inside their department's branch, which is the correct behavior, not
 * a data gap.
 */
function buildDepartmentBranches(roots) {
  const groups = new Map();
  for (const node of flattenTree(roots)) {
    const key = node.department?.id || '__unassigned__';
    const label = node.department?.name || 'Unassigned';
    if (!groups.has(key)) groups.set(key, { key, label, members: [] });
    groups.get(key).members.push(node);
  }
  const branches = [...groups.values()].map(({ key, label, members }) => {
    const memberIds = new Set(members.map((m) => m.id));
    const childrenMap = new Map(members.map((m) => [m.id, []]));
    const deptRoots = [];
    for (const m of members) {
      if (m.manager_id && memberIds.has(m.manager_id)) childrenMap.get(m.manager_id).push(m);
      else deptRoots.push(m);
    }
    return { key, label, count: members.length, roots: deptRoots, getChildren: (n) => childrenMap.get(n.id) || [] };
  });
  branches.sort((a, b) => (a.key === '__unassigned__' ? 1 : b.key === '__unassigned__' ? -1 : a.label.localeCompare(b.label)));
  return branches;
}

/** A single employee card — role/designation is the primary heading; name, department, and avatar sit underneath. */
function PersonCard({ node, hasChildren, collapsed, onToggle, hiddenCount }) {
  const tier = ROLE_TIERS[tierIndexFor(node)];
  const title = getRoleTitle(node);

  return (
    <div className={`org-node-card inline-flex w-64 items-start gap-2 rounded-xl border border-tertiary-100 border-l-4 bg-white p-3 text-left shadow-card ${tier.border}`}>
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 shrink-0 rounded-md p-0.5 text-tertiary-400 transition-colors hover:bg-tertiary-100 hover:text-tertiary-700"
          aria-label={collapsed ? 'Expand direct reports' : 'Collapse direct reports'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      ) : (
        <span className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-bold ${tier.text}`} title={title}>{title}</p>
        <div className="org-node-card__meta mt-2 flex items-center gap-2">
          <Avatar name={node.person.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-tertiary-800" title={node.person.name}>{node.person.name}</p>
            <p className="truncate text-[11px] text-tertiary-500">{node.department?.name || 'No department'}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <LifecycleBadge node={node} />
          {hasChildren && !collapsed && hiddenCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-medium text-primary-700" title="Everyone reporting up to this person">{hiddenCount} {hiddenCount === 1 ? 'person' : 'people'} under</span>
          )}
          {collapsed && hiddenCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-tertiary-100 px-2 py-0.5 text-[10px] font-medium text-tertiary-600">+{hiddenCount} hidden</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The top node of a tree, or a department-group header — styled distinctly from employee cards. */
function EntityCard({ label, sublabel, icon: Icon = Building2, hasChildren, collapsed, onToggle }) {
  return (
    <div className="org-entity-card inline-flex min-w-[13rem] max-w-[16rem] items-center gap-2 rounded-xl border-2 border-primary-600 bg-primary-50 p-3 text-left shadow-card">
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-md p-0.5 text-primary-700 transition-colors hover:bg-primary-100"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <span className="block truncate text-sm font-bold text-primary-900">{label}</span>
        {sublabel && <p className="truncate text-xs text-primary-700">{sublabel}</p>}
      </div>
    </div>
  );
}

/** Recursive branch: a person node plus its (tier-sorted) reports as a nested tree level. `getChildren` lets the department view swap in a department-local report list without mutating the source tree. */
function PersonBranch({ node, getChildren, collapsedIds, onToggle }) {
  const children = getChildren(node) || [];
  const hasChildren = children.length > 0;
  const collapsed = collapsedIds.has(node.id);
  return (
    <li>
      <PersonCard
        node={node}
        hasChildren={hasChildren}
        collapsed={collapsed}
        onToggle={() => onToggle(node.id)}
        hiddenCount={hasChildren ? countDescendants(node, getChildren) : 0}
      />
      {hasChildren && !collapsed && (
        <ul>
          {sortByTier(children).map((child) => (
            <PersonBranch key={child.id} node={child} getChildren={getChildren} collapsedIds={collapsedIds} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

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

/** One org's tree, in either view mode — used for both the single-org chart and each subsidiary in group mode. */
function OrgBranches({ roots, viewMode, branchNamespace, collapsedIds, onToggle }) {
  const defaultGetChildren = (node) => node.direct_reports;

  if (viewMode === 'department') {
    const branches = buildDepartmentBranches(roots);
    if (branches.length === 0) return null;
    return (
      <ul>
        {branches.map((branch) => {
          const branchId = `${branchNamespace}:dept:${branch.key}`;
          const collapsed = collapsedIds.has(branchId);
          return (
            <li key={branchId}>
              <EntityCard label={branch.label} sublabel={`${branch.count} people`} icon={Layers} hasChildren collapsed={collapsed} onToggle={() => onToggle(branchId)} />
              {!collapsed && branch.roots.length > 0 && (
                <ul>
                  {sortByTier(branch.roots).map((root) => (
                    <PersonBranch key={root.id} node={root} getChildren={branch.getChildren} collapsedIds={collapsedIds} onToggle={onToggle} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul>
      {sortByTier(roots).map((root) => (
        <PersonBranch key={root.id} node={root} getChildren={defaultGetChildren} collapsedIds={collapsedIds} onToggle={onToggle} />
      ))}
    </ul>
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
  // Team view draws one org's HR teams; the group chart spans companies, so it keeps the tree views.
  const viewModes = groupOrgs ? VIEW_MODES.filter((m) => m.key !== 'team') : VIEW_MODES;
  const [viewMode, setViewMode] = useState(groupOrgs ? 'role' : 'team');
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
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

  function toggle(id) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      {viewMode !== 'team' && (
        <p className="text-xs text-tertiary-400">Strictly role-based reporting order remains intact; department view simply re-groups the same employees without changing reporting lines.</p>
      )}
    </div>
  );

  if (groupOrgs) {
    if (groupOrgs.length === 0) {
      return <EmptyState icon={UserRound} title="No subsidiaries yet" description="Org charts appear here once a company has employees." />;
    }
    return (
      <div className="space-y-3">
        {viewToggle}
        <div className="overflow-x-auto pb-4">
          <ul className="org-tree w-max min-w-full">
            <li>
              <EntityCard label="Group" sublabel={`${groupOrgs.length} companies`} icon={Network} hasChildren collapsed={collapsedIds.has('root')} onToggle={() => toggle('root')} />
              {!collapsedIds.has('root') && (
                <ul>
                  {groupOrgs.map((company) => {
                    const companyId = `company:${company.org.id}`;
                    const collapsed = collapsedIds.has(companyId);
                    return (
                      <li key={company.org.id}>
                        <EntityCard label={company.org.name} sublabel={`${company.headcount} people`} icon={Building2} hasChildren={company.roots.length > 0} collapsed={collapsed} onToggle={() => toggle(companyId)} />
                        {!collapsed && company.roots.length > 0 && (
                          <OrgBranches roots={company.roots} viewMode={viewMode} branchNamespace={companyId} collapsedIds={collapsedIds} onToggle={toggle} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          </ul>
        </div>
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
      {!loading && data?.roots.length > 0 && viewMode === 'team' && (
        <TeamChart data={data} companyName={user?.active_org?.name || 'Company'} />
      )}
      {!loading && data?.roots.length > 0 && viewMode !== 'team' && (
        <div className="overflow-x-auto pb-4">
          <ul className="org-tree w-max min-w-full">
            <li>
              <EntityCard label={user?.active_org?.name || 'Company'} sublabel={`${data.headcount} people`} hasChildren collapsed={collapsedIds.has('root')} onToggle={() => toggle('root')} />
              {!collapsedIds.has('root') && (
                <OrgBranches roots={data.roots} viewMode={viewMode} branchNamespace="root" collapsedIds={collapsedIds} onToggle={toggle} />
              )}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
