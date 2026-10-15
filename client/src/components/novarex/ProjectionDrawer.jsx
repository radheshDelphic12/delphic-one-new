import { useState } from 'react';
import Drawer from '../ui/Drawer.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { LINE_META, PROJECTION_LINES, PROJECTION_STATUSES } from '../../lib/novarex/meta.js';
import { Area, Num, Select, Text, toBody } from './ui.jsx';

const monthNow = () => new Date().toISOString().slice(0, 7);

/** Add or edit one projection. A projection is a plan only: saving it never creates a transaction. */
export default function ProjectionDrawer({ open, projection, defaultMonth, pickers, canSeeSalary, onClose, onSaved }) {
  const { pushSuccess } = useAlerts();
  const editing = Boolean(projection);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [v, setV] = useState(() => ({
    name: projection?.name || '', outlet_id: projection?.outlet_id || '', month: projection?.month || defaultMonth || monthNow(), line: projection?.line || 'operating_expense', category_id: projection?.category_id || '',
    investment_id: projection?.investment_id || '', amount: projection?.amount ?? '', status: projection?.status || 'draft', notes: projection?.notes || '',
  }));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const lines = PROJECTION_LINES.filter((l) => canSeeSalary || l.value !== 'salary');
  const investmentLine = ['new_investment', 'principal_recovery', 'investment_earnings'].includes(v.line);
  const catOptions = v.line.endsWith('expense') ? pickers.expenseCategories : v.line === 'other_income' ? pickers.incomeCategories : v.line === 'new_investment' ? pickers.investmentCategories : [];
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = toBody(v, { numbers: ['amount'] });
    if (!investmentLine) body.investment_id = null;
    try {
      if (editing) await nxApi.updateProjection(projection.id, body); else await nxApi.createProjection(body);
      pushSuccess(editing ? 'Projection updated' : 'Projection added');
      onSaved();
    } catch (err) { setError(novarexError(err, 'Could not save the projection')); } finally { setSaving(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="lg" tone={editing ? 'edit' : 'create'} title={editing ? 'Edit projection' : 'New projection'}>
      {open && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Text label="Projection name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} placeholder="e.g. Q3 marketing budget" />
            <Field2 label="Month"><input type="month" required className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={v.month} onChange={(e) => set('month')(e.target.value)} /></Field2>
            <Select label="Financial line" value={v.line} onChange={(x) => setV((c) => ({ ...c, line: x, category_id: '', investment_id: '' }))} options={lines.map((l) => ({ value: l.value, label: l.label }))} />
            <Select label="Outlet" value={v.outlet_id} onChange={set('outlet_id')} options={projection?.outlet && !pickers.outlets.some((s) => s.value === projection.outlet_id) ? [{ value: projection.outlet_id, label: `${projection.outlet.code} ${projection.outlet.name}` }, ...pickers.outlets] : pickers.outlets} blank="Company level (no outlet)" />
            <Num label="Planned amount (₹)" value={v.amount} onChange={set('amount')} required min="0" />
            <Select label="Status" value={v.status} onChange={set('status')} options={PROJECTION_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
            {catOptions.length > 0 && <Select label="Category (optional)" value={v.category_id} onChange={set('category_id')} options={catOptions} blank="Not set" />}
            {investmentLine && <Select label="Related investment (optional)" value={v.investment_id} onChange={set('investment_id')} options={pickers.investments} blank="None" />}
            <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={1000} />
          </div>
          <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">{LINE_META[v.line]?.hint}. A projection is a plan: it never creates an investment, income, expense or salary payment, and expected returns are not guaranteed.</p>
          {error && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Add projection'}</button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function Field2({ label, children }) {
  return <label className="block text-xs font-medium text-tertiary-600">{label}{children}</label>;
}
