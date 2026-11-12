import { useState } from 'react';
import { Area, DateInput, Num, Section, Select, Text, dayOf, toBody } from './ui.jsx';

const CREATE_STATUS = [{ value: 'draft', label: 'Draft' }, { value: 'planned', label: 'Planned' }, { value: 'active', label: 'Active (starts today)' }];

/**
 * One form for a campaign. Money is only entered when the campaign is created; afterwards it changes through
 * "Revise budget" (reason + history), so it is not shown when editing.
 */
export default function CampaignForm({ initial, initiatives, managers, onSubmit, onCancel, saving, error }) {
  const editing = Boolean(initial);
  const [v, setV] = useState(() => ({
    name: initial?.name ?? '',
    category_id: initial?.category_id ?? '',
    status: 'draft',
    objective: initial?.objective ?? '',
    description: initial?.description ?? '',
    country: initial?.country ?? 'India',
    state: initial?.state ?? '',
    city: initial?.city ?? '',
    area: initial?.area ?? '',
    address: initial?.address ?? '',
    planned_start: dayOf(initial?.planned_start) || '',
    planned_end: dayOf(initial?.planned_end) || '',
    actual_start: dayOf(initial?.actual_start) || '',
    actual_end: dayOf(initial?.actual_end) || '',
    manager_id: initial?.manager_id ?? '',
    allocated_budget: '',
    planned_investment: '',
    financial_notes: initial?.financial_notes ?? '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const badDates = v.planned_start && v.planned_end && v.planned_end < v.planned_start;
  const badMoney = !editing && Number(v.planned_investment || 0) > Number(v.allocated_budget || 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: ['allocated_budget', 'planned_investment'] });
        body.name = v.name.trim();
        if (editing) {
          delete body.status; delete body.allocated_budget; delete body.planned_investment;
          if (!['active', 'on_hold', 'completed'].includes(initial.status)) { delete body.actual_start; delete body.actual_end; }
          if (initial.status !== 'completed') delete body.actual_end;
        } else {
          delete body.actual_start; delete body.actual_end;
          body.allocated_budget ??= 0; body.planned_investment ??= 0;
        }
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Campaign">
        <Text label="Campaign name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus placeholder="e.g. Child Care - Ahmedabad" />
        <Select label="Initiative / category" value={v.category_id} onChange={set('category_id')} options={initiatives} blank="Not set" />
        {!editing && <Select label="Status" value={v.status} onChange={set('status')} options={CREATE_STATUS} />}
        <Select label="Campaign manager" value={v.manager_id} onChange={set('manager_id')} options={managers} blank="Not assigned" />
        <Area label="Objective and expected outcome" className="sm:col-span-2" rows={2} value={v.objective} onChange={set('objective')} maxLength={4000} />
        <Area label="Description" className="sm:col-span-2" rows={2} value={v.description} onChange={set('description')} maxLength={4000} />
      </Section>
      <Section title="Location">
        <Text label="Country" value={v.country} onChange={set('country')} maxLength={80} />
        <Text label="State" value={v.state} onChange={set('state')} maxLength={80} />
        <Text label="City" value={v.city} onChange={set('city')} maxLength={80} />
        <Text label="Area / locality" value={v.area} onChange={set('area')} maxLength={120} />
        <Area label="Detailed location / address" className="sm:col-span-2" rows={2} value={v.address} onChange={set('address')} maxLength={500} />
      </Section>
      <Section title="Timeline" hint="The duration is worked out from these dates; it is never typed in.">
        <DateInput label="Planned start" value={v.planned_start} onChange={set('planned_start')} />
        <DateInput label="Planned end" value={v.planned_end} onChange={set('planned_end')} min={v.planned_start || undefined} />
        {editing && ['active', 'on_hold', 'completed'].includes(initial.status) && <DateInput label="Actual start" value={v.actual_start} onChange={set('actual_start')} />}
        {editing && initial.status === 'completed' && <DateInput label="Actual completion" value={v.actual_end} onChange={set('actual_end')} />}
        {badDates && <p className="text-xs text-danger-600 sm:col-span-2">The end date must be on or after the start date.</p>}
      </Section>
      {!editing && (
        <Section title="Budget" hint="Allocated budget is the amount assigned to the campaign; planned investment is the part the foundation intends to put into the programme. Neither is money spent.">
          <Num label="Allocated budget (₹)" value={v.allocated_budget} onChange={set('allocated_budget')} required />
          <Num label="Planned investment (₹)" value={v.planned_investment} onChange={set('planned_investment')} hint="Cannot be more than the allocated budget" />
          {badMoney && <p className="text-xs text-danger-600 sm:col-span-2">Planned investment cannot be more than the allocated budget.</p>}
        </Section>
      )}
      <Area label="Financial notes" rows={2} value={v.financial_notes} onChange={set('financial_notes')} maxLength={2000} />
      {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || badDates || badMoney}>{saving ? 'Saving...' : editing ? 'Save campaign' : 'Create campaign'}</button>
      </div>
    </form>
  );
}
