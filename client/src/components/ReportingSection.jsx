import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, UserRound, UsersRound } from 'lucide-react';
import apiClient from '../lib/apiClient.js';
import Avatar from './ui/Avatar.jsx';

function PersonRow({ person, badge }) {
  return (
    <li>
      <Link to={`/people/${person.id}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-tertiary-50">
        <Avatar name={person.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-tertiary-900">
            {person.name}
            {badge && <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-700">{badge}</span>}
          </span>
          <span className="block truncate text-xs text-tertiary-500">
            {[person.designation, person.department, person.employee_code].filter(Boolean).join(' · ') || person.email}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Card({ icon: Icon, title, count, empty, children }) {
  return (
    <div className="rounded-xl border border-tertiary-100 p-3">
      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">
        <Icon className="h-3.5 w-3.5" /> {title}
        {count !== undefined && <span className="rounded-full bg-tertiary-100 px-1.5 text-[10px] text-tertiary-600">{count}</span>}
      </h4>
      {children || <p className="px-2 py-1.5 text-sm text-tertiary-400">{empty}</p>}
    </div>
  );
}

/**
 * Who an employee reports to, who reports to them, and their team (lead +
 * members), each linking to that person's profile. `self` shows the signed-in
 * employee's own (Settings → My details); otherwise `membershipId`'s.
 */
export default function ReportingSection({ membershipId, self = false }) {
  const [data, setData] = useState(null);
  const url = self ? '/orgs/me/reporting' : `/orgs/memberships/${membershipId}/reporting`;

  useEffect(() => {
    let alive = true;
    apiClient.get(url).then(({ data: res }) => { if (alive) setData(res.data); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [url]);

  if (!data) return null;
  const { manager, direct_reports: reports, team } = data;

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
      <h3 className="mb-4 font-heading text-base font-semibold text-tertiary-900">Reporting</h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card icon={UserRound} title="Manager" empty="No manager set">
          {manager && <ul><PersonRow person={manager} /></ul>}
        </Card>
        <Card icon={Network} title="Direct reports" count={reports.length} empty="No one reports here">
          {reports.length > 0 && <ul className="max-h-72 space-y-0.5 overflow-y-auto">{reports.map((p) => <PersonRow key={p.id} person={p} />)}</ul>}
        </Card>
        <Card icon={UsersRound} title={team ? `Team · ${team.name}` : 'Team'} count={team ? team.members.length : undefined} empty="Not in a team">
          {team && team.members.length > 0 && (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {team.members.map((p) => <PersonRow key={p.id} person={p} badge={team.lead?.id === p.id ? 'Lead' : null} />)}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
