import { useCallback, useEffect, useState } from 'react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { zephyrApi, zephyrError } from '../../lib/zephyr/api.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';
import StatCard from '../ui/StatCard.jsx';
import ZephyrLedger from './ZephyrLedger.jsx';

/** A project's money: actual vs planned, budget used, by category, and its own ledger entries. */
export default function ZephyrProjectMoney({ project, isAdmin, canDelete, onChanged }) {
  const { pushError } = useAlerts();
  const [money, setMoney] = useState(null);
  const load = useCallback(() => zephyrApi.projectMoney(project.id).then(setMoney, (e) => pushError(zephyrError(e, 'Could not load the project money'), 'Load failed')), [project.id, pushError]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue" value={rupees(money?.revenue)} hint={money?.planned_revenue ? `${rupees(money.planned_revenue)} expected` : money?.contract_value ? `of ${rupees(money.contract_value)} contract` : undefined} />
        <StatCard label="Expense" value={rupees(money?.expense)} hint={money?.planned_expense ? `${rupees(money.planned_expense)} expected` : undefined} />
        {isAdmin && <StatCard label="Salaries charged" value={rupees(money?.salaries)} hint="from pay slips" />}
        <StatCard label="Profit" value={rupees(money?.profit)} accent={money ? money.profit >= 0 : false} hint={isAdmin ? undefined : 'before salaries'} />
        {money?.budget != null && <StatCard label="Budget used" value={money.budget_used_pct == null ? '—' : `${money.budget_used_pct}%`} hint={`of ${rupees(money.budget)}`} />}
        <StatCard label="Tax collected / paid" value={`${rupees(money?.tax_collected)} / ${rupees(money?.tax_paid)}`} hint="GST, outside profit" />
      </div>
      {money?.by_category.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {['revenue', 'expense'].map((type) => (
            <div key={type} className="rounded-2xl border bg-white p-4 shadow-soft">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{type === 'revenue' ? 'Revenue by category' : 'Expense by category'}</div>
              <ul className="space-y-1.5 text-sm">
                {money.by_category.filter((c) => c.type === type).map((c) => <li key={c.category} className="flex justify-between"><span>{c.category}</span><span className="tabular-nums">{rupees(c.amount)}</span></li>)}
                {money.by_category.filter((c) => c.type === type).length === 0 && <li className="text-tertiary-400">None yet.</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
      <ZephyrLedger projectId={project.id} isAdmin={isAdmin} canDelete={canDelete} onChanged={() => { load(); onChanged?.(); }} />
    </div>
  );
}
