import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { axCan } from '../../lib/acconcy/useAcconcy.js';
import { INVESTEE_STAGES, INVESTEE_STAGE_META, pctLabel } from '../../lib/acconcy/meta.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import FilterBar from '../../components/zephyr/FilterBar.jsx';
import { Area, DateInput, Detail, Empty, Kpi, Money, Num, Section, Select, Text, dayOf, today, toBody, withReason } from '../../components/acconcy/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const NUMS = ['proposed_amount', 'proposed_stake_pct', 'expected_return_pct', 'stake_pct', 'valuation'];
const FIELDS = ['name', 'sector', 'stage', 'website', 'contact_name', 'contact_email', 'proposed_amount', 'proposed_stake_pct', 'expected_return_pct', 'stake_pct', 'valuation', 'discussion_notes', 'notes'];
const PIPELINE = ['discussion', 'committed'];
const gainTone = (n) => (n > 0 ? 'text-green-700' : n < 0 ? 'text-red-600' : '');

function InvesteeForm({ initial, onSubmit, onCancel, saving }) {
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, initial?.[k] ?? (k === 'stage' ? 'discussion' : '')])));
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  const expected = v.proposed_amount !== '' && v.expected_return_pct !== '' ? (Number(v.proposed_amount) * Number(v.expected_return_pct)) / 100 : null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); const body = toBody(v, { numbers: NUMS }); body.name = v.name.trim(); onSubmit(body); }} className="space-y-4">
      <Section title="Company">
        <Text label="Company name" className="sm:col-span-2" value={v.name} onChange={set('name')} required maxLength={200} autoFocus />
        <Text label="Sector" value={v.sector} onChange={set('sector')} maxLength={120} />
        <Select label="Stage" value={v.stage} onChange={set('stage')} options={INVESTEE_STAGES.map((s) => ({ value: s.value, label: s.label }))} required />
        <Text label="Contact person" value={v.contact_name} onChange={set('contact_name')} maxLength={200} />
        <Text label="Contact email" value={v.contact_email} onChange={set('contact_email')} maxLength={200} />
        <Text label="Website" className="sm:col-span-2" value={v.website} onChange={set('website')} maxLength={300} />
      </Section>
      <Section title="Proposal" hint="What is being discussed. Real money goes in through Fund this company.">
        <Num label="Proposed investment" value={v.proposed_amount} onChange={set('proposed_amount')} />
        <Num label="Proposed stake %" value={v.proposed_stake_pct} onChange={set('proposed_stake_pct')} max="100" />
        <Num label="Expected return % (per year)" value={v.expected_return_pct} onChange={set('expected_return_pct')} hint={expected !== null ? `Expected return about ${Math.round(expected).toLocaleString('en-IN')} a year` : undefined} />
        <Num label="Company valuation" value={v.valuation} onChange={set('valuation')} />
        <Area label="Discussion notes" className="sm:col-span-2" rows={3} value={v.discussion_notes} onChange={set('discussion_notes')} maxLength={20000} />
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </Section>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save company'}</button>
      </div>
    </form>
  );
}

function FundForm({ company, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ investment_date: today(), amount: company.proposed_amount ?? '', equity_pct: company.proposed_stake_pct ?? '', current_value: '', takeover: false, notes: '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...toBody(v, { numbers: ['amount', 'equity_pct', 'current_value'] }), takeover: v.takeover }); }} className="space-y-3">
      <p className="text-sm text-tertiary-600">Records the money put into <b>{company.name}</b> as an investment round. The company moves to {v.takeover ? 'Taken over' : 'Funded'}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DateInput label="Date" value={v.investment_date} onChange={set('investment_date')} required />
        <Num label="Amount invested" value={v.amount} onChange={set('amount')} required min="0.01" />
        <Num label="Stake bought in this round %" value={v.equity_pct} onChange={set('equity_pct')} max="100" />
        <Num label="Current value" value={v.current_value} onChange={set('current_value')} hint="Blank = the amount invested" />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.takeover} onChange={(e) => set('takeover')(e.target.checked)} />This is a takeover</label>
        <Area label="Notes" className="sm:col-span-2" rows={2} value={v.notes} onChange={set('notes')} maxLength={4000} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || v.amount === ''}>{saving ? 'Saving...' : 'Record funding'}</button>
      </div>
    </form>
  );
}

// Cash that came back from one round: a dividend / income (no cost released), a part sale, or the full exit.
function ReturnForm({ round, onSubmit, onCancel, saving }) {
  const [v, setV] = useState({ kind: 'dividend', realised_date: today(), amount_received: '', cost_released: '' });
  const set = (k) => (val) => setV((c) => ({ ...c, [k]: val }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body = { realised_date: v.realised_date, amount_received: Number(v.amount_received) };
        if (v.kind === 'dividend') body.cost_released = 0;
        else if (v.kind === 'exit') body.full = true;
        else body.cost_released = Number(v.cost_released);
        onSubmit(body);
      }}
      className="space-y-3"
    >
      <p className="text-sm text-tertiary-600">Cash actually received from <b>{round.name}</b>. Only the gain is posted to revenue.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="What came back" value={v.kind} onChange={set('kind')} options={[{ value: 'dividend', label: 'Dividend / income (keeps the holding)' }, { value: 'part', label: 'Part sale' }, { value: 'exit', label: 'Full exit' }]} required />
        <DateInput label="Date" value={v.realised_date} onChange={set('realised_date')} required min={dayOf(round.investment_date)} />
        <Num label="Amount received" value={v.amount_received} onChange={set('amount_received')} required />
        {v.kind === 'part' && <Num label="Cost released" value={v.cost_released} onChange={set('cost_released')} required />}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={saving || v.amount_received === ''}>{saving ? 'Saving...' : 'Record return'}</button>
      </div>
    </form>
  );
}

function CompanyTable({ rows, onOpen, pipeline }) {
  if (!rows.length) return <Empty>{pipeline ? 'Nothing is under discussion.' : 'No company has been funded yet.'}</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500">
          {pipeline ? (
            <tr><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 text-right font-medium">Proposed</th><th className="px-3 py-2 text-right font-medium">Stake</th><th className="px-3 py-2 text-right font-medium">Expected return</th></tr>
          ) : (
            <tr><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 text-right font-medium">Stake</th><th className="px-3 py-2 text-right font-medium">Invested</th><th className="px-3 py-2 text-right font-medium">Current value</th><th className="px-3 py-2 text-right font-medium">Returned</th><th className="px-3 py-2 text-right font-medium">Gain / loss</th><th className="px-3 py-2 text-right font-medium">Multiple</th></tr>
          )}
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer border-t hover:bg-primary-50/40" data-testid="investee-row" onClick={() => onOpen(r)}>
              <td className="px-3 py-2"><span className="font-medium text-tertiary-900">{r.name}</span><span className="block text-xs text-tertiary-500">{r.sector || '-'}</span></td>
              <td className="px-3 py-2"><Pill tone={INVESTEE_STAGE_META[r.stage]?.tone}>{INVESTEE_STAGE_META[r.stage]?.label}</Pill></td>
              {pipeline ? (
                <>
                  <td className="px-3 py-2 text-right"><Money v={r.proposed_amount} /></td>
                  <td className="px-3 py-2 text-right">{pctLabel(r.proposed_stake_pct)}</td>
                  <td className="px-3 py-2 text-right">{r.expected_return_pct != null ? `${r.expected_return_pct}%` : '-'}{r.expected_return_amount != null && <span className="block text-[11px] text-tertiary-400"><Money v={r.expected_return_amount} /> a year</span>}</td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 text-right">{pctLabel(r.stake_pct)}</td>
                  <td className="px-3 py-2 text-right"><Money v={r.invested} /><span className="block text-[11px] text-tertiary-400">{r.rounds_count} round{r.rounds_count === 1 ? '' : 's'}</span></td>
                  <td className="px-3 py-2 text-right"><Money v={r.current_value} /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.amount_received} /></td>
                  <td className="px-3 py-2 text-right"><Money v={r.gain_loss} signed className="font-semibold" /><span className="block text-[11px] text-tertiary-400">{pctLabel(r.gain_loss_pct)}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.multiple != null ? `${r.multiple}x` : '-'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Investments > Portfolio companies: who Acconcy is discussing with, who it has funded or taken over, and what each one returns. */
export default function AcconcyInvesteesTab({ me }) {
  const { pushError, pushSuccess } = useAlerts();
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [res, setRes] = useState({ rows: [], totals: null });
  const [fetching, setFetching] = useState(true);
  const [drawer, setDrawer] = useState(null); // { mode: 'create' | 'edit' | 'view' | 'fund' | 'return', company?, round? }
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);
  const canEdit = axCan(me, 'investments');

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setFetching(true);
    try {
      const r = await acconcyApi.investees(Object.fromEntries(Object.entries({ stage, q: dq }).filter(([, v]) => v)));
      if (id === reqId.current) setRes({ rows: r.data, totals: r.totals });
    } catch (e) {
      if (id === reqId.current) pushError(acconcyError(e, 'Could not load the companies'), 'Load failed');
    } finally {
      if (id === reqId.current) setFetching(false);
    }
  }, [stage, dq, pushError]);
  useEffect(() => { load(); }, [load]);

  const company = drawer?.company;
  async function reload(id) {
    const fresh = await acconcyApi.investee(id);
    setDrawer({ mode: 'view', company: fresh });
    load();
  }
  async function run(fn, done) {
    setSaving(true);
    try { await fn(); pushSuccess(done); } catch (e) { pushError(acconcyError(e, 'Could not save'), 'Could not save'); } finally { setSaving(false); }
  }
  const save = (body) => run(async () => {
    const out = await withReason((reason) => {
      const payload = { ...body, ...(reason ? { reason } : {}) };
      return drawer.mode === 'create' ? acconcyApi.createInvestee(payload) : acconcyApi.updateInvestee(company.id, payload);
    });
    setDrawer({ mode: 'view', company: out });
    load();
  }, 'Saved');
  const fund = (body) => run(async () => { const out = await withReason((reason) => acconcyApi.fundInvestee(company.id, { ...body, ...(reason ? { reason } : {}) })); setDrawer({ mode: 'view', company: out }); load(); }, 'Funding recorded');
  const giveReturn = (body) => run(async () => { await withReason((reason) => acconcyApi.realiseInvestment(drawer.round.id, { ...body, ...(reason ? { reason } : {}) })); await reload(company.id); }, 'Return recorded');
  async function remove() {
    if (!window.confirm(`Delete ${company.name}?`)) return;
    try { await withReason((reason) => acconcyApi.deleteInvestee(company.id, reason)); setDrawer(null); load(); } catch (e) { pushError(acconcyError(e, 'Could not delete'), 'Delete failed'); }
  }

  const t = res.totals;
  const pipeline = res.rows.filter((r) => PIPELINE.includes(r.stage));
  const portfolio = res.rows.filter((r) => !PIPELINE.includes(r.stage));
  return (
    <div className="space-y-4" data-testid="investees-tab">
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Companies funded" value={t.companies} hint="funded or taken over" />
          <Kpi label="Invested" value={<Money v={t.invested} />} />
          <Kpi label="Current value" value={<Money v={t.current_value} />} />
          <Kpi label="Returned in cash" value={<Money v={t.amount_received} />} />
          <Kpi label="Gain / loss" value={<><Money v={t.gain_loss} signed /> <span className="text-xs">{pctLabel(t.gain_loss_pct)}</span></>} tone="ax-gold" />
          <Kpi label="Under discussion" value={t.pipeline_count} hint={<><Money v={t.pipeline_amount} /> proposed</>} />
        </div>
      )}
      <FilterBar
        q={q}
        onQ={setQ}
        searchPlaceholder="Search company, sector, contact..."
        fields={[{ key: 'stage', label: 'Stage', type: 'select', any: 'Any stage', options: INVESTEE_STAGES.map((s) => ({ value: s.value, label: s.label })) }]}
        values={{ stage }}
        onChange={(k, v) => setStage(v)}
        onReset={() => { setStage(''); setQ(''); }}
      >
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer({ mode: 'create' })}><Plus className="h-4 w-4" />New company</button>}
      </FilterBar>

      {fetching && !res.rows.length ? <Empty>Loading...</Empty> : (
        <>
          <section className="space-y-2"><h3 className="font-heading text-sm font-semibold text-tertiary-800">Under discussion</h3><CompanyTable rows={pipeline} onOpen={(c) => setDrawer({ mode: 'view', company: c })} pipeline /></section>
          <section className="space-y-2"><h3 className="font-heading text-sm font-semibold text-tertiary-800">Portfolio: funded, taken over and exited</h3><CompanyTable rows={portfolio} onOpen={(c) => setDrawer({ mode: 'view', company: c })} /></section>
        </>
      )}

      <Drawer
        open={Boolean(drawer)}
        onClose={() => !saving && setDrawer(null)}
        size="lg"
        tone={drawer?.mode === 'create' ? 'create' : drawer?.mode === 'view' ? 'info' : 'edit'}
        title={drawer?.mode === 'create' ? 'New company' : drawer?.mode === 'edit' ? `Edit ${company?.name}` : drawer?.mode === 'fund' ? 'Fund this company' : drawer?.mode === 'return' ? 'Record a return' : company?.name || ''}
      >
        {drawer?.mode === 'create' && <InvesteeForm onSubmit={save} onCancel={() => setDrawer(null)} saving={saving} />}
        {drawer?.mode === 'edit' && <InvesteeForm initial={company} onSubmit={save} onCancel={() => setDrawer({ mode: 'view', company })} saving={saving} />}
        {drawer?.mode === 'fund' && <FundForm company={company} onSubmit={fund} onCancel={() => setDrawer({ mode: 'view', company })} saving={saving} />}
        {drawer?.mode === 'return' && <ReturnForm round={drawer.round} onSubmit={giveReturn} onCancel={() => setDrawer({ mode: 'view', company })} saving={saving} />}
        {drawer?.mode === 'view' && company && (
          <div className="space-y-4" data-testid="investee-detail">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={INVESTEE_STAGE_META[company.stage]?.tone}>{INVESTEE_STAGE_META[company.stage]?.label}</Pill>
              {canEdit && company.stage !== 'dropped' && <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-sm" onClick={() => setDrawer({ mode: 'fund', company })}><Banknote className="h-4 w-4" />Fund this company</button>}
              {canEdit && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm" onClick={() => setDrawer({ mode: 'edit', company })}><Pencil className="h-4 w-4" />Edit</button>}
              {canEdit && !company.rounds_count && <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-sm text-danger-700" onClick={remove}><Trash2 className="h-4 w-4" />Delete</button>}
            </div>
            <Section title="Summary">
              <Detail label="Sector">{company.sector || '-'}</Detail>
              <Detail label="Contact">{[company.contact_name, company.contact_email].filter(Boolean).join(' · ') || '-'}</Detail>
              <Detail label="Our stake">{pctLabel(company.stake_pct)}</Detail>
              <Detail label="Valuation">{company.valuation != null ? <Money v={company.valuation} /> : '-'}</Detail>
              <Detail label="Proposed">{company.proposed_amount != null ? <><Money v={company.proposed_amount} /> for {pctLabel(company.proposed_stake_pct)}</> : '-'}</Detail>
              <Detail label="Expected return">{company.expected_return_pct != null ? `${company.expected_return_pct}% a year` : '-'}</Detail>
              <Detail label="Invested"><Money v={company.invested} /></Detail>
              <Detail label="Current value"><Money v={company.current_value} /></Detail>
              <Detail label="Returned in cash"><Money v={company.amount_received} /></Detail>
              <Detail label="Gain / loss"><span className={gainTone(company.gain_loss)}><Money v={company.gain_loss} signed /> {pctLabel(company.gain_loss_pct)}</span></Detail>
            </Section>
            {company.discussion_notes && <Section title="Discussion notes" cols={1}><p className="whitespace-pre-wrap text-sm text-tertiary-700">{company.discussion_notes}</p></Section>}
            <section className="space-y-2">
              <h4 className="font-heading text-sm font-semibold text-tertiary-800">Funding rounds</h4>
              {company.rounds.length === 0 ? <Empty>No money has been put in yet.</Empty> : (
                <ul className="divide-y rounded-xl border bg-white text-sm">
                  {company.rounds.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid="investee-round">
                      <div><p className="font-medium text-tertiary-900">{r.name}</p><p className="text-xs text-tertiary-500">{dateLabel(r.investment_date)} · stake {pctLabel(r.equity_pct)}</p></div>
                      <div className="text-right text-xs"><p><Money v={r.amount} /> invested · now <Money v={r.current_value} /></p><p className="text-tertiary-500">returned <Money v={r.amount_received} /> · <span className={gainTone(r.gain_loss)}><Money v={r.gain_loss} signed /></span></p></div>
                      {canEdit && r.status !== 'realised' && <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setDrawer({ mode: 'return', company, round: r })}>Record return</button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}
