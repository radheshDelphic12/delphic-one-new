import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  ARRANGEMENT_LABEL, CATEGORY_LABEL, FREQ_LABEL, FUNDING_LABEL, KIND_LABEL, MODE_LABEL, inputCls, labelCls, today,
} from './deploymentsUi.jsx';

const BLANK_LINE = { category: 'accommodation', description: '', amount: '', frequency: 'monthly', funding: 'company', client_share_pct: '', billable: false };

/** The estimated budget: one row per line. Monthly lines recur for every month of the deployment; funding says who bears the cost. */
export function LinesEditor({ lines, onChange, disabled = false }) {
  const set = (i, k, v) => onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="space-y-2" data-testid="budget-lines">
      {lines.length === 0 && <p className="text-xs text-tertiary-500">No budget line yet. Add tickets, accommodation, food, local conveyance and other expenses.</p>}
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-tertiary-100 bg-tertiary-50/40 p-2 sm:grid-cols-6">
          <label className={labelCls}>Expense
            <select disabled={disabled} className={inputCls} value={l.category} onChange={(e) => set(i, 'category', e.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>
          </label>
          <label className={labelCls}>Amount (₹)<input disabled={disabled} type="number" min="0" step="any" className={inputCls} value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} aria-label="Amount" /></label>
          <label className={labelCls}>How often
            <select disabled={disabled} className={inputCls} value={l.frequency} onChange={(e) => set(i, 'frequency', e.target.value)}>{Object.entries(FREQ_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>
          </label>
          <label className={labelCls}>Who pays
            <select disabled={disabled} className={inputCls} value={l.funding} onChange={(e) => set(i, 'funding', e.target.value)}>{Object.entries(FUNDING_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>
          </label>
          {l.funding === 'shared'
            ? <label className={labelCls}>Client pays %<input disabled={disabled} type="number" min="0" max="100" step="any" className={inputCls} value={l.client_share_pct} onChange={(e) => set(i, 'client_share_pct', e.target.value)} /></label>
            : <label className={labelCls}>Note<input disabled={disabled} className={inputCls} value={l.description || ''} onChange={(e) => set(i, 'description', e.target.value)} maxLength={300} /></label>}
          <div className="flex items-end justify-between gap-2 pb-2">
            <label className="flex items-center gap-1.5 text-xs text-tertiary-700"><input disabled={disabled} type="checkbox" checked={Boolean(l.billable)} onChange={(e) => set(i, 'billable', e.target.checked)} />Billable to the client</label>
            {!disabled && <button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
      ))}
      {!disabled && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => onChange([...lines, { ...BLANK_LINE }])}><Plus className="h-3.5 w-3.5" />Add a budget line</button>}
    </div>
  );
}

/** Clean budget lines for the API (numbers, no blanks). */
export function cleanLines(lines) {
  return lines.filter((l) => Number(l.amount) > 0).map((l) => ({
    category: l.category, description: (l.description || '').trim() || null, amount: Number(l.amount), frequency: l.frequency, funding: l.funding,
    client_share_pct: l.funding === 'shared' ? Number(l.client_share_pct || 0) : null, billable: Boolean(l.billable),
  }));
}

function TravelRows({ rows, onChange }) {
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-tertiary-100 bg-tertiary-50/40 p-2 sm:grid-cols-6">
          <label className={labelCls}>Type<select className={inputCls} value={r.mode} onChange={(e) => set(i, 'mode', e.target.value)}>{Object.entries(MODE_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
          <label className={labelCls}>From<input className={inputCls} value={r.from_place} onChange={(e) => set(i, 'from_place', e.target.value)} /></label>
          <label className={labelCls}>To / place<input className={inputCls} value={r.to_place} onChange={(e) => set(i, 'to_place', e.target.value)} /></label>
          <label className={labelCls}>Date<input type="date" className={inputCls} value={r.start_date} onChange={(e) => set(i, 'start_date', e.target.value)} /></label>
          <label className={labelCls}>Estimated ₹<input type="number" min="0" step="any" className={inputCls} value={r.estimated_cost} onChange={(e) => set(i, 'estimated_cost', e.target.value)} /></label>
          <div className="flex items-end justify-end pb-2"><button type="button" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label="Remove arrangement" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></div>
        </div>
      ))}
      <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => onChange([...rows, { mode: 'flight', from_place: '', to_place: '', start_date: '', estimated_cost: '' }])}><Plus className="h-3.5 w-3.5" />Add a flight, train, bus, local transport or stay</button>
    </div>
  );
}

/** Create a deployment (with its people, budget and travel) or edit the basics of an existing one. */
export default function DeploymentForm({ initial, options, onSubmit, saving, error }) {
  const t = initial || {};
  const editing = Boolean(initial);
  const [v, setV] = useState(() => ({
    title: t.title || '', kind: t.kind || 'deployment', org_id: t.org_id || '', client_name: t.client_name || '', client_location: t.client_location || '',
    client_supervisor_name: t.client_supervisor_name || '', client_supervisor_phone: t.client_supervisor_phone || '', client_supervisor_email: t.client_supervisor_email || '',
    pm_project_id: t.pm_project_id || '', purpose: t.purpose || '', start_date: t.start_date || today(), expected_end_date: t.expected_end_date || '',
    working_arrangement: t.working_arrangement || 'client_office', reporting_manager_user_id: t.reporting_manager_user_id || '', delivery_manager_user_id: t.delivery_manager_user_id || '', notes: t.notes || '',
  }));
  const [people, setPeople] = useState([]);
  const [lines, setLines] = useState([]);
  const [travel, setTravel] = useState([]);
  const [pick, setPick] = useState('');
  const [guest, setGuest] = useState('');
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const everyone = useMemo(() => {
    const seen = new Map();
    (options?.people || []).forEach((p) => { if (!seen.has(p.user_id)) seen.set(p.user_id, p); });
    return [...seen.values()];
  }, [options]);
  const projects = (options?.projects || []).filter((p) => !v.org_id || p.org_id === v.org_id);
  const bad = !v.title.trim() || !v.client_name.trim() || !v.start_date || !v.expected_end_date || v.expected_end_date < v.start_date;

  const addPerson = () => {
    const p = (options?.people || []).find((x) => `${x.user_id}:${x.org_id}` === pick);
    if (!p || people.some((x) => x.user_id === p.user_id)) return;
    setPeople((c) => [...c, { user_id: p.user_id, name: p.name, org_id: p.org_id, role: '', arrangement: 'inherit' }]);
    setPick('');
  };
  const addGuest = () => { if (guest.trim()) { setPeople((c) => [...c, { user_id: null, name: guest.trim(), org_id: null, role: '', arrangement: 'inherit' }]); setGuest(''); } };
  const manager = (id) => everyone.find((p) => p.user_id === id)?.name || null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = {
          title: v.title.trim(), kind: v.kind, org_id: v.org_id || null, client_name: v.client_name.trim(), client_location: v.client_location.trim() || null,
          client_supervisor_name: v.client_supervisor_name.trim() || null, client_supervisor_phone: v.client_supervisor_phone.trim() || null, client_supervisor_email: v.client_supervisor_email.trim() || null,
          pm_project_id: v.pm_project_id || null, purpose: v.purpose.trim() || null, start_date: v.start_date, expected_end_date: v.expected_end_date, working_arrangement: v.working_arrangement,
          reporting_manager_user_id: v.reporting_manager_user_id || null, reporting_manager_name: v.reporting_manager_user_id ? manager(v.reporting_manager_user_id) : null,
          delivery_manager_user_id: v.delivery_manager_user_id || null, delivery_manager_name: v.delivery_manager_user_id ? manager(v.delivery_manager_user_id) : null, notes: v.notes.trim() || null,
        };
        if (!editing) {
          body.people = people.map((p) => ({ ...p, role: p.role.trim() || null }));
          body.budget_lines = cleanLines(lines);
          body.travel = travel.filter((r) => r.to_place || r.from_place).map((r) => ({ mode: r.mode, from_place: r.from_place.trim() || null, to_place: r.to_place.trim() || null, start_date: r.start_date || null, estimated_cost: r.estimated_cost === '' ? null : Number(r.estimated_cost) }));
        }
        onSubmit(body);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Title<input required maxLength={200} className={inputCls} value={v.title} onChange={set('title')} placeholder="e.g. Onsite support at Acme, Pune" autoFocus /></label>
        <label className={labelCls}>Type
          <select className={inputCls} value={v.kind} onChange={set('kind')}>{Object.entries(KIND_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>
        </label>
        <label className={labelCls}>Company whose people go
          <select className={inputCls} value={v.org_id} onChange={(e) => setV((c) => ({ ...c, org_id: e.target.value, pm_project_id: '' }))}><option value="">Whole group</option>{(options?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className={labelCls}>Client<input required list="dep-clients" maxLength={200} className={inputCls} value={v.client_name} onChange={set('client_name')} /></label>
        <datalist id="dep-clients">{(options?.clients || []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <label className={labelCls}>Client location<input maxLength={300} className={inputCls} value={v.client_location} onChange={set('client_location')} placeholder="City, site or office" /></label>
        <label className={labelCls}>Client-side supervisor<input maxLength={120} className={inputCls} value={v.client_supervisor_name} onChange={set('client_supervisor_name')} /></label>
        <label className={labelCls}>Supervisor phone<input maxLength={40} className={inputCls} value={v.client_supervisor_phone} onChange={set('client_supervisor_phone')} /></label>
        <label className={labelCls}>Supervisor email<input type="email" maxLength={160} className={inputCls} value={v.client_supervisor_email} onChange={set('client_supervisor_email')} /></label>
        <label className={labelCls}>Project (optional)
          <select className={inputCls} value={v.pm_project_id} onChange={set('pm_project_id')}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select>
        </label>
        <label className={labelCls}>Start date<input required type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} disabled={editing && t.status === 'active'} /></label>
        <label className={labelCls}>Expected end date<input required type="date" className={inputCls} value={v.expected_end_date} min={v.start_date} onChange={set('expected_end_date')} disabled={editing && t.status !== 'draft'} /></label>
        <label className={labelCls}>Working arrangement
          <select className={inputCls} value={v.working_arrangement} onChange={set('working_arrangement')}>{['client_office', 'remote', 'hybrid'].map((k) => <option key={k} value={k}>{ARRANGEMENT_LABEL[k]}</option>)}</select>
        </label>
        <label className={labelCls}>Reporting manager
          <select className={inputCls} value={v.reporting_manager_user_id} onChange={set('reporting_manager_user_id')}><option value="">Not set</option>{everyone.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select>
        </label>
        <label className={labelCls}>Project / delivery manager
          <select className={inputCls} value={v.delivery_manager_user_id} onChange={set('delivery_manager_user_id')}><option value="">Not set</option>{everyone.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select>
        </label>
        <label className={`${labelCls} sm:col-span-2`}>Purpose<textarea rows={2} maxLength={2000} className={inputCls} value={v.purpose} onChange={set('purpose')} /></label>
      </div>
      {editing && t.status !== 'draft' && <p className="text-xs text-tertiary-500">The end date, people and budget of a submitted deployment change through Extend, Change of people and Budget revision, which are approved.</p>}

      {!editing && (
        <>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-tertiary-900">People</h4>
            {people.map((p, i) => (
              <div key={i} className="grid grid-cols-6 items-end gap-2 rounded-xl border border-tertiary-100 bg-tertiary-50/40 p-2">
                <p className="col-span-2 text-sm font-medium text-tertiary-900">{p.name}</p>
                <label className={`${labelCls} col-span-2`}>Role<input className={inputCls} value={p.role} onChange={(e) => setPeople((c) => c.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} maxLength={120} /></label>
                <label className={labelCls}>Works<select className={inputCls} value={p.arrangement} onChange={(e) => setPeople((c) => c.map((x, j) => (j === i ? { ...x, arrangement: e.target.value } : x)))}>{Object.entries(ARRANGEMENT_LABEL).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
                <button type="button" className="mb-2 justify-self-end rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" aria-label={`Remove ${p.name}`} onClick={() => setPeople((c) => c.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-2">
              <label className={`${labelCls} min-w-[14rem] flex-1`}>Add a person
                <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a person"><option value="">Choose from any company…</option>{(options?.people || []).map((p) => <option key={`${p.user_id}:${p.org_id}`} value={`${p.user_id}:${p.org_id}`}>{p.name} · {p.org_name}</option>)}</select>
              </label>
              <button type="button" className="btn-secondary" onClick={addPerson} disabled={!pick}>Add</button>
              <label className={`${labelCls} w-48`}>Or someone outside<input className={inputCls} value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Name" maxLength={120} /></label>
              <button type="button" className="btn-secondary" onClick={addGuest} disabled={!guest.trim()}>Add</button>
            </div>
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-tertiary-900">Estimated budget</h4>
            <LinesEditor lines={lines} onChange={setLines} />
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-tertiary-900">Travel arrangements</h4>
            <TravelRows rows={travel} onChange={setTravel} />
          </section>
        </>
      )}
      <label className={labelCls}>Notes<textarea rows={2} maxLength={4000} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 border-t pt-3">
        <button type="submit" className="btn-primary" disabled={saving || bad}>{saving ? 'Saving…' : editing ? 'Save' : 'Create as draft'}</button>
      </div>
    </form>
  );
}
