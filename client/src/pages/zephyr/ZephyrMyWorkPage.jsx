import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Banknote, HardHat } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { STATUS_META, rupees } from '../../lib/zephyr/projectMeta.js';
import { dateLabel } from '../../lib/format.js';
import Pill from '../../components/ui/Pill.jsx';
import { ProgressBar } from './ZephyrProjectsPage.jsx';

const card = 'rounded-2xl border bg-white p-4 shadow-soft md:p-5';
const SLIP_TONE = { approved: 'amber', paid: 'green' };

/** What a staff member sees: their profile, the projects they are assigned to (read only) and their pay slips. */
export default function ZephyrMyWorkPage() {
  const { me, loading } = useZephyr();
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);

  useEffect(() => {
    zephyrApi.myWork().then(setData, (e) => pushError(zephyrError(e, 'Could not load your work'), 'Load failed'));
  }, [pushError]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!zxCan(me, 'myWork')) return <Navigate to="/zephyr" replace />;
  if (!data) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!data.person) {
    return <div className={`${card} mt-4 text-sm text-tertiary-600`}>Your login is not linked to a person on the Zephyr roster, so there is nothing assigned to you yet.</div>;
  }

  const { person, assignments, salaries } = data;
  return (
    <div className="mt-4 space-y-5">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-bold text-tertiary-900">{person.name}</h2>
          <Pill tone={person.kind === 'contractor' ? 'amber' : 'blue'}>{person.kind === 'contractor' ? 'Contractor' : 'Employee'}</Pill>
        </div>
        <div className="mt-1 text-sm text-tertiary-500">{[person.designation, person.vendor_party?.name, person.phone, person.email].filter(Boolean).join(' · ')}</div>
        {person.pay_basis && <div className="mt-2 text-sm text-tertiary-700">Pay: {rupees(person.rate)} {person.pay_basis === 'daily' ? 'per day' : 'per month'}</div>}
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><HardHat className="h-4 w-4 text-primary-600" />My projects</h3>
        {assignments.length === 0 && <div className={`${card} text-sm text-tertiary-400`}>You are not assigned to a project right now.</div>}
        <div className="grid gap-3 lg:grid-cols-2">
          {assignments.map((a) => (
            <article key={a.id} className={card}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-tertiary-500">{a.project.code}</span>
                <Pill tone={STATUS_META[a.project.status]?.tone}>{STATUS_META[a.project.status]?.label}</Pill>
              </div>
              <h4 className="mt-1 font-semibold text-tertiary-900">{a.project.name}</h4>
              <div className="text-xs text-tertiary-500">{[a.role, `${a.allocation_pct}% of your time`, a.project.location].filter(Boolean).join(' · ')}</div>
              <div className="mt-2"><ProgressBar value={a.project.progress} /></div>
              {a.milestones.length > 0 && (
                <ul className="mt-3 space-y-1 border-t pt-3 text-sm">
                  {a.milestones.map((m) => (
                    <li key={`${m.name}-${m.due_date}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-tertiary-700">{m.name}</span>
                      <span className="shrink-0 text-xs text-tertiary-500">{m.due_date ? `${dateLabel(m.due_date)} · ` : ''}{m.percent_done}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Banknote className="h-4 w-4 text-primary-600" />My pay slips</h3>
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-soft">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-primary-50/60 text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2.5">Month</th><th className="px-4 py-2.5">Days</th><th className="px-4 py-2.5 text-right">Gross</th><th className="px-4 py-2.5 text-right">Deductions</th><th className="px-4 py-2.5 text-right">Net</th><th className="px-4 py-2.5">Status</th></tr>
            </thead>
            <tbody className="divide-y">
              {salaries.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-tertiary-400">No approved slips yet.</td></tr>}
              {salaries.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{s.month}</td>
                  <td className="px-4 py-2.5">{s.days ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(s.gross)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rupees(s.deductions)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{rupees(s.net)}</td>
                  <td className="px-4 py-2.5"><Pill tone={SLIP_TONE[s.status]}>{s.status === 'paid' ? `Paid ${s.paid_on ? dateLabel(s.paid_on) : ''}` : 'Approved'}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
