import { Plus, X } from 'lucide-react';
import { dateLabel } from '../../lib/format.js';
import { rupees } from '../../lib/zephyr/projectMeta.js';

const inputCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const PHASE_STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

// Service-specific fields per project, all optional (deals differ). Keys match the server's
// projectDetails.js; commission_amount is computed by the server and shown, never typed.
export const SECTION_TITLES = {
  civil_construction: 'Civil construction details',
  interior_design: 'Interior design details',
  property_management: 'Property management details',
  property_trading: 'Property trading details',
  real_estate_consulting: 'Consulting and brokerage details',
};

const commission = (d) => (d?.property_value != null && d?.property_value !== '' && d?.commission_pct != null && d?.commission_pct !== '' ? Math.round(Number(d.property_value) * Number(d.commission_pct)) / 100 : null);

function Field({ label, span, children }) {
  return <label className={`${labelCls} ${span ? 'sm:col-span-2' : ''}`}>{label}{children}</label>;
}

export function ServiceSectionForm({ service, value, onChange }) {
  const d = value || {};
  const set = (key) => (e) => onChange({ ...d, [key]: e.target.value });
  const text = (key, label, props = {}) => (
    <Field label={label} span={props.span}><input className={inputCls} value={d[key] ?? ''} onChange={set(key)} maxLength={props.max || 200} type={props.type || 'text'} min={props.type === 'number' ? 0 : undefined} step={props.step} /></Field>
  );
  const area = (key, label) => <Field label={label} span><textarea className={inputCls} rows={2} value={d[key] ?? ''} onChange={set(key)} maxLength={2000} /></Field>;

  if (service === 'civil_construction') {
    const phases = Array.isArray(d.phases) ? d.phases : [];
    const setPhase = (i, key) => (e) => onChange({ ...d, phases: phases.map((p, idx) => (idx === i ? { ...p, [key]: e.target.value } : p)) });
    return (
      <>
        {text('site', 'Site / society')}
        {text('units_count', 'Number of units', { type: 'number' })}
        {area('scope', 'Scope of work')}
        <div className="space-y-2 sm:col-span-2">
          <div className={labelCls}>Construction phases</div>
          {phases.map((p, i) => (
            <div key={i} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
              <input className={inputCls.replace('mt-1 ', '')} placeholder="Phase" value={p.name || ''} onChange={setPhase(i, 'name')} maxLength={120} aria-label="Phase name" />
              <input type="date" className={inputCls.replace('mt-1 ', '')} value={p.start || ''} onChange={setPhase(i, 'start')} aria-label="Phase start" />
              <input type="date" className={inputCls.replace('mt-1 ', '')} value={p.end || ''} onChange={setPhase(i, 'end')} aria-label="Phase end" />
              <select className={inputCls.replace('mt-1 ', '')} value={p.status || 'pending'} onChange={setPhase(i, 'status')} aria-label="Phase status">{PHASE_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              <button type="button" className="rounded-lg p-2 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove phase" onClick={() => onChange({ ...d, phases: phases.filter((_, idx) => idx !== i) })}><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline" onClick={() => onChange({ ...d, phases: [...phases, { name: '', status: 'pending' }] })}><Plus className="h-4 w-4" />Add a phase</button>
          <p className="text-xs text-tertiary-500">Vendors and subcontractors are added as work orders in the Work orders tab after saving.</p>
        </div>
      </>
    );
  }
  if (service === 'interior_design') {
    return (
      <>
        {text('property', 'Property / flat', { span: true })}
        {area('design_scope', 'Design scope')}
        {area('renovation_scope', 'Renovation scope')}
        {text('material_cost', 'Material cost (₹)', { type: 'number' })}
        {text('labour_cost', 'Labour cost (₹)', { type: 'number' })}
        {text('vendor_cost', 'Vendor cost (₹)', { type: 'number' })}
        {text('other_expenses', 'Other expenses (₹)', { type: 'number' })}
      </>
    );
  }
  if (service === 'real_estate_consulting') {
    const amount = commission(d);
    return (
      <>
        {text('desired_property_type', 'Desired property type')}
        {text('required_location', 'Required location')}
        {text('client_budget', 'Client budget (₹)', { type: 'number' })}
        {text('property_value', 'Property value (₹)', { type: 'number' })}
        {text('commission_pct', 'Commission %', { type: 'number', step: '0.01' })}
        <Field label="Commission amount (auto)"><input className={`${inputCls} bg-primary-50/50`} value={amount === null ? '' : rupees(amount)} readOnly tabIndex={-1} /></Field>
        {text('deal_date', 'Deal date', { type: 'date' })}
        {text('closing_date', 'Closing date', { type: 'date' })}
      </>
    );
  }
  if (service === 'property_management') {
    return (
      <>
        {area('scope', 'Management scope')}
        {text('management_fee_pct', 'Management fee %', { type: 'number', step: '0.01' })}
      </>
    );
  }
  return <>{area('scope', 'Scope')}</>;
}

/** Strip blanks and numeric strings so the API receives a clean section. */
export function cleanSection(service, value) {
  if (!value) return null;
  const numeric = ['units_count', 'material_cost', 'labour_cost', 'vendor_cost', 'other_expenses', 'client_budget', 'property_value', 'commission_pct', 'management_fee_pct'];
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'commission_amount') continue;
    if (k === 'phases') {
      const phases = (v || []).filter((p) => p.name?.trim()).map((p) => ({ name: p.name.trim(), start: p.start || null, end: p.end || null, status: p.status || 'pending' }));
      if (phases.length) out.phases = phases;
      continue;
    }
    if (v === '' || v === null || v === undefined) continue;
    out[k] = numeric.includes(k) ? Number(v) : typeof v === 'string' ? v.trim() : v;
  }
  return service ? out : null;
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <dt className="text-xs text-tertiary-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-tertiary-900">{children}</dd>
    </div>
  );
}

/** Read-only view of a project's service section. */
export function ServiceSectionView({ service, details }) {
  const d = details || {};
  const money = (v) => (v === null || v === undefined ? null : rupees(v));
  const rows = [];
  if (service === 'civil_construction') rows.push(['Site', d.site], ['Units', d.units_count], ['Scope', d.scope]);
  if (service === 'interior_design') rows.push(['Property', d.property], ['Design scope', d.design_scope], ['Renovation scope', d.renovation_scope], ['Material cost', money(d.material_cost)], ['Labour cost', money(d.labour_cost)], ['Vendor cost', money(d.vendor_cost)], ['Other expenses', money(d.other_expenses)]);
  if (service === 'real_estate_consulting') {
    rows.push(['Desired property', d.desired_property_type], ['Required location', d.required_location], ['Client budget', money(d.client_budget)], ['Property value', money(d.property_value)], ['Commission', d.commission_pct != null ? `${d.commission_pct}%` : null], ['Commission amount', money(d.commission_amount)], ['Deal date', d.deal_date ? dateLabel(d.deal_date) : null], ['Closing date', d.closing_date ? dateLabel(d.closing_date) : null]);
  }
  if (service === 'property_management') rows.push(['Scope', d.scope], ['Management fee', d.management_fee_pct != null ? `${d.management_fee_pct}%` : null]);
  if (service === 'property_trading') rows.push(['Scope', d.scope]);
  const phases = Array.isArray(d.phases) ? d.phases : [];
  const leadDetails = Array.isArray(d.lead_details) ? d.lead_details : [];
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (shown.length === 0 && phases.length === 0 && leadDetails.length === 0) return <div className="rounded-xl border border-dashed p-4 text-center text-sm text-tertiary-400">No service details recorded yet. Use Edit to add them.</div>;
  return (
    <div className="space-y-4">
      {shown.length > 0 && <dl className="grid gap-4 sm:grid-cols-2">{shown.map(([label, v]) => <Row key={label} label={label}>{v}</Row>)}</dl>}
      {phases.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-tertiary-600">Construction phases</div>
          <ul className="divide-y rounded-xl border bg-white text-sm">
            {phases.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="font-medium text-tertiary-900">{p.name}</span>
                <span className="text-xs text-tertiary-500">{[p.start && dateLabel(p.start), p.end && dateLabel(p.end)].filter(Boolean).join(' → ')}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === 'done' ? 'bg-green-50 text-green-700' : p.status === 'in_progress' ? 'bg-amber-50 text-amber-700' : 'bg-tertiary-100 text-tertiary-600'}`}>{PHASE_STATUS.find((s) => s.value === p.status)?.label || 'Pending'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {leadDetails.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-tertiary-600">Details carried from the lead</div>
          <dl className="grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-2">{leadDetails.map((l, i) => <Row key={i} label={l.label}>{l.value}</Row>)}</dl>
        </div>
      )}
    </div>
  );
}
