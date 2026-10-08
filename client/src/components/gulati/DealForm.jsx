import { useState } from 'react';
import { Area, DateInput, Num, Section, Select, Text, toBody } from './ui.jsx';

const FIELDS = ['name', 'trading_type', 'party_id', 'vendor_id', 'start_date', 'expected_end', 'actual_end', 'location', 'assignee_id', 'contractor_id', 'product', 'material_type', 'ordered_quantity', 'unit', 'expected_purchase_amount', 'expected_sale_amount', 'description', 'notes'];
const NUMS = ['ordered_quantity', 'expected_purchase_amount', 'expected_sale_amount'];

/** Create / edit a trading deal. `editing` shows the actual completion date. */
export default function DealForm({ initial, pickers, masters, editing, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'trading_type' ? masters.activeTypes[0]?.key || '' : '')])));
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
        <Select label="Trading type" value={v.trading_type} onChange={set('trading_type')} options={masters.activeTypes.map((t) => ({ value: t.key, label: t.label }))} required />
        <Text label="Location" value={v.location} onChange={set('location')} maxLength={200} />
        <Select label="Client" value={v.party_id} onChange={set('party_id')} options={pickers.clients} blank="No client yet" />
        <Select label="Primary vendor" value={v.vendor_id} onChange={set('vendor_id')} options={pickers.vendors} blank="No vendor yet" />
        <Select label="Assigned employee" value={v.assignee_id} onChange={set('assignee_id')} options={pickers.employees} blank="Unassigned" />
        <Select label="Assigned contractor" value={v.contractor_id} onChange={set('contractor_id')} options={pickers.contractors} blank="None" />
      </Section>
      <Section title="Schedule" hint={days !== null ? `Duration: ${days} days` : 'Duration is calculated from the start date and the completion date.'}>
        <DateInput label="Start date" value={v.start_date} onChange={set('start_date')} />
        <DateInput label="Expected completion" value={v.expected_end} onChange={set('expected_end')} />
        {editing && <DateInput label="Actual completion" value={v.actual_end} onChange={set('actual_end')} />}
      </Section>
      <Section title="Material and order">
        <Text label="Product / material" value={v.product} onChange={set('product')} maxLength={200} placeholder="Copper Cathode" />
        <Text label="Material type / grade" value={v.material_type} onChange={set('material_type')} maxLength={200} />
        <Num label="Ordered quantity" value={v.ordered_quantity} onChange={set('ordered_quantity')} />
        <Select label="Unit" value={v.unit} onChange={set('unit')} options={masters.activeUnits.map((u) => ({ value: u.name, label: u.name }))} blank="Select unit" />
        <Num label="Expected purchase amount" value={v.expected_purchase_amount} onChange={set('expected_purchase_amount')} />
        <Num label="Expected sale amount" value={v.expected_sale_amount} onChange={set('expected_sale_amount')} />
      </Section>
      <Section title="Description">
        <Area label="Deal description / details" className="sm:col-span-2" rows={8} value={v.description} onChange={set('description')} maxLength={20000} />
        <Area label="Notes" className="sm:col-span-2" rows={3} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save deal'}</button>
      </div>
    </form>
  );
}
