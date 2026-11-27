import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';
import useSavedState from '../../lib/useSavedState.js';
import Drawer from '../../components/ui/Drawer.jsx';

const CHANNEL = { linkedin: 'LinkedIn', google_ads: 'Google Ads', meta_ads: 'Meta Ads', email: 'Email', event: 'Event', website: 'Website', referral: 'Referral', content: 'Content', other: 'Other' };
const STATUS = { planned: ['Planned', 'bg-sky-50 text-sky-800'], live: ['Live', 'bg-success-50 text-success-800'], paused: ['Paused', 'bg-amber-50 text-amber-800'], done: ['Done', 'bg-tertiary-100 text-tertiary-600'] };
const inr = (n) => (n == null ? '-' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const label = 'block text-xs font-medium text-tertiary-600';
const input = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';

function Tile({ k, v, hint }) {
  return <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card"><p className="text-xs text-tertiary-500">{k}</p><p className="font-heading text-xl font-semibold tabular-nums">{v}</p>{hint && <p className="text-[11px] text-tertiary-500">{hint}</p>}</div>;
}

/**
 * Group Dashboard > Marketing: campaigns across the group's companies with budget, what was spent (a log), and what came of it (leads,
 * deals won, revenue). Totals by channel and by company, cost per lead and the return on the spend.
 */
export default function GroupMarketingTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [filters, setFilters] = useSavedState('groupMarketing.filters', { status: '', channel: '', company_id: '', year: '' });
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [spendFor, setSpendFor] = useState(null);
  const load = useCallback(() => apiClient.get('/group-marketing', { params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ campaigns: [], summary: null, companies: [] }); pushError(apiErrorMessage(err, 'Could not load marketing'), 'Something went wrong'); }), [filters, pushError]);
  useEffect(() => { load(); }, [load]);
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  async function remove(c) {
    if (!await confirmAction(`Delete the campaign "${c.name}"?`)) return;
    try { await apiClient.delete(`/group-marketing/${c.id}`); pushSuccess('Campaign deleted'); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not delete'), 'Not deleted'); }
  }
  const t = data?.summary?.totals;
  const thisYear = new Date().getFullYear();
  return (
    <div className="space-y-4" data-testid="group-marketing">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <select value={filters.status} onChange={setF('status')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Status"><option value="">Any status</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={filters.channel} onChange={setF('channel')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Channel"><option value="">All channels</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select value={filters.company_id} onChange={setF('company_id')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Company"><option value="">All companies</option>{(data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={filters.year} onChange={setF('year')} className="rounded-xl border border-tertiary-200 px-3 py-1.5 text-sm" aria-label="Year"><option value="">Any year</option>{[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing({})} data-testid="mkt-new"><Plus className="h-4 w-4" />New campaign</button>
      </div>
      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile k="Campaigns" v={t.campaigns} hint={`${t.live} live now`} />
          <Tile k="Budget / spent" v={`${inr(t.spent)}`} hint={`of ${inr(t.budget)} budget`} />
          <Tile k="Leads" v={t.leads} hint={`${t.deals_won} deals won`} />
          <Tile k="Cost per lead" v={inr(t.cost_per_lead)} />
          <Tile k="Revenue / return" v={inr(t.revenue)} hint={t.return_on_spend != null ? `${t.return_on_spend}x the spend` : 'no spend yet'} />
        </div>
      )}
      {data?.summary && data.summary.by_channel.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {[['By channel', data.summary.by_channel, (k) => CHANNEL[k] || k], ['By company', data.summary.by_company, (k) => k]].map(([title, rows, name]) => {
            const max = Math.max(1, ...rows.map((r) => r.spent));
            return (
              <section key={title} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
                <h3 className="text-sm font-semibold text-tertiary-900">{title}</h3>
                <ul className="mt-2 space-y-2 text-xs">{rows.map((r) => (
                  <li key={r.key}>
                    <div className="flex justify-between"><span className="font-medium text-tertiary-800">{name(r.key)}</span><span className="tabular-nums text-tertiary-600">{inr(r.spent)} · {r.leads} leads{r.cost_per_lead != null ? ` · ${inr(r.cost_per_lead)}/lead` : ''}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-tertiary-100"><div className="h-2 rounded-full bg-primary-500" style={{ width: `${(r.spent / max) * 100}%` }} /></div>
                  </li>
                ))}</ul>
              </section>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
        {!data ? <p className="p-4 text-sm text-tertiary-500">Loading...</p> : data.campaigns.length === 0 ? <p className="p-6 text-center text-sm text-tertiary-500">No campaigns yet.</p> : (
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted text-left text-xs uppercase text-tertiary-500"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Companies</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2 text-right">Budget / spent</th><th className="px-3 py-2 text-right">Leads / won</th><th className="px-3 py-2 text-right">Cost per lead</th><th className="px-3 py-2 text-right">Revenue</th><th /></tr></thead>
            <tbody>{data.campaigns.map((c) => (
              <tr key={c.id} className="border-t border-tertiary-100" data-testid="mkt-row">
                <td className="px-3 py-2"><span className="flex items-center gap-1.5 font-medium text-tertiary-900"><Megaphone className="h-3.5 w-3.5 text-primary-600" />{c.name}</span><span className="mt-0.5 inline-flex items-center gap-1 text-xs text-tertiary-500"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>{CHANNEL[c.channel]}{c.owner_name ? ` · ${c.owner_name}` : ''}</span></td>
                <td className="px-3 py-2 text-xs">{c.all_companies ? 'All companies' : c.companies.map((x) => x.name).join(', ')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{c.start_date || '…'} to {c.end_date || '…'}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${c.over_budget ? 'text-danger-600' : ''}`}>{inr(c.spent)}<span className="block text-[11px] text-tertiary-500">of {inr(c.budget)}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{c.leads}{c.target_leads ? <span className="text-tertiary-500"> / {c.target_leads}</span> : ''}<span className="block text-[11px] text-tertiary-500">{c.deals_won} won</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(c.cost_per_lead)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(c.revenue)}{c.return_on_spend != null && <span className="block text-[11px] text-tertiary-500">{c.return_on_spend}x</span>}</td>
                <td className="px-3 py-2"><span className="flex justify-end gap-1">
                  <button type="button" className="btn-ghost text-xs" onClick={() => setSpendFor(c)} data-testid="mkt-spend">Spend</button>
                  <button type="button" aria-label="Edit" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-primary-50 hover:text-primary-700" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Delete" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></button>
                </span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <CampaignDrawer campaign={editing} companies={data?.companies || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      <SpendDrawer campaign={spendFor} onClose={() => setSpendFor(null)} onChanged={(c) => { setSpendFor(c); load(); }} />
    </div>
  );
}

function CampaignDrawer({ campaign, companies, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const open = campaign !== null;
  const blank = { name: '', channel: 'linkedin', status: 'planned', company_ids: [], start_date: '', end_date: '', budget: '', target_leads: '', leads: '', deals_won: '', revenue: '', owner_name: '', notes: '' };
  const [v, setV] = useState(blank);
  useEffect(() => { if (open) setV(campaign.id ? { ...blank, ...Object.fromEntries(Object.entries(campaign).filter(([k]) => k in blank).map(([k, x]) => [k, x ?? ''])), company_ids: campaign.companies.map((c) => c.id) } : blank); }, [open, campaign]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    try { if (campaign.id) await apiClient.patch(`/group-marketing/${campaign.id}`, v); else await apiClient.post('/group-marketing', v); pushSuccess('Campaign saved'); onSaved(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); }
  }
  return (
    <Drawer open={open} title={campaign?.id ? `Edit ${campaign.name}` : 'New campaign'} onClose={onClose} size="lg" tone={campaign?.id ? 'edit' : 'create'} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="mkt-form" className="btn-primary" disabled={!v.name.trim()} data-testid="mkt-save">Save</button></>}>
      <form id="mkt-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>Name<input className={input} value={v.name} onChange={set('name')} required data-testid="mkt-name" /></label>
        <label className={label}>Channel<select className={input} value={v.channel} onChange={set('channel')}>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={label}>Status<select className={input} value={v.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={label}>Starts<input type="date" className={input} value={v.start_date} onChange={set('start_date')} /></label>
        <label className={label}>Ends<input type="date" className={input} value={v.end_date} onChange={set('end_date')} /></label>
        <label className={label}>Budget (₹)<input type="number" min="0" className={input} value={v.budget} onChange={set('budget')} /></label>
        <label className={label}>Target leads<input type="number" min="0" className={input} value={v.target_leads} onChange={set('target_leads')} /></label>
        <label className={label}>Leads so far<input type="number" min="0" className={input} value={v.leads} onChange={set('leads')} /></label>
        <label className={label}>Deals won<input type="number" min="0" className={input} value={v.deals_won} onChange={set('deals_won')} /></label>
        <label className={label}>Revenue from it (₹)<input type="number" min="0" className={input} value={v.revenue} onChange={set('revenue')} /></label>
        <label className={label}>Owner<input className={input} value={v.owner_name} onChange={set('owner_name')} /></label>
        <div className="sm:col-span-2">
          <p className={label}>For companies (none = the whole group)</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{companies.map((c) => <label key={c.id} className={`inline-flex cursor-pointer items-center rounded-full border px-2.5 py-1 text-xs ${v.company_ids.includes(c.id) ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-700'}`}><input type="checkbox" className="hidden" checked={v.company_ids.includes(c.id)} onChange={() => setV((x) => ({ ...x, company_ids: x.company_ids.includes(c.id) ? x.company_ids.filter((i) => i !== c.id) : [...x.company_ids, c.id] }))} />{c.name}</label>)}</div>
        </div>
        <label className={`${label} sm:col-span-2`}>Notes<textarea rows={3} className={input} value={v.notes} onChange={set('notes')} /></label>
      </form>
    </Drawer>
  );
}

function SpendDrawer({ campaign, onClose, onChanged }) {
  const { pushError } = useAlerts();
  const [v, setV] = useState({ spent_on: new Date().toISOString().slice(0, 10), amount: '', note: '' });
  async function add(e) {
    e.preventDefault();
    try { const { data } = await apiClient.post(`/group-marketing/${campaign.id}/spends`, { ...v, amount: Number(v.amount) }); setV((x) => ({ ...x, amount: '', note: '' })); onChanged(data.data); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); }
  }
  async function del(s) {
    try { const { data } = await apiClient.delete(`/group-marketing/${campaign.id}/spends/${s.id}`); onChanged(data.data); } catch (err) { pushError(apiErrorMessage(err, 'Could not remove'), 'Not removed'); }
  }
  return (
    <Drawer open={Boolean(campaign)} title={campaign ? `Spend on ${campaign.name}` : ''} onClose={onClose} size="md">
      {campaign && (
        <div className="space-y-3">
          <p className="text-sm text-tertiary-700">Spent {inr(campaign.spent)} of {inr(campaign.budget)}{campaign.over_budget ? ' (over budget)' : ` · ${inr(campaign.left)} left`}</p>
          <form onSubmit={add} className="grid grid-cols-3 gap-2">
            <label className={label}>Date<input type="date" className={input} value={v.spent_on} onChange={(e) => setV((x) => ({ ...x, spent_on: e.target.value }))} /></label>
            <label className={label}>Amount (₹)<input type="number" min="0" className={input} value={v.amount} onChange={(e) => setV((x) => ({ ...x, amount: e.target.value }))} required data-testid="mkt-spend-amount" /></label>
            <label className={label}>Note<input className={input} value={v.note} onChange={(e) => setV((x) => ({ ...x, note: e.target.value }))} /></label>
            <button type="submit" className="btn-primary col-span-3" disabled={!(Number(v.amount) > 0)} data-testid="mkt-spend-add">Add spend</button>
          </form>
          <ul className="divide-y divide-tertiary-100 text-sm">{campaign.spends.map((s) => <li key={s.id} className="flex items-center justify-between py-1.5"><span>{s.spent_on} · {inr(s.amount)}{s.note ? <span className="text-tertiary-500"> · {s.note}</span> : null}</span><button type="button" className="text-xs text-danger-600 hover:underline" onClick={() => del(s)}>Remove</button></li>)}</ul>
        </div>
      )}
    </Drawer>
  );
}
