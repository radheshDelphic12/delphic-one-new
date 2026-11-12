import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { nxCan, useNovarex } from '../../lib/novarex/useNovarex.js';
import { dateLabel, titleCase } from '../../lib/format.js';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import CompanyStructure from '../../components/structure/CompanyStructure.jsx';
import CategoriesManager from '../../components/novarex/CategoriesManager.jsx';
import { DateInput, Empty, Num, Select, Text, card } from '../../components/novarex/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function General() {
  const { pushError, pushSuccess } = useAlerts();
  const [s, setS] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { nxApi.settings().then(setS, (e) => pushError(novarexError(e, 'Could not load'), 'Load failed')); }, [pushError]);
  if (!s) return <div className="py-6 text-sm text-tertiary-500">Loading...</div>;
  const set = (k) => (v) => setS((c) => ({ ...c, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const blank = s.opening_balance === '' || s.opening_balance === null;
      const out = await nxApi.updateSettings({
        investment_prefix: s.investment_prefix, outlet_prefix: s.outlet_prefix, fy_start_month: Number(s.fy_start_month),
        opening_balance: blank ? null : Number(s.opening_balance), opening_date: s.opening_date || null,
        invoice_timing: s.invoice_timing, expiry_warning_days: Number(s.expiry_warning_days), expiry_block_days: Number(s.expiry_block_days), require_transfer_approval: Boolean(s.require_transfer_approval), invoice_prefix: s.invoice_prefix, default_gst_rate: Number(s.default_gst_rate),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setS(out);
      setReason('');
      pushSuccess('Settings saved');
    } catch (err) { pushError(novarexError(err, 'Could not save'), 'Could not save'); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={save} className={`${card} max-w-2xl space-y-4`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Outlet code prefix" value={s.outlet_prefix} onChange={set('outlet_prefix')} maxLength={12} hint="New outlets are numbered NO-001, NO-002 ..." />
        <Text label="Investment code prefix" value={s.investment_prefix} onChange={set('investment_prefix')} maxLength={12} hint="New investments are numbered NX-0001, NX-0002 ..." />
        <Select label="Financial year starts in" value={String(s.fy_start_month)} onChange={set('fy_start_month')} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} hint="Drives the quarter, financial-year and year-to-date figures" />
        <Num label="Opening cash balance (₹)" value={s.opening_balance ?? ''} onChange={set('opening_balance')} step="any" min="-1000000000000" hint="Leave empty if unknown: balances are then not shown, never guessed." />
        <DateInput label="Opening balance as of" value={s.opening_date || ''} onChange={set('opening_date')} hint="Cash movements before this date are not counted." />
      </div>
      <h3 className="pt-2 font-heading text-sm font-semibold text-tertiary-900">Operations policy</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Create the sales invoice" value={s.invoice_timing} onChange={set('invoice_timing')} options={[{ value: 'delivery', label: 'After delivery is confirmed (accepted goods only)' }, { value: 'dispatch', label: 'Once the shipment is dispatched' }, { value: 'order', label: 'Before dispatch (as soon as the shipment exists)' }]} />
        <Text label="Sales invoice number prefix" value={s.invoice_prefix} onChange={set('invoice_prefix')} maxLength={12} hint="Franchise, purchase, credit and debit notes use FRN, PUR, CN and DN" />
        <Num label="Near-expiry warning (days)" value={s.expiry_warning_days} onChange={set('expiry_warning_days')} min="0" hint="Stock expiring within this many days is flagged" />
        <Num label="Block stock expiring within (days)" value={s.expiry_block_days} onChange={set('expiry_block_days')} min="0" hint="0 = only already-expired stock is blocked from allocation" />
        <Num label="Default GST rate % (when a product has none)" value={s.default_gst_rate} onChange={set('default_gst_rate')} min="0" />
        <label className="flex items-center gap-2 text-sm text-tertiary-700"><input type="checkbox" checked={Boolean(s.require_transfer_approval)} onChange={(e) => set('require_transfer_approval')(e.target.checked)} />Stock transfers need approval before dispatch</label>
      </div>
      <Text label="Reason for the change (optional, recorded in the audit log)" value={reason} onChange={setReason} maxLength={500} />
      <p className="text-xs text-tertiary-500">Currency: {s.currency}. Categories, projections, people and logins are managed in the other tabs and sections; none of them is fixed in code.</p>
      <div className="flex justify-end"><button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save settings'}</button></div>
    </form>
  );
}

function Audit() {
  const { pushError } = useAlerts();
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState(null);
  const load = useCallback(() => nxApi.audit({ entity, limit: 150 }).then(setRows, (e) => pushError(novarexError(e, 'Could not load'), 'Load failed')), [entity, pushError]);
  useEffect(() => { load(); }, [load]);
  const summary = (r) => {
    const a = r.after || {};
    if (r.entity === 'period') return `${a.month || r.before?.month || ''} ${r.action}`;
    if (r.entity === 'return') return `principal ${a.principal ?? ''} · earnings ${a.earnings ?? ''} ${a.status || ''}`;
    return a.name || a.status || a.kind || a.month || '';
  };
  return (
    <section className={`${card} space-y-3`}>
      <Select label="Show" value={entity} onChange={setEntity} blank="Everything" options={['investment', 'return', 'entry', 'projection', 'category', 'period', 'setting', 'person', 'user'].map((e) => ({ value: e, label: titleCase(e) }))} />
      {!rows ? <p className="text-sm text-tertiary-500">Loading...</p> : rows.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <span className="font-medium text-tertiary-900">{titleCase(r.entity)} · {r.action}</span>
              <span className="ml-2 text-xs text-tertiary-500">{dateLabel(r.created_at)}</span>
              <span className="block text-xs text-tertiary-600">{summary(r)}{r.reason ? ` - ${r.reason}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function NovarexSettingsPage() {
  const { me, loading } = useNovarex();
  const [tab, setTab] = useState('general');
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'settings')) return <Navigate to="/novarex" replace />;
  const tabs = [{ key: 'general', label: 'Settings' }, { key: 'categories', label: 'Categories' }, { key: 'teams', label: 'Teams & reporting' }, ...(nxCan(me, 'audit') ? [{ key: 'audit', label: 'Audit log' }] : [])];
  return (
    <div className="mt-4 space-y-4">
      <SectionTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'general' && <General />}
      {tab === 'categories' && <CategoriesManager canEdit={nxCan(me, 'categories')} />}
      {tab === 'teams' && <CompanyStructure />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
