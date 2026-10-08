import { useState } from 'react';
import { SERVICE_TYPES } from '../../lib/acconcy/meta.js';
import { Area, DateInput, Num, Section, Select, Text, toBody } from './ui.jsx';

const FIELDS = ['name', 'service_type', 'party_id', 'vendor_id', 'start_date', 'expected_end', 'actual_end', 'deal_amount', 'location', 'assignee_id', 'contractor_id', 'description', 'notes'];
const NUMS = ['deal_amount'];

/** Create / edit a deal. `editing` shows the actual completion date. Revenue, expense and profit come from the ledger, not from here. */
export default function DealForm({ initial, pickers, editing, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'service_type' ? SERVICE_TYPES[0].value : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const days = v.start_date && (v.actual_end || v.expected_end) ? Math.round((new Date(String(v.actual_end || v.expected_end).slice(0, 10)) - new Date(String(v.start_date).slice(0, 10))) / 86400000) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = toBody(v, { numbers: NUMS });
        body.name = v.name.trim();
        if (!editing) delete body.actual_end;
        onSubmit(body);
      }}
      className="space-y-4"
    >
      <Section title="Deal">
        <Text label="Deal name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Select label="Service type" value={v.service_type} onChange={set('service_type')} options={SERVICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} required />
        <Text label="Location" value={v.location} onChange={set('location')} maxLength={200} />
        <Select label="Client" value={v.party_id} onChange={set('party_id')} options={pickers.clients} blank="No client yet" />
        <Select label="Vendor (if any)" value={v.vendor_id} onChange={set('vendor_id')} options={pickers.vendors} blank="No vendor" />
        <Select label="Assigned employee" value={v.assignee_id} onChange={set('assignee_id')} options={pickers.employees} blank="Unassigned" />
        <Select label="Assigned contractor" value={v.contractor_id} onChange={set('contractor_id')} options={pickers.contractors} blank="None" />
        <Num label="Deal amount" value={v.deal_amount} onChange={set('deal_amount')} hint="The size of the engagement. Revenue and profit are calculated from the entries you record, not from this." />
      </Section>
      <Section title="Schedule" hint={days !== null ? `Duration: ${days} days` : 'Duration is calculated from the start date and the completion date.'}>
        <DateInput label="Start date" value={v.start_date} onChange={set('start_date')} />
        <DateInput label="Expected end" value={v.expected_end} onChange={set('expected_end')} />
        {editing && <DateInput label="Actual end" value={v.actual_end} onChange={set('actual_end')} />}
      </Section>
      <Section title="Description" hint="Every engagement differs, so use free text: scope, commercial terms, special conditions.">
        <Area label="Description / deal details" className="sm:col-span-2" rows={8} value={v.description} onChange={set('description')} maxLength={20000} />
        <Area label="Notes" className="sm:col-span-2" rows={3} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save deal'}</button>
      </div>
    </form>
  );
}
