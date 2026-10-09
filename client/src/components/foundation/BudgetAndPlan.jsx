import { useMemo, useState } from 'react';
import { inr } from '../../lib/foundation/meta.js';
import { shortMonth } from '../../lib/format.js';
import { Num, Section, Text } from './ui.jsx';

/** Revise the allocated budget and planned investment. The reason is required; history keeps every revision. */
export function BudgetForm({ campaign, canOverride, onSubmit, onCancel, saving, error }) {
  const [v, setV] = useState({ allocated_budget: campaign.allocated_budget, planned_investment: campaign.planned_investment, reason: '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const spent = campaign.metrics.actual_expenditure;
  const belowSpent = Number(v.allocated_budget) < spent;
  const bad = Number(v.planned_investment) > Number(v.allocated_budget);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit({ allocated_budget: Number(v.allocated_budget), planned_investment: Number(v.planned_investment), reason: v.reason.trim() }); }}
      className="space-y-4"
    >
      <Section title="Budget" hint={`Already spent: ${inr(spent)}. Committed but unpaid: ${inr(campaign.metrics.commitments)}.`}>
        <Num label="Allocated budget (₹)" value={v.allocated_budget} onChange={set('allocated_budget')} required />
        <Num label="Planned investment (₹)" value={v.planned_investment} onChange={set('planned_investment')} required />
        <Text label="Reason for the change" className="sm:col-span-2" value={v.reason} onChange={set('reason')} required minLength={3} maxLength={500} placeholder="e.g. Second donor joined" />
      </Section>
      {bad && <p className="text-sm text-danger-600">Planned investment cannot be more than the allocated budget.</p>}
      {belowSpent && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{canOverride ? `This is ${inr(spent - Number(v.allocated_budget))} below what has already been spent, so the campaign will show as over budget.` : 'The budget cannot go below what has already been spent. Only an admin can do that.'}</p>}
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || bad || (belowSpent && !canOverride)}>{saving ? 'Saving...' : 'Save revision'}</button>
      </div>
    </form>
  );
}

const monthsOf = (from, to) => {
  const out = [];
  if (!from || !to || to < from) return out;
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

/** Month-by-month planned investment. With no rows the plan is spread evenly; once saved these amounts are the plan. */
export function PlanEditor({ campaign, onSubmit, onCancel, saving, error }) {
  const months = useMemo(() => monthsOf(campaign.planned_start, campaign.planned_end), [campaign.planned_start, campaign.planned_end]);
  const existing = new Map((campaign.plan || []).map((r) => [r.month, r.planned_amount]));
  const even = campaign.plan_source === 'even' ? new Map(campaign.monthly.map((m) => [m.month, m.planned_investment])) : new Map();
  const [vals, setVals] = useState(() => Object.fromEntries(months.map((m) => [m, existing.get(m) ?? even.get(m) ?? ''])));
  const total = Object.values(vals).reduce((a, x) => a + (Number(x) || 0), 0);
  const over = total > campaign.planned_investment + 0.001;
  if (!months.length) return <p className="text-sm text-tertiary-600">Set the planned start and end dates first; the plan has one row for each month in between.</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(months.filter((m) => vals[m] !== '' && vals[m] !== null).map((m) => ({ month: m, planned_amount: Number(vals[m]) })));
      }}
      className="space-y-4"
    >
      <p className="text-sm text-tertiary-600">How much of the {inr(campaign.planned_investment)} planned investment is meant to go out in each month. The projection spreads what is still unspent in proportion to this plan.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {months.map((m) => <Num key={m} label={shortMonth(m)} value={vals[m]} onChange={(x) => setVals((c) => ({ ...c, [m]: x }))} />)}
      </div>
      <div className={`flex justify-between rounded-xl px-3 py-2 text-sm ${over ? 'bg-danger-50 text-danger-700' : 'bg-tertiary-50 text-tertiary-700'}`}>
        <span>Planned in the schedule</span>
        <span className="font-semibold tabular-nums">{inr(total)} of {inr(campaign.planned_investment)}</span>
      </div>
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onSubmit([])} disabled={saving}>Clear (spread evenly)</button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || over}>{saving ? 'Saving...' : 'Save plan'}</button>
      </div>
    </form>
  );
}
