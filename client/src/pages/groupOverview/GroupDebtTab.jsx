import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarClock, Landmark, Percent, Plus, Settings2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { AXIS_TICK, ChartFrame, GRID_PROPS, KpiTile, SectionHeading, compact, lineProps, money } from './groupUi.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
const TYPE_LABEL = { bank_loan: 'Bank loan', business_loan: 'Business loan', property_loan: 'Property loan', vehicle_loan: 'Car / vehicle loan', credit_limit: 'Credit limit', other: 'Other' };
const BASIS_LABEL = { valuation: 'group valuation', assets: 'group assets', revenue: 'yearly revenue' };
const FREQ_LABEL = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const RATIO_TONE = { ok: 'green', warning: 'amber', over: 'red', unknown: 'gray' };
const dateText = (s) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-');
const BLANK = { name: '', lender: '', loan_type: 'bank_loan', org_id: '', collateral: '', principal: '', interest_rate: '', rate_type: 'fixed', start_date: '', tenure_months: '', emi_amount: '', emi_frequency: 'monthly', sanctioned_limit: '', emis_paid: '0', notes: '' };

function LoanForm({ initial, companies, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => (initial ? { ...BLANK, ...Object.fromEntries(Object.entries(initial).filter(([k]) => k in BLANK).map(([k, x]) => [k, x ?? ''])) } : BLANK));
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const limit = v.loan_type === 'credit_limit';
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = { ...v };
        for (const k of ['principal', 'interest_rate', 'tenure_months', 'emi_amount', 'sanctioned_limit', 'emis_paid']) body[k] = v[k] === '' ? null : Number(v[k]);
        if (!initial) body.emis_paid = Number(v.emis_paid || 0); else delete body.emis_paid;
        if (body.interest_rate === null) body.interest_rate = 0;
        if (limit) { body.tenure_months = null; body.emi_amount = null; }
        onSubmit(body);
      }}
    >
      <label className={labelCls}>Loan name<input required className={inputCls} value={v.name} onChange={set('name')} maxLength={200} placeholder="e.g. Office building loan" autoFocus /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Lender / bank<input required className={inputCls} value={v.lender} onChange={set('lender')} maxLength={200} /></label>
        <label className={labelCls}>Type
          <select className={inputCls} value={v.loan_type} onChange={set('loan_type')}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className={labelCls}>Company that owes it
          <select className={inputCls} value={v.org_id} onChange={set('org_id')}><option value="">The group itself</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className={labelCls}>Collateral / security<input className={inputCls} value={v.collateral} onChange={set('collateral')} maxLength={300} /></label>
        <label className={labelCls}>{limit ? 'Amount drawn now' : 'Loan amount (principal)'}<input required type="number" min="0.01" step="any" className={inputCls} value={v.principal} onChange={set('principal')} /></label>
        {limit && <label className={labelCls}>Sanctioned limit<input type="number" min="0" step="any" className={inputCls} value={v.sanctioned_limit} onChange={set('sanctioned_limit')} /></label>}
        <label className={labelCls}>Interest rate % a year<input type="number" min="0" max="100" step="any" className={inputCls} value={v.interest_rate} onChange={set('interest_rate')} /></label>
        <label className={labelCls}>Rate type
          <select className={inputCls} value={v.rate_type} onChange={set('rate_type')}><option value="fixed">Fixed</option><option value="floating">Floating</option></select>
        </label>
        <label className={labelCls}>Start date<input required type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} /></label>
        {!limit && <label className={labelCls}>Tenure (months)<input type="number" min="1" max="600" className={inputCls} value={v.tenure_months} onChange={set('tenure_months')} /></label>}
        {!limit && <label className={labelCls}>EMI frequency
          <select className={inputCls} value={v.emi_frequency} onChange={set('emi_frequency')}>{Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>}
        {!limit && <label className={labelCls}>EMI amount<input type="number" min="0" step="any" className={inputCls} value={v.emi_amount} onChange={set('emi_amount')} placeholder="Blank = worked out" /></label>}
        {!initial && !limit && <label className={labelCls}>EMIs already paid<input type="number" min="0" className={inputCls} value={v.emis_paid} onChange={set('emis_paid')} /><span className="text-[11px] font-normal text-tertiary-400">For a loan that is already running: those instalments are marked paid.</span></label>}
      </div>
      <label className={labelCls}>Notes<textarea rows={2} className={inputCls} value={v.notes} onChange={set('notes')} maxLength={4000} /></label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save loan'}</button>
      </div>
    </form>
  );
}

function RatioCard({ ratio, onSettings }) {
  const pct = ratio.ratio_pct;
  const width = pct == null ? 0 : Math.min(100, (pct / Math.max(ratio.limit_pct, 1)) * 100);
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="debt-ratio">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Loan ratio</p>
          <p className="font-heading text-3xl font-bold text-tertiary-900">{pct == null ? 'N/A' : `${pct}%`}</p>
          <p className="text-xs text-tertiary-500">Outstanding debt {compact(ratio.debt)} against {BASIS_LABEL[ratio.basis]} {ratio.base_amount != null ? compact(ratio.base_amount) : '(not available)'}</p>
        </div>
        <div className="text-right text-sm">
          <Pill tone={RATIO_TONE[ratio.status]}>{ratio.status === 'over' ? 'Over the limit' : ratio.status === 'warning' ? 'Close to the limit' : ratio.status === 'ok' ? 'Within the limit' : 'No base to compare'}</Pill>
          <p className="mt-1 text-xs text-tertiary-500">Limit {ratio.limit_pct}% {ratio.headroom != null && <>· {ratio.headroom >= 0 ? `room for ${compact(ratio.headroom)} more` : `${compact(-ratio.headroom)} above the limit`}</>}</p>
          {ratio.interest_cover != null && <p className="text-xs text-tertiary-500">Yearly interest {compact(ratio.yearly_interest)} · profit covers it {ratio.interest_cover}x</p>}
          <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline" onClick={onSettings}><Settings2 className="h-3.5 w-3.5" />Change limit</button>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full rounded-full ${ratio.status === 'over' ? 'bg-danger-500' : ratio.status === 'warning' ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${width}%` }} /></div>
    </section>
  );
}

function Breakdown({ title, rows, label }) {
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{title}</p>
      {rows.length === 0 ? <p className="text-sm text-tertiary-400">Nothing yet</p> : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => <li key={r.key} className="flex items-center justify-between gap-2"><span className="truncate text-tertiary-700">{label ? label(r.key) : r.key}<span className="ml-1 text-xs text-tertiary-400">{r.loans} loan{r.loans === 1 ? '' : 's'}</span></span><b className="tabular-nums text-tertiary-900">{compact(r.outstanding)}</b></li>)}
        </ul>
      )}
    </section>
  );
}

function LoanDrawer({ loan, onClose, onEdit, onChanged, onDelete }) {
  const { pushError } = useAlerts();
  const [busy, setBusy] = useState(false);
  if (!loan) return null;
  const readOnly = loan.source !== 'group';
  const s = loan.summary;
  async function mark(seq, paid) {
    setBusy(true);
    try { await apiClient.put(`/super-dashboard/group/debt/loans/${loan.id}/installments/${seq}`, { paid }); await onChanged(loan.id); } catch (err) { pushError(apiErrorMessage(err, 'Could not update the instalment'), 'Something went wrong'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4" data-testid="loan-detail">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="blue">{TYPE_LABEL[loan.loan_type]}</Pill>
        {s.closed && <Pill tone="gray">Closed</Pill>}
        {s.emis_overdue > 0 && <Pill tone="red">{s.emis_overdue} overdue</Pill>}
        {!readOnly && <button type="button" className="btn-secondary text-sm" onClick={onEdit}>Edit</button>}
        {!readOnly && <button type="button" className="btn-secondary text-sm text-danger-700" onClick={onDelete}>Delete</button>}
      </div>
      {readOnly && <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-xs text-tertiary-600">This loan is managed in the company&apos;s own module and is shown here read only.</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {[['Lender', loan.lender], ['Company', loan.company?.name || 'The group'], ['Principal', money(loan.principal)], ['Interest', `${loan.interest_rate}% ${loan.rate_type}`], ['Start', dateText(loan.start_date)], ['Ends', dateText(s.end_date)],
          ['Outstanding', money(s.outstanding)], ['Principal paid', money(s.principal_paid)], ['Interest paid', money(s.interest_paid)], ['Interest still to pay', money(s.interest_remaining)],
          ['EMIs', s.emis_total ? `${s.emis_paid} paid, ${s.emis_pending} to go` : '-'], ['Next due', s.next_due ? `${dateText(s.next_due.due_date)} · ${money(s.next_due.amount)}` : '-'],
          ...(loan.sanctioned_limit ? [['Sanctioned limit', money(loan.sanctioned_limit)]] : []), ...(loan.collateral ? [['Collateral', loan.collateral]] : [])].map(([k, x]) => (
          <div key={k}><dt className="text-xs text-tertiary-500">{k}</dt><dd className="font-medium text-tertiary-900">{x}</dd></div>
        ))}
      </dl>
      {loan.installments.length > 0 && (
        <section className="space-y-2">
          <h4 className="font-heading text-sm font-semibold text-tertiary-800">Repayment schedule</h4>
          <div className="max-h-96 overflow-auto rounded-xl border border-tertiary-100">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-tertiary-50 text-left text-tertiary-500"><tr><th className="px-2 py-1.5">#</th><th className="px-2">Due</th><th className="px-2 text-right">EMI</th><th className="px-2 text-right">Principal</th><th className="px-2 text-right">Interest</th><th className="px-2 text-right">Balance</th><th className="px-2" /></tr></thead>
              <tbody>
                {loan.installments.map((r) => (
                  <tr key={r.seq} className={`border-t border-tertiary-100 ${r.status === 'paid' ? 'bg-green-50/50 text-tertiary-500' : ''}`} data-testid="installment-row">
                    <td className="px-2 py-1.5">{r.seq}</td><td className="px-2">{dateText(r.due_date)}</td>
                    <td className="px-2 text-right tabular-nums">{money(r.amount)}</td><td className="px-2 text-right tabular-nums">{money(r.principal_part)}</td><td className="px-2 text-right tabular-nums">{money(r.interest_part)}</td><td className="px-2 text-right tabular-nums">{money(r.balance_after)}</td>
                    <td className="px-2 text-right">
                      <button type="button" disabled={busy} className="rounded-lg border border-tertiary-200 px-2 py-0.5 text-[11px] font-medium text-primary-700 hover:bg-primary-50" onClick={() => mark(r.seq, r.status !== 'paid')}>{r.status === 'paid' ? 'Undo' : 'Mark paid'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-tertiary-400">Marking an EMI paid also marks every earlier one; undoing one also undoes every later one.</p>
        </section>
      )}
      {loan.notes && <p className="whitespace-pre-wrap text-sm text-tertiary-600">{loan.notes}</p>}
    </div>
  );
}

/** Group Dashboard > Debt Management: every loan and credit limit of the group and its companies, EMIs paid and pending, and the loan ratio. */
export default function GroupDebtTab() {
  const { pushError, pushSuccess } = useAlerts();
  const data = useLiveData(() => apiClient.get('/super-dashboard/group/debt').then((r) => r.data.data), { intervalMs: 120000 });
  const [drawer, setDrawer] = useState(null); // { mode: 'create' | 'edit' | 'view' | 'settings', loan? }
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState({ max_debt_ratio_pct: '30', ratio_basis: 'valuation' });
  const d = data.data;

  async function open(row) {
    if (row.source !== 'group') { setDrawer({ mode: 'view', loan: row }); return; }
    try { setDrawer({ mode: 'view', loan: (await apiClient.get(`/super-dashboard/group/debt/loans/${row.id}`)).data.data }); } catch (err) { pushError(apiErrorMessage(err, 'Could not open the loan'), 'Something went wrong'); }
  }
  async function reload(id) {
    const loan = (await apiClient.get(`/super-dashboard/group/debt/loans/${id}`)).data.data;
    setDrawer({ mode: 'view', loan });
    data.refresh();
  }
  async function save(body) {
    setSaving(true);
    try {
      const res = drawer.mode === 'create' ? await apiClient.post('/super-dashboard/group/debt/loans', body) : await apiClient.patch(`/super-dashboard/group/debt/loans/${drawer.loan.id}`, body);
      pushSuccess('Loan saved');
      setDrawer({ mode: 'view', loan: res.data.data });
      data.refresh();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not save the loan'), 'Could not save'); } finally { setSaving(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete ${drawer.loan.name}?`)) return;
    try { await apiClient.delete(`/super-dashboard/group/debt/loans/${drawer.loan.id}`); setDrawer(null); data.refresh(); } catch (err) { pushError(apiErrorMessage(err, 'Could not delete'), 'Something went wrong'); }
  }
  async function saveLimit(e) {
    e.preventDefault();
    setSaving(true);
    try { await apiClient.put('/super-dashboard/group/debt/settings', { max_debt_ratio_pct: Number(limit.max_debt_ratio_pct), ratio_basis: limit.ratio_basis }); setDrawer(null); data.refresh(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save the limit'), 'Could not save'); } finally { setSaving(false); }
  }

  if (!d) return <p className="py-8 text-center text-sm text-tertiary-500">{data.loading ? 'Loading debt…' : 'Debt could not be loaded.'}</p>;
  const t = d.totals;
  return (
    <div className="space-y-4" data-testid="group-debt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-heading text-lg font-semibold text-tertiary-900">Debt Management</h2><p className="text-xs text-tertiary-500">Loans, credit limits and EMIs of the group and its companies, and how much debt the group carries against its size.</p></div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />Add loan</button>
      </div>

      <RatioCard ratio={d.ratio} onSettings={() => { setLimit({ max_debt_ratio_pct: String(d.settings.max_debt_ratio_pct), ratio_basis: d.settings.ratio_basis }); setDrawer({ mode: 'settings' }); }} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Outstanding debt" value={compact(t.outstanding)} hint={`${t.loans} active loan${t.loans === 1 ? '' : 's'}`} icon={Landmark} theme="purple" />
        <KpiTile label="EMIs a month" value={compact(t.monthly_emi)} hint="all loans" icon={Wallet} theme="blue" />
        <KpiTile label="Average interest" value={t.weighted_rate != null ? `${t.weighted_rate}%` : 'N/A'} hint="weighted by outstanding" icon={Percent} theme="orange" />
        <KpiTile label="Interest paid" value={compact(t.interest_paid)} hint={`${compact(t.interest_remaining)} still to pay`} icon={Percent} theme="green" />
        <KpiTile label="Overdue EMIs" value={t.overdue_emis} hint={t.overdue_emis ? 'mark them paid when cleared' : 'none'} icon={AlertTriangle} theme={t.overdue_emis ? 'red' : 'green'} />
        <KpiTile label="Next EMI" value={t.next_due ? dateText(t.next_due.due_date) : 'N/A'} hint={t.next_due ? `${compact(t.next_due.amount)} · ${t.next_due.loan}` : ' '} icon={CalendarClock} theme="blue" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Breakdown title="By type" rows={d.by_type} label={(k) => TYPE_LABEL[k] || k} />
        <Breakdown title="By company" rows={d.by_company} />
        <Breakdown title="By lender" rows={d.by_lender} />
      </div>

      <SectionHeading title="Repayments in the next 12 months" hint="principal and interest due, from the pending EMIs" />
      <ChartFrame>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={d.repayments} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="month" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} tickFormatter={(v) => compact(v)} width={70} />
            <RTooltip formatter={(v) => money(v)} />
            <Line dataKey="total" name="Total due" {...lineProps('#2b5d9e', d.repayments.length)} />
            <Line dataKey="principal" name="Principal" {...lineProps('#1f6f50', d.repayments.length)} />
            <Line dataKey="interest" name="Interest" {...lineProps('#b9822a', d.repayments.length, { dashed: true })} />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      <SectionHeading title="All loans" hint="click a loan for its repayment schedule" />
      {d.loans.length === 0 ? <EmptyState title="No loans yet" description="Add a loan or a credit limit to start tracking the group's debt." /> : (
        <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-tertiary-50 text-left text-xs uppercase tracking-wide text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Loan</th><th className="px-3 font-medium">Company</th><th className="px-3 text-right font-medium">Principal</th><th className="px-3 text-right font-medium">Rate</th><th className="px-3 font-medium">EMIs</th><th className="px-3 text-right font-medium">Outstanding</th><th className="px-3 font-medium">Next due</th><th className="px-3 font-medium">Ends</th></tr></thead>
            <tbody>
              {d.loans.map((l) => (
                <tr key={l.id} className="cursor-pointer border-t border-tertiary-100 hover:bg-primary-50/40" data-testid="loan-row" onClick={() => open(l)}>
                  <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{l.name}</span><span className="block text-xs text-tertiary-500">{l.lender} · {TYPE_LABEL[l.loan_type]}{l.source !== 'group' ? ' · Zephyr' : ''}</span></td>
                  <td className="px-3">{l.company?.name || 'Group'}</td>
                  <td className="px-3 text-right tabular-nums">{compact(l.principal)}</td>
                  <td className="px-3 text-right">{l.interest_rate}%</td>
                  <td className="px-3">{l.summary.emis_total ? <><span className="tabular-nums">{l.summary.emis_paid}/{l.summary.emis_total}</span><span className="mt-1 block h-1.5 w-24 overflow-hidden rounded-full bg-tertiary-100"><span className="block h-full bg-primary-500" style={{ width: `${l.summary.progress_pct || 0}%` }} /></span>{l.summary.emis_overdue > 0 && <span className="text-[11px] text-danger-600">{l.summary.emis_overdue} overdue</span>}</> : <span className="text-tertiary-400">-</span>}</td>
                  <td className="px-3 text-right font-semibold tabular-nums">{compact(l.summary.outstanding)}</td>
                  <td className="px-3 text-xs">{l.summary.next_due ? `${dateText(l.summary.next_due.due_date)} · ${compact(l.summary.next_due.amount)}` : l.summary.closed ? 'Closed' : '-'}</td>
                  <td className="px-3 text-xs">{dateText(l.summary.end_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={Boolean(drawer)} onClose={() => !saving && setDrawer(null)} size="lg" tone={drawer?.mode === 'view' ? 'info' : drawer?.mode === 'create' ? 'create' : 'edit'} title={drawer?.mode === 'create' ? 'Add a loan' : drawer?.mode === 'edit' ? `Edit ${drawer.loan.name}` : drawer?.mode === 'settings' ? 'Loan ratio limit' : drawer?.loan?.name || ''}>
        {drawer?.mode === 'create' && <LoanForm companies={d.companies} onSubmit={save} onCancel={() => setDrawer(null)} saving={saving} />}
        {drawer?.mode === 'edit' && <LoanForm initial={drawer.loan} companies={d.companies} onSubmit={save} onCancel={() => setDrawer({ mode: 'view', loan: drawer.loan })} saving={saving} />}
        {drawer?.mode === 'view' && <LoanDrawer loan={drawer.loan} onClose={() => setDrawer(null)} onEdit={() => setDrawer({ mode: 'edit', loan: drawer.loan })} onChanged={reload} onDelete={remove} />}
        {drawer?.mode === 'settings' && (
          <form className="space-y-3" onSubmit={saveLimit}>
            <p className="text-sm text-tertiary-600">The group should not carry more debt than this share of its size. The ratio card turns amber near the limit and red above it.</p>
            <label className={labelCls}>Maximum loan ratio %<input required type="number" min="0" max="1000" step="any" className={inputCls} value={limit.max_debt_ratio_pct} onChange={(e) => setLimit((c) => ({ ...c, max_debt_ratio_pct: e.target.value }))} /></label>
            <label className={labelCls}>Measured against
              <select className={inputCls} value={limit.ratio_basis} onChange={(e) => setLimit((c) => ({ ...c, ratio_basis: e.target.value }))}><option value="valuation">Group valuation</option><option value="assets">Group assets</option><option value="revenue">Yearly revenue</option></select>
            </label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setDrawer(null)}>Cancel</button><button type="submit" className="btn-primary" disabled={saving}>Save limit</button></div>
          </form>
        )}
      </Drawer>
    </div>
  );
}
