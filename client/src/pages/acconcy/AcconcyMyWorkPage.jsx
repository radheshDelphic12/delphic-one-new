import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { DEAL_STATUS_META, PRIORITY_META, STAGE_META, TASK_TYPE_LABEL, serviceLabel } from '../../lib/acconcy/meta.js';
import Pill from '../../components/ui/Pill.jsx';
import { Empty, card } from '../../components/acconcy/ui.jsx';
import { dateLabel } from '../../lib/format.js';

/** The signed-in employee's or contractor's assigned leads, deals and tasks (no money figures). */
export default function AcconcyMyWorkPage() {
  const { me, loading } = useAcconcy();
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const load = useCallback(() => acconcyApi.myWork().then(setData, (e) => pushError(acconcyError(e, 'Could not load'), 'Load failed')), [pushError]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'myWork')) return <Navigate to="/acconcy" replace />;
  async function done(t) {
    try { await acconcyApi.updateTask(t.id, { status: 'done' }); load(); } catch (e) { pushError(acconcyError(e, 'Could not update'), 'Could not update'); }
  }
  if (!data) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  return (
    <div className="mt-4 space-y-4">
      <section className={card}>
        <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">My open tasks ({data.tasks.length})</h3>
        {data.tasks.length === 0 ? <Empty>Nothing assigned to you right now.</Empty> : (
          <ul className="divide-y text-sm">
            {data.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="font-medium text-tertiary-900">{t.title}</span><span className="block text-xs text-tertiary-500">{t.code} · {TASK_TYPE_LABEL[t.task_type] || t.task_type}{t.deal ? ` · ${t.deal.name}` : ''}{t.due_date ? ` · due ${dateLabel(t.due_date)}` : ''}{t.overdue ? ' (overdue)' : ''}</span></span>
                <span className="flex items-center gap-2"><Pill tone={PRIORITY_META[t.priority]?.tone}>{PRIORITY_META[t.priority]?.label}</Pill><button type="button" className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50" onClick={() => done(t)}><Check className="h-3.5 w-3.5" />Done</button></span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">My deals ({data.deals.length})</h3>
          {data.deals.length === 0 ? <Empty>No active deals assigned.</Empty> : (
            <ul className="divide-y text-sm">
              {data.deals.map((d) => (
                <li key={d.id} className="py-2">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-tertiary-900">{d.name}</span><Pill tone={DEAL_STATUS_META[d.status]?.tone}>{DEAL_STATUS_META[d.status]?.label}</Pill></div>
                  <div className="text-xs text-tertiary-500">{d.code} · {serviceLabel(d.service_type)}{d.party ? ` · ${d.party.name}` : ''}{d.summary?.delayed ? ' · delayed' : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-tertiary-900">My leads ({data.leads.length})</h3>
          {data.leads.length === 0 ? <Empty>No open leads assigned.</Empty> : (
            <ul className="divide-y text-sm">
              {data.leads.map((l) => (
                <li key={l.id} className="py-2">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-tertiary-900">{l.name}</span><Pill tone={STAGE_META[l.stage]?.tone}>{STAGE_META[l.stage]?.label}</Pill></div>
                  <div className="text-xs text-tertiary-500">{l.code} · {serviceLabel(l.service_type)}{l.party ? ` · ${l.party.name}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
