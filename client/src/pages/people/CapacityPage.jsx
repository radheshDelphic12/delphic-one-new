import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Gauge, History, Save } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useLeadClientOptions, useOrgMembershipOptions, useTeamOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import MultiSelectDropdown from '../../components/ui/MultiSelectDropdown.jsx';
import ProjectsHover from './ProjectsHover.jsx';

const TABS = [
  { key: 'capacity', label: 'Team Capacity', icon: Gauge },
  { key: 'ending', label: 'Projects Ending Soon', icon: CalendarClock },
  { key: 'movements', label: 'Movement History', icon: History },
];

const CAPACITY_STATUS = {
  available: ['Available', 'green'],
  near_capacity: ['Near capacity', 'amber'],
  at_capacity: ['At capacity', 'blue'],
  over_capacity: ['Over capacity', 'red'],
  no_members: ['No members', 'gray'],
  unassigned: ['No team', 'gray'],
};

const CHANGE_TYPE = {
  team_and_project: 'Team + project',
  team: 'Team',
  project: 'Project',
  joined_project: 'Joined project',
  left_project: 'Left project',
};

// Local calendar day `offset` days from today, as YYYY-MM-DD.
function localToday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const formatDay = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const num = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));

function Filter({ label, children }) {
  return <label className="block text-xs font-medium text-tertiary-600">{label}<div className="mt-1">{children}</div></label>;
}

const dateInput = 'w-full rounded-xl border px-3 py-1.5 text-sm';

function useReport(path, params) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params);
  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get(path, { params: clean(JSON.parse(key)) })
      .then(({ data: body }) => setData(body.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load the report'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [path, key, pushError]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

/** Team → projects & members on the chosen date. */
function TeamDetailDrawer({ row, date, onClose }) {
  return (
    <Drawer open={Boolean(row)} title={row ? `${row.team?.name || 'No team'} · ${formatDay(date)}` : ''} onClose={onClose} size="lg">
      {row && (
        <div className="space-y-5 text-sm">
          <p className="text-tertiary-600">
            {row.members} member{row.members === 1 ? '' : 's'} × {num(row.capacity_per_resource)} = <b>{num(row.total_capacity)}</b> project capacity · <b>{row.current_allocation}</b> allocated · <b>{num(row.available_capability)}</b> available
            {row.over_capacity_by > 0 && <span className="text-danger-700"> · over by {num(row.over_capacity_by)}</span>}
          </p>
          <section>
            <h3 className="mb-2 font-semibold text-tertiary-900">Projects (counted once per team)</h3>
            {row.projects.length === 0 ? <p className="text-tertiary-500">No running project allocations on this date.</p> : (
              <ul className="divide-y divide-tertiary-100 rounded-2xl border border-tertiary-100">
                {row.projects.map((p) => (
                  <li key={p.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-tertiary-900">{p.name}<span className="ml-2 text-xs font-normal text-tertiary-500">{[p.code, p.client_name].filter(Boolean).join(' · ')}</span></span>
                      <span className="text-xs text-tertiary-500">
                        {p.agreement_end_date ? `Ends ${formatDay(p.agreement_end_date)}` : 'No end date'}
                        {p.ending_soon && <span className="ml-2"><Pill tone="amber">Ending soon · {p.days_remaining}d</Pill></span>}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-tertiary-600">{p.resources.map((r) => `${r.name}${r.allocation_percent != null ? ` (${r.allocation_percent}%)` : ''}`).join(', ')}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {row.team && (
            <section>
              <h3 className="mb-2 font-semibold text-tertiary-900">Members on {formatDay(date)}</h3>
              <p className="text-tertiary-600">{row.member_list.map((m) => m.name).join(', ') || '—'}</p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function TeamCapacityReport() {
  const { pushError, pushInfo } = useAlerts();
  const teams = useTeamOptions(true);
  const [filters, setFilters] = useState(() => ({ date: localToday(), team_ids: [], window_days: 30 }));
  // Several teams at once — sent as one comma-separated team_ids.
  const query = useMemo(() => ({ ...filters, team_ids: filters.team_ids.join(',') }), [filters]);
  const { data, loading, reload } = useReport('/allocations/reports/team-capacity', query);
  const [perResource, setPerResource] = useState('');
  const [open, setOpen] = useState(null);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  useEffect(() => { if (data) setPerResource(String(data.projects_per_resource)); }, [data]);

  async function saveDefault() {
    try {
      await apiClient.put('/allocations/settings', { projects_per_resource: Number(perResource) });
      pushInfo('Capacity per resource updated');
      reload();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the capacity setting'), 'Something went wrong');
    }
  }

  const rows = (data?.teams || []).map((r) => ({ ...r, id: r.team?.id || 'none' }));
  const columns = [
    { key: 'team', header: 'Team', render: (r) => (
      <span>
        <span className="font-medium text-primary-700">{r.team?.name || 'No team'}</span>
        {r.lead && <span className="block text-xs text-tertiary-500">Lead: {r.lead.name}</span>}
      </span>
    ) },
    { key: 'members', header: 'Team members', render: (r) => (r.team ? r.members : '—') },
    { key: 'per', header: 'Capacity / person', render: (r) => (r.team ? <span title={r.uses_org_default ? 'Company default' : 'Team override'}>{num(r.capacity_per_resource)}{r.uses_org_default ? '' : ' *'}</span> : '—') },
    { key: 'max', header: 'Max possible allocation', render: (r) => (r.team ? num(r.total_capacity) : '—') },
    { key: 'current', header: 'Current allocation', render: (r) => (
      <ProjectsHover projects={r.projects} title={`${r.team?.name || 'No team'} · running projects`}>
        <span className={r.over_capacity_by > 0 ? 'font-medium text-danger-700' : ''}>{r.current_allocation}</span>
      </ProjectsHover>
    ) },
    { key: 'available', header: 'Current capability', render: (r) => (r.team ? num(r.available_capability) : '—') },
    { key: 'ending', header: "Projects ending soon", render: (r) => (
      <ProjectsHover projects={(r.projects || []).filter((p) => p.ending_soon)} title={`${r.team?.name || 'No team'} · ending soon`}>
        {r.projects_ending_soon}
      </ProjectsHover>
    ) },
    { key: 'can', header: 'Can allocate', render: (r) => (r.team ? <span className="font-semibold">{num(r.can_allocate)}</span> : '—') },
    { key: 'status', header: 'Status', render: (r) => { const [label, tone] = CAPACITY_STATUS[r.status] || [r.status, 'gray']; return <Pill tone={tone}>{label}</Pill>; } },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <Filter label="As of date"><input type="date" value={filters.date} onChange={(e) => set('date', e.target.value)} className={dateInput} /></Filter>
        <Filter label="Teams">
          <MultiSelectDropdown value={filters.team_ids} onChange={(ids) => set('team_ids', ids)} options={teams.map((t) => ({ id: t.value, label: t.label }))} placeholder="All teams" searchPlaceholder="Search teams…" emptyMessage="No teams yet" />
        </Filter>
        <Filter label="Ending soon window (days)"><input type="number" min="1" max="365" value={filters.window_days} onChange={(e) => set('window_days', e.target.value)} className={dateInput} /></Filter>
        <Filter label="Projects per resource (company default)">
          <div className="flex gap-2">
            <input type="number" min="0.1" max="20" step="0.1" value={perResource} onChange={(e) => setPerResource(e.target.value)} className={dateInput} />
            <button type="button" className="btn-secondary inline-flex items-center gap-1 px-3 text-xs" onClick={saveDefault} disabled={!perResource || Number(perResource) === data?.projects_per_resource}><Save className="h-3.5 w-3.5" /> Save</button>
          </div>
        </Filter>
      </div>
      <DataTable columns={columns} rows={rows} loading={loading} onRowClick={setOpen} emptyLabel="No teams yet — add them under HR Settings → Teams." />
      {data && (
        <p className="text-xs text-tertiary-500">
          Max possible allocation = team members × projects per person (* = team override, set under HR Settings → Teams). Current allocation counts each running project once per team, however many of its members work on it. Current capability = max − current, rounded up to a whole number (0.5 → 1, 2.5 → 3), never below 0. Can allocate = current capability + projects ending within {data.window_days} days.
          {' '}Totals: {data.totals.members} people · capacity {num(data.totals.total_capacity)} · allocated {data.totals.current_allocation} · can allocate {num(data.totals.can_allocate)}.
        </p>
      )}
      <TeamDetailDrawer row={open} date={data?.date} onClose={() => setOpen(null)} />
    </div>
  );
}

function EndingSoonReport() {
  const teams = useTeamOptions(true);
  const clients = useLeadClientOptions(true);
  const [filters, setFilters] = useState(() => ({ from: localToday(), to: localToday(30), team_id: '', client_account_id: '' }));
  const { data, loading } = useReport('/allocations/reports/ending-soon', filters);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const rows = (data?.projects || []).map((r) => ({ ...r, id: r.project.id }));
  const columns = [
    { key: 'project', header: 'Project', render: (r) => <span><span className="font-medium text-tertiary-900">{r.project.name}</span><span className="block text-xs text-tertiary-500">{r.project.code}</span></span> },
    { key: 'client', header: 'Client', render: (r) => r.project.client_name || '—' },
    { key: 'team', header: 'Team', render: (r) => (r.teams.length ? r.teams.map((t) => t.name).join(', ') : <span className="text-tertiary-400">No team</span>) },
    { key: 'end', header: 'End date', render: (r) => formatDay(r.end_date) },
    { key: 'days', header: 'Days remaining', render: (r) => <Pill tone={r.days_remaining <= 7 ? 'red' : r.days_remaining <= 15 ? 'amber' : 'blue'}>{r.days_remaining} days</Pill> },
    { key: 'resources', header: 'Resources', render: (r) => <span title={r.resources.map((x) => x.name).join(', ')}>{r.resource_count}{r.resource_count ? <span className="block text-xs text-tertiary-500">{r.resources.map((x) => x.name).join(', ')}</span> : null}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label="End date from"><input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={dateInput} /></Filter>
        <Filter label="End date to"><input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={dateInput} /></Filter>
        <Filter label="Team"><SearchableSelect value={filters.team_id} onChange={(v) => set('team_id', v)} options={teams} placeholder="All teams" allowClear /></Filter>
        <Filter label="Client"><SearchableSelect value={filters.client_account_id} onChange={(v) => set('client_account_id', v)} options={clients} placeholder="All clients" allowClear /></Filter>
      </div>
      <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No running project/contract ends in this window." />
      <p className="text-xs text-tertiary-500">Uses each project&apos;s agreement end date (Finance → Projects). Team = the teams of the people allocated to it.</p>
    </div>
  );
}

function MovementReport() {
  const teams = useTeamOptions(true);
  const people = useOrgMembershipOptions(true);
  const [filters, setFilters] = useState({ from: '', to: '', team_id: '', org_membership_id: '' });
  const { data, loading } = useReport('/allocations/reports/movements', filters);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const projectNames = (list) => (list.length ? list.map((p) => p.name).join(', ') : '—');
  const rows = (data?.rows || []).map((r, i) => ({ ...r, id: `${r.resource.id}-${r.effective_date}-${i}` }));
  const columns = [
    { key: 'resource', header: 'Resource', render: (r) => <span className="font-medium text-tertiary-900">{r.resource.name}</span> },
    { key: 'date', header: 'Effective date', render: (r) => formatDay(r.effective_date) },
    { key: 'type', header: 'Change', render: (r) => <Pill tone={r.change_type.includes('team') ? 'purple' : 'blue'}>{CHANGE_TYPE[r.change_type] || r.change_type}</Pill> },
    { key: 'from', header: 'From team', render: (r) => r.from_team?.name || '—' },
    { key: 'to', header: 'To team', render: (r) => r.to_team?.name || '—' },
    { key: 'prev', header: 'Previous project', render: (r) => projectNames(r.previous_projects) },
    { key: 'next', header: 'New project', render: (r) => projectNames(r.new_projects) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label="From"><input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={dateInput} /></Filter>
        <Filter label="To"><input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={dateInput} /></Filter>
        <Filter label="Team"><SearchableSelect value={filters.team_id} onChange={(v) => set('team_id', v)} options={teams} placeholder="All teams" allowClear /></Filter>
        <Filter label="Resource"><SearchableSelect value={filters.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={people} placeholder="All resources" allowClear /></Filter>
      </div>
      <DataTable columns={columns} rows={rows} loading={loading} emptyLabel="No team or project changes in this period." />
      {data && <p className="text-xs text-tertiary-500">Showing {formatDay(data.from)} → {formatDay(data.to)} (default: last 90 days to 30 days ahead).</p>}
    </div>
  );
}

/**
 * People → Capacity & Allocation. Built on effective-dated data: team
 * membership periods and project allocation spans, so any date shows what
 * applied then — current state for today, history for the past.
 */
export default function CapacityPage() {
  const [tab, setTab] = useState('capacity');
  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'capacity' && <TeamCapacityReport />}
      {tab === 'ending' && <EndingSoonReport />}
      {tab === 'movements' && <MovementReport />}
    </div>
  );
}
