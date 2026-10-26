import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { flattenTree, teamCounts } from '../orgChart/OrgChartPage.jsx';
import { KpiTile, SectionHeading } from './groupUi.jsx';

const cell = 'px-3 py-1.5 text-right tabular-nums';
const dateText = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const KIND_LABEL = { current: 'Current employees', new_hires: 'New hires', open: 'Open positions', target: 'Target' };

/** A count that opens the people / positions behind it. A zero is plain text: there is nothing to open. */
function Count({ value, onClick, tone = '' }) {
  if (!value) return <span className="text-tertiary-300">0</span>;
  return <button type="button" onClick={onClick} className={`min-w-[1.75rem] rounded-md px-1.5 py-0.5 font-semibold tabular-nums text-primary-700 hover:bg-primary-50 hover:underline ${tone}`}>{value}</button>;
}

// One company: its team rows and its own totals. Current and New hires count everyone in the company (people in no team and
// contractors included); Open and Target come from the teams (open positions are set per team).
function companyBlock(company) {
  const rows = teamCounts(flattenTree(company.roots || []), company.teams || []);
  const sum = (list, k) => list.reduce((s, r) => s + (r[k] || 0), 0);
  const open = sum(rows.filter((r) => r.isTeam), 'open');
  const current = sum(rows, 'current');
  return { org: company.org, soon: Boolean(company.org.enabled_modules?.includes('coming_soon')), rows, total: { current, new_hires: sum(rows, 'new_hires'), open, target: current + open } };
}

const peopleOf = (rows) => rows.flatMap((r) => r.people || []);
const openOf = (rows, company) => rows.filter((r) => r.isTeam && r.open > 0).map((r) => ({ company, team: r.label, open: r.open }));

// What a count stands for: kind current | new_hires | open | target, over some rows of one company (or of many).
function detailsFor(kind, scope) {
  const all = peopleOf(scope.rows);
  const people = kind === 'new_hires' ? all.filter((p) => p.employment_status === 'pending_onboarding') : all;
  return { kind, title: scope.title, people: kind === 'open' ? [] : people, positions: kind === 'open' || kind === 'target' ? scope.positions : [] };
}

/** Group Dashboard > Headcount & Hiring: current people and open positions team by team, company by company, and for the whole group. */
export default function GroupHeadcountTab() {
  const { pushError } = useAlerts();
  const [companies, setCompanies] = useState(null);
  const [only, setOnly] = useState('');
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    apiClient.get('/org-chart/group').then(({ data }) => setCompanies(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Failed to load the headcount'), 'Something went wrong'));
  }, [pushError]);

  const blocks = useMemo(() => (companies || []).map(companyBlock), [companies]);
  const shown = blocks.filter((b) => !only || b.org.id === only);
  const show = (kind, scope) => setDetail(detailsFor(kind, scope));
  const rowScope = (b, r) => ({ title: `${b.org.name} � ${r.label}`, rows: [r], positions: r.isTeam && r.open ? [{ company: b.org.name, team: r.label, open: r.open }] : [] });
  const companyScope = (b) => ({ title: b.org.name, rows: b.rows, positions: openOf(b.rows, b.org.name) });
  const groupScope = { title: only ? shown[0]?.org.name || 'Company' : 'Complete group', rows: shown.flatMap((b) => b.rows), positions: shown.flatMap((b) => openOf(b.rows, b.org.name)) };
  const grand = shown.reduce((a, b) => ({ current: a.current + b.total.current, new_hires: a.new_hires + b.total.new_hires, open: a.open + b.total.open, target: a.target + b.total.target }), { current: 0, new_hires: 0, open: 0, target: 0 });

  function exportCsv() {
    const lines = [['Company', 'Team', 'Current', 'New hires', 'Open positions', 'Target']];
    for (const b of shown) {
      for (const r of b.rows) lines.push([b.org.name, r.label, r.current, r.new_hires, r.isTeam ? r.open : '', r.isTeam ? r.target : '']);
      lines.push([b.org.name, 'Company total', b.total.current, b.total.new_hires, b.total.open, b.total.target]);
    }
    lines.push(['All companies', 'Complete group', grand.current, grand.new_hires, grand.open, grand.target]);
    const csv = lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'headcount-and-hiring.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!companies) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-4" data-testid="group-headcount">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-tertiary-900">Headcount &amp; Hiring</h2>
          <p className="text-xs text-tertiary-500">People working now and open positions, team by team, company by company, and for the whole group. Teams and open positions are set in each company&apos;s Settings &gt; Teams.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Company
            <select value={only} onChange={(e) => setOnly(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm">
              <option value="">All companies</option>
              {blocks.map((b) => <option key={b.org.id} value={b.org.id}>{b.org.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={exportCsv}><Download className="h-4 w-4" />CSV</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['current', grand.current, 'working now', 'blue'], ['new_hires', grand.new_hires, 'not joined yet', 'green'], ['open', grand.open, 'still to fill', 'purple'], ['target', grand.target, 'current + open', 'orange']].map(([k, v, h, t]) => (
          <button key={k} type="button" className="text-left" data-testid={`kpi-${k}`} onClick={() => show(k, groupScope)}><KpiTile label={KIND_LABEL[k]} value={v} hint={h} theme={t} /></button>
        ))}
      </div>

      <SectionHeading title="Team by team" hint="Current, New hires, Open and Target for every team of every company" />
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <table className="min-w-full text-sm" aria-label="Headcount and open positions by company and team">
          <thead className="bg-tertiary-50 text-xs uppercase tracking-wide text-tertiary-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Company / Team</th>
              <th className={`${cell} font-medium`} title="People on the team now, lead included">Current</th>
              <th className={`${cell} font-medium`} title="Of the current people, not joined yet (pending onboarding)">New hires</th>
              <th className={`${cell} font-medium`} title="Open positions still to fill (HR Settings > Teams)">Open positions</th>
              <th className={`${cell} font-medium`} title="Current + open: the size once hiring is done">Target</th>
            </tr>
          </thead>
          {shown.map((b) => (
            <tbody key={b.org.id} className="border-t border-tertiary-200" data-testid="headcount-company">
              <tr className="bg-primary-50/50 font-semibold text-tertiary-900">
                <td className="px-3 py-2">{b.org.name}{b.soon && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Soon</span>}</td>
                <td className={cell}><Count value={b.total.current} onClick={() => show('current', companyScope(b))} /></td>
                <td className={cell}><Count value={b.total.new_hires} onClick={() => show('new_hires', companyScope(b))} /></td>
                <td className={cell}><Count value={b.total.open} onClick={() => show('open', companyScope(b))} tone="text-violet-700" /></td>
                <td className={cell}><Count value={b.total.target} onClick={() => show('target', companyScope(b))} /></td>
              </tr>
              {b.rows.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-2 text-xs text-tertiary-400">No people or teams yet.</td></tr>
              ) : b.rows.map((r) => (
                <tr key={r.key} className={`border-t border-tertiary-100 ${r.isTeam ? 'text-tertiary-700' : 'text-tertiary-500'}`} data-testid="headcount-team">
                  <td className="py-1.5 pl-8 pr-3">{r.label}</td>
                  <td className={cell}><Count value={r.current} onClick={() => show('current', rowScope(b, r))} /></td>
                  <td className={cell}><Count value={r.new_hires} onClick={() => show('new_hires', rowScope(b, r))} /></td>
                  <td className={cell}>{r.isTeam ? <Count value={r.open} onClick={() => show('open', rowScope(b, r))} tone="text-violet-700" /> : '-'}</td>
                  <td className={cell}>{r.isTeam ? <Count value={r.target} onClick={() => show('target', rowScope(b, r))} /> : '-'}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot className="border-t-2 border-tertiary-300 bg-tertiary-50 font-semibold text-tertiary-900">
            <tr data-testid="headcount-grand">
              <td className="px-3 py-2">{only ? 'Total' : 'Complete group'}</td>
              <td className={cell}><Count value={grand.current} onClick={() => show('current', groupScope)} /></td>
              <td className={cell}><Count value={grand.new_hires} onClick={() => show('new_hires', groupScope)} /></td>
              <td className={cell}><Count value={grand.open} onClick={() => show('open', groupScope)} /></td>
              <td className={cell}><Count value={grand.target} onClick={() => show('target', groupScope)} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} size="lg" tone="info" title={detail ? `${detail.title} � ${KIND_LABEL[detail.kind]}` : 'Details'}>
        {detail && (
          <div className="space-y-4" data-testid="headcount-details">
            {detail.kind !== 'open' && (detail.people.length === 0 ? <p className="text-sm text-tertiary-500">Nobody here.</p> : (
              <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
                {[...detail.people].sort((a, b) => (a.person?.name || '').localeCompare(b.person?.name || '')).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="headcount-person">
                    <div>
                      <p className="font-medium text-tertiary-900">{p.person?.name}</p>
                      <p className="text-xs text-tertiary-500">{[p.designation?.name || (p.role === 'admin' ? 'Company admin' : null), p.employee_code, p.worker_type === 'contractor' ? 'Contractor' : null].filter(Boolean).join(' � ') || '-'}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-tertiary-500">
                      {p.employment_status === 'pending_onboarding' && <Pill tone="green">New hire</Pill>}
                      {p.employment_status === 'notice_period' && <Pill tone="amber">Notice</Pill>}
                      <span>Joined {dateText(p.joined_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
            {detail.positions.length > 0 && (
              <section className="space-y-2">
                <h4 className="font-heading text-sm font-semibold text-tertiary-800">Open positions</h4>
                <ul className="divide-y divide-tertiary-100 rounded-xl border border-tertiary-100 text-sm">
                  {detail.positions.map((x) => (
                    <li key={`${x.company}-${x.team}`} className="flex items-center justify-between px-3 py-2" data-testid="headcount-position"><span>{x.company} � {x.team}</span><b className="text-violet-700">{x.open} to hire</b></li>
                  ))}
                </ul>
                <p className="text-[11px] text-tertiary-400">Open positions are set per team in the company&apos;s Settings &gt; Teams.</p>
              </section>
            )}
            {detail.kind === 'open' && detail.positions.length === 0 && <p className="text-sm text-tertiary-500">No open positions.</p>}
          </div>
        )}
      </Drawer>
      <p className="text-[11px] text-tertiary-400">People in no team and contractors count in Current and New hires; open positions and the target belong to teams. The Group Super Admin is not counted inside any company.</p>
    </div>
  );
}
