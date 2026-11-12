import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { nxApi, novarexError } from '../../lib/novarex/api.js';
import { useNovarex, nxCan } from '../../lib/novarex/useNovarex.js';
import { useNxPickers } from '../../lib/novarex/pickers.js';
import { dateLabel } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import { Area, DateInput, Num, Select, Text, today } from '../../components/novarex/ui.jsx';
import { Btn, Kpi, Money, inputCls, num, titleOf, useAction, useRows } from '../../components/novarex/ops/common.jsx';

const AG_STATUS = ['draft', 'active', 'expired', 'terminated'];

function AgreementDrawer({ open, ag, outlets, onClose, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setErr(''); setV({ outlet_id: ag?.outlet_id || '', partner_name: ag?.partner_name || '', start_date: ag?.start_date || today(), end_date: ag?.end_date || '', renewal_date: ag?.renewal_date || '', initial_fee: ag?.initial_fee ?? '', royalty_pct: ag?.royalty_pct ?? '', revenue_share_pct: ag?.revenue_share_pct ?? '', purchase_discount_pct: ag?.purchase_discount_pct ?? '', security_deposit: ag?.security_deposit ?? '', payment_terms: ag?.payment_terms || '', status: ag?.status || 'draft', terms: ag?.terms || '', notes: ag?.notes || '' }); } }, [open, ag]);
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function save(e) {
    e.preventDefault(); setErr('');
    const n = (x) => (x === '' ? 0 : num(x));
    const body = { outlet_id: v.outlet_id, partner_name: v.partner_name, start_date: v.start_date, end_date: v.end_date || null, renewal_date: v.renewal_date || null, initial_fee: n(v.initial_fee), royalty_pct: n(v.royalty_pct), revenue_share_pct: n(v.revenue_share_pct), purchase_discount_pct: n(v.purchase_discount_pct), security_deposit: n(v.security_deposit), payment_terms: v.payment_terms || null, status: v.status, terms: v.terms || null, notes: v.notes || null };
    try { if (ag) await nxApi.ops.updateAgreement(ag.id, body); else await nxApi.ops.createAgreement(body); pushSuccess('Agreement saved'); onSaved(); onClose(); } catch (x) { setErr(novarexError(x, 'Could not save the agreement')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="xl" tone={ag ? 'edit' : 'create'} title={ag ? 'Edit franchise agreement' : 'New franchise agreement'}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Outlet" value={v.outlet_id} onChange={set('outlet_id')} options={outlets} blank="Select franchise or third-party outlet" required />
          <Text label="Franchisee / partner" value={v.partner_name} onChange={set('partner_name')} required />
          <DateInput label="Agreement start" value={v.start_date} onChange={set('start_date')} /><DateInput label="Agreement end" value={v.end_date} onChange={set('end_date')} />
          <DateInput label="Renewal date" value={v.renewal_date} onChange={set('renewal_date')} />
          <Select label="Status" value={v.status} onChange={set('status')} options={AG_STATUS.map((s) => ({ value: s, label: titleOf(s) }))} />
          <Num label="Initial franchise fee" value={v.initial_fee} onChange={set('initial_fee')} /><Num label="Security deposit" value={v.security_deposit} onChange={set('security_deposit')} />
          <Num label="Royalty % of reported sales" value={v.royalty_pct} onChange={set('royalty_pct')} /><Num label="Revenue share %" value={v.revenue_share_pct} onChange={set('revenue_share_pct')} />
          <Num label="Purchase discount %" value={v.purchase_discount_pct} onChange={set('purchase_discount_pct')} hint="Applied to the selling price of goods sold to this outlet" />
          <Text label="Payment terms" value={v.payment_terms} onChange={set('payment_terms')} />
        </div>
        <Area label="Contract terms" value={v.terms} onChange={set('terms')} rows={3} />
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save agreement</button></div>
      </form>
    </Drawer>
  );
}

function SettlementDrawer({ open, st, agreements, onClose, onSaved }) {
  const { pushSuccess } = useAlerts();
  const [v, setV] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setErr(''); setV({ agreement_id: st?.agreement_id || '', month: st?.month || today().slice(0, 7), kind: st?.kind || 'royalty', reported_sales: st?.reported_sales ?? '', basis_visible: st?.basis_visible ?? true, fee_due: st?.fee_due ?? '', notes: st?.notes || '' }); } }, [open, st]);
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  async function save(e) {
    e.preventDefault(); setErr('');
    const body = { month: v.month, kind: v.kind, reported_sales: v.reported_sales === '' ? 0 : num(v.reported_sales), basis_visible: v.basis_visible, ...(v.fee_due === '' ? {} : { fee_due: num(v.fee_due) }), notes: v.notes || null };
    try { if (st) await nxApi.ops.updateSettlement(st.id, body); else await nxApi.ops.createSettlement({ ...body, agreement_id: v.agreement_id }); pushSuccess('Settlement saved'); onSaved(); onClose(); } catch (x) { setErr(novarexError(x, 'Could not save the settlement')); }
  }
  return (
    <Drawer open={open} onClose={onClose} size="lg" tone={st ? 'edit' : 'create'} title={st ? 'Edit settlement' : 'New franchise settlement'}>
      <form onSubmit={save} className="space-y-3">
        <Select label="Agreement" value={v.agreement_id} onChange={set('agreement_id')} options={agreements.map((a) => ({ value: a.id, label: `${a.partner_name} · ${a.outlet}` }))} blank="Select agreement" required disabled={Boolean(st)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="Month (YYYY-MM)" value={v.month} onChange={set('month')} />
          <Select label="Kind" value={v.kind} onChange={set('kind')} options={[{ value: 'royalty', label: 'Royalty / revenue share' }, { value: 'fee', label: 'Recurring fee' }, { value: 'initial_fee', label: 'Initial franchise fee' }]} />
          <Num label="Sales reported by the franchisee" value={v.reported_sales} onChange={set('reported_sales')} hint="Only the basis for the royalty. It is never Novarex revenue" />
          <Num label="Fee amount" value={v.fee_due} onChange={set('fee_due')} hint="Leave blank for the agreement's initial fee on an initial-fee settlement" />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.basis_visible} onChange={(e) => set('basis_visible')(e.target.checked)} />The franchisee&apos;s sales figure is visible to Novarex (untick if only a fixed fee applies)</label>
        <Area label="Notes" value={v.notes} onChange={set('notes')} rows={2} />
        {err && <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save</button></div>
      </form>
    </Drawer>
  );
}

function PartnerReport({ outletId, name, onClose }) {
  const [r, setR] = useState(null);
  useEffect(() => { setR(null); if (outletId) nxApi.ops.franchiseReport(outletId, {}).then(setR, () => setR(false)); }, [outletId]);
  return (
    <Drawer open={Boolean(outletId)} onClose={onClose} size="xl" tone="info" title={`Franchise report: ${name || ''}`}>
      {r === null && <p className="text-sm text-tertiary-500">Loading...</p>}
      {r === false && <p className="text-sm text-danger-700">Could not load the report.</p>}
      {r && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Kpi label="Goods bought from Novarex" value={<Money v={r.purchases_from_novarex.invoiced} />} hint={`Paid ${r.purchases_from_novarex.paid}`} />
            <Kpi label="Goods outstanding" value={<Money v={r.purchases_from_novarex.outstanding} />} />
            <Kpi label="Orders / shipments" value={`${r.orders} / ${r.shipments}`} />
            <Kpi label="Fees and royalties invoiced" value={<Money v={r.fees_and_royalties.invoiced} />} />
            <Kpi label="Fees received" value={<Money v={r.fees_and_royalties.received} />} />
            <Kpi label="Fees outstanding" value={<Money v={r.fees_and_royalties.outstanding} />} />
          </div>
          <p className="text-xs text-tertiary-500">Sales reported by the franchisee (royalty basis only, not Novarex revenue): <Money v={r.reported_sales} /></p>
          <DataTable embedded columns={[{ key: 'm', header: 'Month', render: (s) => s.month }, { key: 'k', header: 'Kind', render: (s) => titleOf(s.kind) }, { key: 'r', header: 'Reported sales', render: (s) => <Money v={s.reported_sales} /> }, { key: 't', header: 'Total due', render: (s) => <Money v={s.total_due} /> }, { key: 's', header: 'Status', render: (s) => <Pill value={s.status} tone={s.status === 'settled' ? 'green' : s.status === 'invoiced' ? 'blue' : 'gray'} /> }]} rows={r.settlements} emptyLabel="No settlements yet." />
        </div>
      )}
    </Drawer>
  );
}

/** Franchise and third-party partners: agreements, fees and royalties, settlements and a per-partner report. */
export default function NovarexFranchisePage() {
  const { me, loading } = useNovarex();
  const navigate = useNavigate();
  const nxp = useNxPickers({ people: false });
  const [tab, setTab] = useState('agreements');
  const [status, setStatus] = useState('');
  const [agDrawer, setAgDrawer] = useState({ open: false, ag: null });
  const [stDrawer, setStDrawer] = useState({ open: false, st: null });
  const [report, setReport] = useState(null);
  const canEdit = nxCan(me, 'franchiseEdit');
  const ags = useRows(() => nxApi.ops.agreements({ status }), [status]);
  const sts = useRows(() => (tab === 'settlements' ? nxApi.ops.settlements({}) : null), [tab]);
  const act = useAction(() => Promise.all([ags.reload(), sts.reload()]));
  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (me && !nxCan(me, 'franchise')) return <Navigate to="/novarex" replace />;
  const rows = ags.rows || [];
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Active agreements" value={rows.filter((a) => a.status === 'active').length} />
        <Kpi label="Renewals due" value={rows.filter((a) => a.renewal_due).length} tone={rows.some((a) => a.renewal_due) ? 'text-amber-700' : undefined} hint="Renewal or end date within 60 days" />
        <Kpi label="Receivable from partners" value={<Money v={rows.reduce((a, r) => a + r.receivable, 0)} />} hint="Goods and fees not yet paid" />
        <Kpi label="Fees and royalties invoiced" value={<Money v={rows.reduce((a, r) => a + r.fees_invoiced, 0)} />} />
      </div>
      <SectionTabs tabs={[{ key: 'agreements', label: 'Agreements' }, { key: 'settlements', label: 'Fees, royalties and settlements' }]} value={tab} onChange={setTab} />
      {tab === 'agreements' && (
        <>
          <div className="flex flex-wrap items-end gap-2"><select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{AG_STATUS.map((s) => <option key={s} value={s}>{titleOf(s)}</option>)}</select>{canEdit && <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => setAgDrawer({ open: true, ag: null })}><Plus className="h-4 w-4" />New agreement</button>}</div>
          <DataTable columns={[{ key: 'o', header: 'Outlet / partner', render: (r) => <span><span className="font-medium text-tertiary-900">{r.partner_name}</span><span className="block text-xs text-tertiary-500">{r.outlet} {r.outlet_code}</span></span> }, { key: 'p', header: 'Term', render: (r) => `${dateLabel(r.start_date)} to ${r.end_date ? dateLabel(r.end_date) : 'open'}` }, { key: 'r', header: 'Royalty / share', render: (r) => `${r.royalty_pct}% / ${r.revenue_share_pct}%` }, { key: 'd', header: 'Purchase discount', render: (r) => `${r.purchase_discount_pct}%` }, { key: 'f', header: 'Initial fee / deposit', render: (r) => <span><Money v={r.initial_fee} /> / <Money v={r.security_deposit} /></span> }, { key: 'rc', header: 'Receivable', render: (r) => <Money v={r.receivable} /> }, { key: 's', header: 'Status', render: (r) => <span className="flex flex-wrap gap-1"><Pill value={r.status} />{r.renewal_due && <Pill tone="amber">Renewal due</Pill>}{r.expired && <Pill tone="red">Ended</Pill>}</span> }, { key: 'a', header: '', render: (r) => (<span className="flex justify-end gap-1"><Btn onClick={() => setReport({ id: r.outlet_id, name: r.partner_name })}>Report</Btn>{canEdit && <Btn onClick={() => setAgDrawer({ open: true, ag: r })}>Edit</Btn>}{canEdit && <Btn danger onClick={() => act(() => nxApi.ops.archiveAgreement(r.id), { confirm: `Archive the agreement with ${r.partner_name}?`, done: 'Archived' })}>Archive</Btn>}</span>) }]} rows={rows} loading={!ags.rows} emptyLabel="No franchise agreements yet. Outlets of type franchise or third-party can have one." />
        </>
      )}
      {tab === 'settlements' && (
        <>
          <div className="flex justify-end">{canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setStDrawer({ open: true, st: null })}><Plus className="h-4 w-4" />New settlement</button>}</div>
          <DataTable columns={[{ key: 'm', header: 'Month', render: (r) => r.month }, { key: 'o', header: 'Outlet / partner', render: (r) => <span>{r.partner}<span className="block text-xs text-tertiary-500">{r.outlet}</span></span> }, { key: 'k', header: 'Kind', render: (r) => titleOf(r.kind) }, { key: 'rs', header: 'Reported sales', render: (r) => <Money v={r.reported_sales} /> }, { key: 'ro', header: 'Royalty', render: (r) => <Money v={r.royalty_due} /> }, { key: 'sh', header: 'Revenue share', render: (r) => <Money v={r.share_due} /> }, { key: 'fe', header: 'Fee', render: (r) => <Money v={r.fee_due} /> }, { key: 't', header: 'Total due (excl. GST)', render: (r) => <Money v={r.total_due} /> }, { key: 's', header: 'Status', render: (r) => <Pill value={r.status} tone={r.status === 'settled' ? 'green' : r.status === 'invoiced' ? 'blue' : 'gray'} /> }, { key: 'a', header: '', render: (r) => canEdit && r.status === 'draft' && (<span className="flex justify-end gap-1"><Btn onClick={() => setStDrawer({ open: true, st: r })}>Edit</Btn><Btn primary onClick={() => act(() => nxApi.ops.invoiceSettlement(r.id, {}), { confirm: 'Create the invoice (18% GST) and book the fee as income on this outlet?', done: 'Invoice created. Record the payment under Invoices.' })}>Invoice</Btn></span>) }, { key: 'i', header: '', render: (r) => r.invoice_id && <Btn onClick={() => navigate('/novarex/invoices')}>Invoices</Btn> }]} rows={sts.rows || []} loading={!sts.rows} emptyLabel="No settlements yet." />
        </>
      )}
      <AgreementDrawer open={agDrawer.open} ag={agDrawer.ag} outlets={nxp.outlets} onClose={() => setAgDrawer({ open: false, ag: null })} onSaved={ags.reload} />
      <SettlementDrawer open={stDrawer.open} st={stDrawer.st} agreements={rows} onClose={() => setStDrawer({ open: false, st: null })} onSaved={() => { sts.reload(); ags.reload(); }} />
      <PartnerReport outletId={report?.id} name={report?.name} onClose={() => setReport(null)} />
    </div>
  );
}
