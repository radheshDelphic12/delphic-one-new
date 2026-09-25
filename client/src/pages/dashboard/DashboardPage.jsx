import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, ExternalLink } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { usePermissions } from '../../lib/permissions.js';
import { CHART_COLORS, CHART_PALETTE, chartTooltipStyle } from '../../lib/chartTheme.js';
import ChartCard from '../../components/ui/ChartCard.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import FilterBar from '../../components/ui/FilterBar.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { rangeForPreset } from '../../lib/datePresets.js';
import { funnelChartData, stageFilterHref, statsForRole } from './dashboardWidgets.js';
import LightweightDashboard from './LightweightDashboard.jsx';
import LeaveBalancesPanel from '../leave/LeaveBalancesPanel.jsx';

const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
};

function entityPath(entityType, entityId) {
  if (entityType === 'account') return `/accounts/${entityId}`;
  if (entityType === 'requirement') return `/requirements/${entityId}`;
  if (entityType === 'submission') return `/submissions/${entityId}`;
  return null;
}

function StuckLeadsPanel({ rows }) {
  return (
    <section className="hover-zoom relative overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <h2 className="border-b border-tertiary-100 px-4 py-3 font-heading text-sm font-semibold text-tertiary-900">
        Stuck leads
        <span className="ml-2 font-normal text-tertiary-400">as of today</span>
      </h2>
      <ul className="divide-y divide-tertiary-100">
        {(rows || []).map((row) => (
          <li key={row.id}>
            <Link
              to={`/accounts/${row.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-tertiary-50/80"
            >
              <span className="font-medium text-primary-600">{row.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700">
                  {row.days_in_stage}d in stage
                </span>
                <ChevronRight className="h-4 w-4 text-tertiary-400" />
              </span>
            </Link>
          </li>
        ))}
        {(!rows || rows.length === 0) && (
          <li className="px-4 py-4 text-sm text-tertiary-400">No stuck leads (7+ days).</li>
        )}
      </ul>
    </section>
  );
}

function StuckRequirementsPanel({ rows }) {
  return (
    <section className="hover-zoom relative overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <h2 className="border-b border-tertiary-100 px-4 py-3 font-heading text-sm font-semibold text-tertiary-900">
        Stuck requirements
        <span className="ml-2 font-normal text-tertiary-400">as of today</span>
      </h2>
      <ul className="divide-y divide-tertiary-100">
        {(rows || []).map((row) => (
          <li key={row.id}>
            <Link
              to={`/requirements/${row.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-tertiary-50/80"
            >
              <div className="min-w-0">
                <div className="font-medium text-primary-600">{row.title}</div>
                <div className="mt-0.5 text-xs text-tertiary-500">
                  {row.submissions_count} submissions · {row.days_open}d open
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-medium text-warning-700">
                  {row.days_idle ?? row.days_open}d idle
                </span>
                <ChevronRight className="h-4 w-4 text-tertiary-400" />
              </span>
            </Link>
          </li>
        ))}
        {(!rows || rows.length === 0) && (
          <li className="px-4 py-4 text-sm text-tertiary-400">No stuck requirements (7+ days).</li>
        )}
      </ul>
    </section>
  );
}

function RecentActivityPanel({ rows }) {
  return (
    <section className="hover-zoom relative overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      <h2 className="border-b border-tertiary-100 px-4 py-3 font-heading text-sm font-semibold text-tertiary-900">
        Recent activity
      </h2>
      <ul className="divide-y divide-tertiary-100">
        {(rows || []).map((item, index) => {
          const path = entityPath(item.entity_type, item.entity_id);
          const label = item.entity_label || item.entity_type;
          return (
            <li
              key={`${item.entity_id}-${item.timestamp}-${index}`}
              className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <div className="min-w-0 text-tertiary-700">
                <span className="font-semibold text-tertiary-900">{item.user?.name || 'Someone'}</span>
                {' '}
                {item.action}
                {' on '}
                {path ? (
                  <Link to={path} className="font-medium text-primary-600 hover:underline">
                    {label}
                  </Link>
                ) : (
                  <span className="font-medium text-primary-600">{label}</span>
                )}
              </div>
              <time className="shrink-0 text-xs text-tertiary-400">
                {item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}
              </time>
            </li>
          );
        })}
        {(!rows || rows.length === 0) && (
          <li className="px-4 py-4 text-sm text-tertiary-400">No recent activity.</li>
        )}
      </ul>
      <div className="border-t border-tertiary-100 px-4 py-2.5">
        <Link to="/reports" className="text-xs font-medium text-primary-600 hover:underline">
          View all activity
        </Link>
      </div>
    </section>
  );
}

function StageMixLegend({ rows, role }) {
  return (
    <ul className="shrink-0 space-y-2.5 py-1">
      {rows.map((row, index) => (
        <li key={row.stage}>
          <Link
            to={stageFilterHref(row.stage, role)}
            className="flex items-center gap-2 text-sm text-tertiary-600 transition-colors hover:text-tertiary-900"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_PALETTE[index % CHART_PALETTE.length] }}
            />
            <span className="min-w-[1.25rem] font-semibold tabular-nums text-tertiary-900">{row.count}</span>
            <span>{row.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PipelineSection({ funnel, role }) {
  const data = useMemo(() => funnelChartData(funnel, role), [funnel, role]);
  const total = data.reduce((sum, row) => sum + row.count, 0);
  const pieData = data.filter((row) => row.count > 0).map((row) => ({ name: row.label, value: row.count }));
  const isBda = role === 'bda';
  const title = isBda ? 'Lead pipeline' : 'Submission pipeline';
  const ctaLabel = 'View pipeline board';
  const ctaPath = '/pipeline';

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card md:p-5">
      {/* Figma: title left · button + all stage counts on one right-hand line */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 shrink-0">
          <h2 className="font-heading text-base font-semibold tracking-tight text-tertiary-900">{title}</h2>
          <p className="mt-0.5 text-sm text-tertiary-500">
            Live counts by stage{total > 0 ? ` · ${total} total in pipeline` : ''}
          </p>
        </div>

        <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-3 overflow-x-auto">
          <Link
            to={ctaPath}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#105AA9] bg-white px-3 py-1.5 text-xs font-semibold text-[#105AA9] transition-colors hover:bg-[#EEF5FC]"
          >
            {ctaLabel}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>

          {data.map((row, index) => (
            <Link
              key={row.stage}
              to={stageFilterHref(row.stage, role)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-tertiary-100 bg-canvas-muted px-2.5 py-1.5 text-xs text-tertiary-600 transition-colors hover:border-tertiary-200 hover:bg-white"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: CHART_PALETTE[index % CHART_PALETTE.length] }}
              />
              <span className="font-semibold tabular-nums text-tertiary-900">{row.count}</span>
              {row.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Funnel"
          subtitle={isBda ? 'Leads at each stage' : 'Submissions at each stage'}
          className="border-0 p-0 shadow-none lg:col-span-2"
        >
          {total === 0 ? (
            <p className="py-16 text-center text-sm text-tertiary-400">
              {isBda ? 'No leads in the pipeline yet.' : 'No submissions in the pipeline yet.'}
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5c6f86' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#5c6f86' }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" name="Count" radius={[6, 6, 0, 0]}>
                    {data.map((row, index) => (
                      <Cell key={row.stage} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Stage mix" subtitle="Share of pipeline" className="border-0 p-0 shadow-none">
          {total === 0 ? (
            <p className="py-16 text-center text-sm text-tertiary-400">No stage mix yet.</p>
          ) : (
            <div className="flex h-72 items-center gap-4">
              <div className="h-full min-w-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                      {pieData.map((entry, index) => {
                        const stageIndex = data.findIndex((row) => row.label === entry.name);
                        const colorIndex = stageIndex >= 0 ? stageIndex : index;
                        return <Cell key={entry.name} fill={CHART_PALETTE[colorIndex % CHART_PALETTE.length]} />;
                      })}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <StageMixLegend rows={data} role={role} />
            </div>
          )}
        </ChartCard>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const { can } = usePermissions(user);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [datePreset, setDatePreset] = useState('this_month');
  const initialRange = useMemo(() => rangeForPreset('this_month'), []);
  const [dateFrom, setDateFrom] = useState(initialRange.date_from);
  const [dateTo, setDateTo] = useState(initialRange.date_to);

  const showDeptFilter = can('filterByDepartment');
  const role = user?.role || 'admin';
  const showPipeline = role === 'admin' || can('viewPipeline');

  useEffect(() => {
    if (!showDeptFilter) return undefined;
    apiClient
      .get('/departments')
      .then(({ data }) => setDepartments(data.data || []))
      .catch(() => setDepartments([]));
    return undefined;
  }, [showDeptFilter]);

  useEffect(() => {
    if (datePreset === 'custom') return;
    const range = rangeForPreset(datePreset);
    setDateFrom(range.date_from);
    setDateTo(range.date_to);
  }, [datePreset]);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (departmentId) params.department_id = departmentId;
    apiClient
      .get('/dashboard/summary', { params })
      .then(({ data }) => setSummary(data.data))
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load dashboard'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [departmentId, pushError]);

  // IST (Asia/Kolkata, +05:30) start-of-month instant — matches the server
  // `startOfMonth()` the "closed / closures this month" tiles are counted against.
  const monthStartIso = useMemo(() => {
    const IST = 330 * 60 * 1000;
    const ist = new Date(new Date().getTime() + IST);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST).toISOString();
  }, []);
  const stats = statsForRole(role, summary, { userId: user?.id, monthStartIso });
  const showStuckLeads = role === 'admin' || role === 'bda';
  const showStuckRequirements = role === 'admin' || role === 'sales' || role === 'recruiter';

  // Recruitment funnel/KPI panels below are Delphic-only, and only for roles with
  // dashboard-chart access — a role without it (e.g. employee/IT) gets the
  // lightweight landing page even inside the master workspace.
  if (!user?.active_org?.is_master_workspace || !can('viewDashboardCharts')) {
    return <LightweightDashboard orgName={user?.active_org?.name} isAdmin={role === 'admin'} />;
  }

  return (
    <div className="space-y-5">
      {showDeptFilter && (
        <div className="mt-3 rounded-2xl border border-tertiary-100 bg-white px-4 py-3 shadow-card">
          <FilterBar
            variant="inline"
            datePreset={datePreset}
            onDatePresetChange={setDatePreset}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={(value) => {
              setDatePreset('custom');
              setDateFrom(value);
            }}
            onDateToChange={(value) => {
              setDatePreset('custom');
              setDateTo(value);
            }}
            showDepartment
            departments={departments}
            departmentId={departmentId}
            onDepartmentChange={setDepartmentId}
          />
        </div>
      )}

      {loading && !summary ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <Skeleton key={n} className="h-28" rounded="xl" />
            ))}
          </div>
          <Skeleton className="h-80" rounded="xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 xl:grid-cols-4">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                className="h-full"
                {...cardMotion}
                transition={{ ...cardMotion.transition, delay: index * 0.03 }}
              >
                <KpiCard
                  label={stat.label}
                  value={stat.value}
                  hint={stat.hint}
                  description={stat.description}
                  icon={stat.icon}
                  theme={stat.theme}
                  to={stat.href}
                />
              </motion.div>
            ))}
          </div>

          {showPipeline && (
            <motion.div {...cardMotion}>
              <PipelineSection funnel={summary?.pipeline_funnel} role={role} />
            </motion.div>
          )}

          <div className={`grid gap-4 ${showStuckLeads || showStuckRequirements ? 'xl:grid-cols-2' : ''}`}>
            <div className="space-y-4">
              {showStuckLeads && <StuckLeadsPanel rows={summary?.stuck_leads} />}
              {showStuckRequirements && <StuckRequirementsPanel rows={summary?.stuck_requirements} />}
            </div>
            <RecentActivityPanel rows={summary?.recent_activity} />
          </div>

          {role === 'admin' && (
            <motion.div {...cardMotion}>
              <LeaveBalancesPanel compact />
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
