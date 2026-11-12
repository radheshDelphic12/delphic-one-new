import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { KpiTile } from './groupUi.jsx';
import { Building2, Layers, Network, PieChart } from 'lucide-react';

// Business classification UI (Companies & Stakes): the picker that places a business in the group's sector > industry > sub-industry list, the editor of
// that list (everything can be added, renamed and removed) and the Business map that shows which sectors / industries / sub-industries the group's
// businesses cover and which are still empty.

const STATUS_TONE = { operational: 'bg-success-50 text-success-700 border-success-200', planning: 'bg-warning-50 text-warning-800 border-warning-200', future: 'bg-primary-50 text-primary-700 border-primary-200' };
const matches = (text, q) => !q || String(text).toLowerCase().includes(q);

/** Loads the group's list once and reloads on demand. */
export function useTaxonomy() {
  const [tree, setTree] = useState(null);
  const load = useCallback(() => apiClient.get('/group-companies/taxonomy').then(({ data }) => { setTree(data.data); return data.data; }).catch(() => null), []);
  useEffect(() => { load(); }, [load]);
  return { tree, reload: load };
}

export const emptySelection = () => ({ sector_ids: [], industry_ids: [], sub_industry_ids: [] });
export const selectionOf = (classification) => ({
  sector_ids: (classification?.sectors || []).map((x) => x.id),
  industry_ids: (classification?.industries || []).map((x) => x.id),
  sub_industry_ids: (classification?.sub_industries || []).map((x) => x.id),
});

/**
 * The picker: tick the sectors the business operates in, then the industries inside them, then the sub-industries inside those. Unticking a level
 * clears everything below it. `value` = { sector_ids, industry_ids, sub_industry_ids }.
 */
export function ClassificationPicker({ tree, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const q = query.trim().toLowerCase();
  const sel = useMemo(() => ({ s: new Set(value.sector_ids), i: new Set(value.industry_ids), x: new Set(value.sub_industry_ids) }), [value]);
  if (!tree) return <Skeleton className="h-40 w-full" />;
  if (!tree.sectors.length) return <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs text-warning-800" data-testid="picker-empty">The classification list is empty. Use &quot;Manage classification&quot; to load the standard list of 27 sectors or to add your own.</p>;

  const toggleSector = (s) => {
    const on = sel.s.has(s.id);
    const industries = new Set(s.industries.map((i) => i.id));
    const subs = new Set(s.industries.flatMap((i) => i.subs.map((x) => x.id)));
    onChange(on
      ? { sector_ids: value.sector_ids.filter((id) => id !== s.id), industry_ids: value.industry_ids.filter((id) => !industries.has(id)), sub_industry_ids: value.sub_industry_ids.filter((id) => !subs.has(id)) }
      : { ...value, sector_ids: [...value.sector_ids, s.id] });
    if (!on) setOpen((o) => new Set(o).add(s.id));
  };
  const toggleIndustry = (s, i) => {
    const on = sel.i.has(i.id);
    const subs = new Set(i.subs.map((x) => x.id));
    onChange(on
      ? { ...value, industry_ids: value.industry_ids.filter((id) => id !== i.id), sub_industry_ids: value.sub_industry_ids.filter((id) => !subs.has(id)) }
      : { ...value, sector_ids: sel.s.has(s.id) ? value.sector_ids : [...value.sector_ids, s.id], industry_ids: [...value.industry_ids, i.id] });
  };
  const toggleSub = (s, i, x) => {
    const on = sel.x.has(x.id);
    onChange(on
      ? { ...value, sub_industry_ids: value.sub_industry_ids.filter((id) => id !== x.id) }
      : { sector_ids: sel.s.has(s.id) ? value.sector_ids : [...value.sector_ids, s.id], industry_ids: sel.i.has(i.id) ? value.industry_ids : [...value.industry_ids, i.id], sub_industry_ids: [...value.sub_industry_ids, x.id] });
  };

  const visible = tree.sectors.map((s) => {
    const sectorHit = matches(s.name, q);
    const industries = s.industries
      .map((i) => ({ ...i, subs: i.subs.filter((x) => sectorHit || matches(i.name, q) || matches(x.name, q)) }))
      .filter((i) => sectorHit || matches(i.name, q) || i.subs.length);
    return { ...s, industries: sectorHit && !q ? s.industries : industries, hit: sectorHit || industries.length > 0 };
  }).filter((s) => s.hit);

  return (
    <div className="space-y-2" data-testid="classification-picker">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" />
        <input className={`${FIELD_INPUT} pl-9`} aria-label="Search the classification" placeholder="Search a sector, industry or sub-industry" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="text-xs text-tertiary-500">{value.sector_ids.length} sector{value.sector_ids.length === 1 ? '' : 's'} · {value.industry_ids.length} industr{value.industry_ids.length === 1 ? 'y' : 'ies'} · {value.sub_industry_ids.length} sub-industr{value.sub_industry_ids.length === 1 ? 'y' : 'ies'} chosen</p>
      <ul className="max-h-[26rem] space-y-1 overflow-y-auto rounded-xl border border-tertiary-100 p-2">
        {visible.map((s) => {
          const expanded = q ? true : open.has(s.id);
          return (
            <li key={s.id} data-testid="picker-sector">
              <div className="flex items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-tertiary-50">
                <button type="button" aria-label={expanded ? `Collapse ${s.name}` : `Expand ${s.name}`} className="rounded p-0.5 text-tertiary-500" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-medium text-tertiary-900"><input type="checkbox" checked={sel.s.has(s.id)} onChange={() => toggleSector(s)} aria-label={`Sector ${s.name}`} />{s.name}</label>
                <span className="text-[11px] text-tertiary-400">{s.industries.length}</span>
              </div>
              {expanded && (
                <ul className="ml-7 space-y-0.5 border-l border-tertiary-100 pl-3">
                  {s.industries.map((i) => (
                    <li key={i.id} data-testid="picker-industry">
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-tertiary-800 hover:bg-tertiary-50"><input type="checkbox" checked={sel.i.has(i.id)} onChange={() => toggleIndustry(s, i)} aria-label={`Industry ${i.name}`} />{i.name}</label>
                      {sel.i.has(i.id) && i.subs.length > 0 && (
                        <div className="ml-6 flex flex-wrap gap-1.5 py-1">
                          {i.subs.map((x) => (
                            <label key={x.id} className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${sel.x.has(x.id) ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-600 hover:bg-tertiary-50'}`}>
                              <input type="checkbox" className="sr-only" checked={sel.x.has(x.id)} onChange={() => toggleSub(s, i, x)} aria-label={`Sub-industry ${x.name}`} />{sel.x.has(x.id) && <Check className="h-3 w-3" />}{x.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {!visible.length && <li className="px-2 py-4 text-center text-sm text-tertiary-500">Nothing matches &quot;{query}&quot;.</li>}
      </ul>
    </div>
  );
}

/** A short text of where a business sits, for the register and the editor. */
export function classificationSummary(c) {
  const k = c?.classification;
  if (!k || !k.sectors.length) return null;
  return `${k.sectors.length} sector${k.sectors.length === 1 ? '' : 's'} · ${k.industries.length} industr${k.industries.length === 1 ? 'y' : 'ies'} · ${k.sub_industries.length} sub-industr${k.sub_industries.length === 1 ? 'y' : 'ies'}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The editor of the list itself: add, rename and remove sectors, industries and sub-industries, and load the standard list. */
export function TaxonomyEditor({ tree, reload, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [edit, setEdit] = useState(null); // { id, level, value }
  const [adding, setAdding] = useState(null); // { parent, level, value }
  const [busy, setBusy] = useState(false);
  const q = query.trim().toLowerCase();

  async function run(fn, ok) {
    setBusy(true);
    try { const r = await fn(); await reload(); onChanged?.(); if (ok) pushSuccess(typeof ok === 'function' ? ok(r) : ok, 'Saved'); return true; } catch (err) { pushError(apiErrorMessage(err, 'That did not save'), 'Could not save'); return false; } finally { setBusy(false); }
  }
  const PATH = { sector: 'sectors', industry: 'industries', sub: 'sub-industries' };
  async function rename() {
    const ok = await run(() => apiClient.patch(`/group-companies/taxonomy/${PATH[edit.level]}/${edit.id}`, { name: edit.value }), 'Renamed.');
    if (ok) setEdit(null);
  }
  async function remove(level, id, name, info) {
    if (!window.confirm(`Remove ${name}${info}? Businesses mapped to it are taken out of it.`)) return;
    await run(() => apiClient.delete(`/group-companies/taxonomy/${PATH[level]}/${id}`), 'Removed.');
  }
  async function add() {
    const { parent, level, value } = adding;
    const url = level === 'sector' ? '/group-companies/taxonomy/sectors' : level === 'industry' ? `/group-companies/taxonomy/sectors/${parent}/industries` : `/group-companies/taxonomy/industries/${parent}/sub-industries`;
    const ok = await run(() => apiClient.post(url, level === 'sub' ? { names: value } : { name: value }), (r) => (level === 'sub' ? `${r.data.data.added} added${r.data.data.skipped ? `, ${r.data.data.skipped} already there` : ''}.` : 'Added.'));
    if (ok) setAdding(null);
  }
  const seed = () => run(() => apiClient.post('/group-companies/taxonomy/seed'), (r) => `Loaded: ${r.data.data.sectors} sectors, ${r.data.data.industries} industries, ${r.data.data.sub_industries} sub-industries added.`);

  if (!tree) return <Skeleton className="h-40 w-full" />;
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nameCell = (level, id, name, className) => (edit?.id === id ? (
    <span className="flex flex-1 items-center gap-1.5">
      <input className="min-w-0 flex-1 rounded-lg border border-tertiary-200 px-2 py-1 text-sm" aria-label="New name" autoFocus maxLength={150} value={edit.value} onChange={(e) => setEdit((p) => ({ ...p, value: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEdit(null); }} />
      <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy || !edit.value.trim()} onClick={rename}>Save</button>
      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setEdit(null)}>Cancel</button>
    </span>
  ) : <span className={`flex-1 ${className}`}>{name}</span>);
  const actions = (level, id, name, info) => (edit?.id === id ? null : (
    <span className="flex shrink-0 items-center">
      <button type="button" aria-label={`Rename ${name}`} className="rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setEdit({ id, level, value: name })}><Pencil className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label={`Remove ${name}`} className="rounded p-1 text-danger-600 hover:bg-danger-50" disabled={busy} onClick={() => remove(level, id, name, info)}><Trash2 className="h-3.5 w-3.5" /></button>
    </span>
  ));
  const addRow = (parent, level, placeholder) => (adding?.parent === parent && adding.level === level ? (
    <li className="flex items-center gap-1.5 py-1">
      <input className="min-w-0 flex-1 rounded-lg border border-tertiary-200 px-2 py-1 text-sm" aria-label={placeholder} placeholder={placeholder} autoFocus maxLength={level === 'sub' ? 4000 : 150} value={adding.value} onChange={(e) => setAdding((p) => ({ ...p, value: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter' && level !== 'sub') add(); if (e.key === 'Escape') setAdding(null); }} />
      <button type="button" className="btn-primary px-2 py-1 text-xs" data-testid="taxonomy-add-save" disabled={busy || !adding.value.trim()} onClick={add}>Add</button>
      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setAdding(null)}>Cancel</button>
    </li>
  ) : (
    <li><button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-primary-700 hover:bg-primary-50" data-testid={`taxonomy-add-${level}`} onClick={() => setAdding({ parent, level, value: '' })}><Plus className="h-3 w-3" />{level === 'sector' ? 'Add a sector' : level === 'industry' ? 'Add an industry' : 'Add sub-industries'}</button></li>
  ));

  const sectors = tree.sectors.filter((s) => !q || matches(s.name, q) || s.industries.some((i) => matches(i.name, q) || i.subs.some((x) => matches(x.name, q))));
  return (
    <div className="space-y-3" data-testid="taxonomy-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-tertiary-500">{tree.counts.sectors} sectors · {tree.counts.industries} industries · {tree.counts.sub_industries} sub-industries. Everything here can be added to, renamed and removed.</p>
        <button type="button" className="btn-secondary text-xs" data-testid="taxonomy-seed" disabled={busy} onClick={seed} title="Adds the standard list of 27 sectors next to what you have; nothing you edited is overwritten">Load the standard list</button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" />
        <input className={`${FIELD_INPUT} pl-9`} aria-label="Search the list" placeholder="Search a sector, industry or sub-industry" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ul className="space-y-0.5 rounded-xl border border-tertiary-100 p-2">
        {sectors.map((s) => {
          const expanded = q ? true : open.has(s.id);
          return (
            <li key={s.id} data-testid="taxonomy-sector">
              <div className="flex items-center gap-1.5 rounded-lg px-1 py-1 hover:bg-tertiary-50">
                <button type="button" aria-label={expanded ? `Collapse ${s.name}` : `Expand ${s.name}`} className="rounded p-0.5 text-tertiary-500" onClick={() => toggle(s.id)}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                {nameCell('sector', s.id, s.name, 'text-sm font-semibold text-tertiary-900')}
                <span className="text-[11px] text-tertiary-400">{s.industries.length} industr{s.industries.length === 1 ? 'y' : 'ies'}</span>
                {actions('sector', s.id, s.name, ` and its ${s.industries.length} industries`)}
              </div>
              {expanded && (
                <ul className="ml-7 space-y-0.5 border-l border-tertiary-100 pl-3">
                  {s.industries.filter((i) => !q || matches(s.name, q) || matches(i.name, q) || i.subs.some((x) => matches(x.name, q))).map((i) => {
                    const iOpen = open.has(i.id) || (q && i.subs.some((x) => matches(x.name, q)));
                    return (
                      <li key={i.id} data-testid="taxonomy-industry">
                        <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-tertiary-50">
                          <button type="button" aria-label={iOpen ? `Collapse ${i.name}` : `Expand ${i.name}`} className="rounded p-0.5 text-tertiary-400" onClick={() => toggle(i.id)}>{iOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
                          {nameCell('industry', i.id, i.name, 'text-sm text-tertiary-800')}
                          <span className="text-[11px] text-tertiary-400">{i.subs.length}</span>
                          {actions('industry', i.id, i.name, ` and its ${i.subs.length} sub-industries`)}
                        </div>
                        {iOpen && (
                          <ul className="ml-6 space-y-0.5 border-l border-tertiary-100 pl-3">
                            {i.subs.filter((x) => !q || matches(i.name, q) || matches(s.name, q) || matches(x.name, q)).map((x) => (
                              <li key={x.id} className="flex items-center gap-1.5 rounded px-1 hover:bg-tertiary-50" data-testid="taxonomy-sub">
                                {nameCell('sub', x.id, x.name, 'text-xs text-tertiary-700')}
                                {actions('sub', x.id, x.name, '')}
                              </li>
                            ))}
                            {addRow(i.id, 'sub', 'Names, one per line or comma separated')}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {addRow(s.id, 'industry', 'Name of the industry')}
                </ul>
              )}
            </li>
          );
        })}
        {!sectors.length && <li className="px-2 py-4 text-center text-sm text-tertiary-500">{tree.sectors.length ? `Nothing matches "${query}".` : 'The list is empty. Load the standard list above, or add your first sector below.'}</li>}
        <li className="border-t border-tertiary-100 pt-1">{addRow('root', 'sector', 'Name of the sector')}</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
function CompanyChips({ list, onOpen }) {
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((c) => (
        <button key={c.id} type="button" title={`${c.name} (${c.status}) - open to change its classification`} onClick={() => onOpen?.(c.id)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium hover:underline ${STATUS_TONE[c.status] || ''}`}>{c.name}</button>
      ))}
    </span>
  );
}

/**
 * The Business map: for every sector, industry and sub-industry, which businesses operate there; what nobody covers is marked as a gap. `statuses` narrows
 * it to operational / planning / future businesses. Clicking a business opens it to change where it sits.
 */
export function BusinessMap({ statuses, refreshKey, onOpenCompany, onManage }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all'); // all | gaps | covered
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const key = statuses.join(',');
  useEffect(() => {
    let alive = true;
    apiClient.get('/group-companies/business-map', { params: { statuses: key } }).then(({ data: res }) => { if (alive) setData(res.data); }).catch(() => { if (alive) setData({ sectors: [], unclassified: [], summary: null }); });
    return () => { alive = false; };
  }, [key, refreshKey]);
  if (!data) return <Skeleton className="h-64 w-full" />;
  if (!data.sectors.length) {
    return (
      <div className="rounded-2xl border border-tertiary-100 bg-white p-6 text-center shadow-card" data-testid="map-empty">
        <p className="text-sm text-tertiary-600">There is no classification list yet. Load the standard list of 27 sectors (or add your own), then place each business in it.</p>
        <button type="button" className="btn-primary mt-3" onClick={onManage}>Manage classification</button>
      </div>
    );
  }
  const sm = data.summary;
  const q = query.trim().toLowerCase();
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shown = data.sectors.filter((s) => {
    if (q && !(matches(s.name, q) || s.industries.some((i) => matches(i.name, q) || i.subs.some((x) => matches(x.name, q))))) return false;
    if (filter === 'covered') return s.companies.length > 0;
    if (filter === 'gaps') return s.companies.length === 0 || s.industries_covered < s.industries.length || s.subs_covered < s.subs_total;
    return true;
  });

  return (
    <div className="space-y-4" data-testid="business-map">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Sectors covered" value={`${sm.sectors_covered} / ${sm.sectors}`} icon={PieChart} theme="green" hint={`${sm.sectors - sm.sectors_covered} with no business`} />
        <KpiTile label="Industries covered" value={`${sm.industries_covered} / ${sm.industries}`} icon={Layers} theme="blue" hint={`${sm.industries - sm.industries_covered} still empty`} />
        <KpiTile label="Sub-industries covered" value={`${sm.sub_industries_covered} / ${sm.sub_industries}`} icon={Network} theme="purple" hint={`${sm.sub_industries - sm.sub_industries_covered} still empty`} />
        <KpiTile label="Businesses placed" value={`${sm.companies_classified} / ${sm.companies}`} icon={Building2} theme="orange" hint={`${sm.companies - sm.companies_classified} not placed yet`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-tertiary-100 bg-white p-0.5 text-xs" role="tablist" aria-label="Show">
          {[['all', 'All sectors'], ['covered', 'Covered'], ['gaps', 'Gaps (anything empty)']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} data-testid={`map-filter-${k}`} onClick={() => setFilter(k)} className={`rounded-[10px] px-3 py-1.5 font-medium ${filter === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{l}</button>)}
        </div>
        <div className="relative min-w-[14rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" />
          <input className={`${FIELD_INPUT} pl-9`} aria-label="Search the map" placeholder="Search a sector, industry or sub-industry" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={onManage}>Manage classification</button>
      </div>

      {data.unclassified.length > 0 && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50/60 p-3" data-testid="map-unclassified">
          <p className="text-xs font-semibold text-warning-800">Not placed in the classification yet ({data.unclassified.length})</p>
          <div className="mt-1.5"><CompanyChips list={data.unclassified} onOpen={onOpenCompany} /></div>
        </div>
      )}

      <ul className="space-y-2">
        {shown.map((s) => {
          const expanded = q || filter === 'gaps' ? true : open.has(s.id);
          const pct = s.industries.length ? Math.round((s.industries_covered / s.industries.length) * 100) : 0;
          const empty = s.companies.length === 0;
          return (
            <li key={s.id} className={`rounded-2xl border bg-white shadow-card ${empty ? 'border-warning-200' : 'border-tertiary-100'}`} data-testid="map-sector" data-covered={empty ? 'no' : 'yes'}>
              <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left" aria-expanded={expanded} onClick={() => toggle(s.id)}>
                {expanded ? <ChevronDown className="h-4 w-4 text-tertiary-500" /> : <ChevronRight className="h-4 w-4 text-tertiary-500" />}
                <span className="font-heading text-sm font-semibold text-tertiary-900">{s.name}</span>
                {empty ? <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-800">No business here</span> : <span className="text-xs text-tertiary-500">{s.companies.length} business{s.companies.length === 1 ? '' : 'es'}</span>}
                <span className="ml-auto flex items-center gap-2 text-[11px] text-tertiary-500">
                  {s.industries_covered}/{s.industries.length} industries
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-tertiary-100"><span className="block h-full rounded-full bg-success-500" style={{ width: `${pct}%` }} /></span>
                </span>
              </button>
              {!empty && <div className="px-3 pb-2 pl-9"><CompanyChips list={s.companies} onOpen={onOpenCompany} /></div>}
              {expanded && (
                <ul className="space-y-0.5 border-t border-tertiary-100 px-3 py-2 pl-9">
                  {s.industries.filter((i) => !q || matches(s.name, q) || matches(i.name, q) || i.subs.some((x) => matches(x.name, q))).filter((i) => filter !== 'gaps' || !i.companies.length || i.subs_covered < i.subs.length).map((i) => (
                    <li key={i.id} data-testid="map-industry" data-covered={i.companies.length ? 'yes' : 'no'}>
                      <div className="flex flex-wrap items-center gap-2 py-0.5">
                        <button type="button" aria-label={`Show sub-industries of ${i.name}`} className="rounded p-0.5 text-tertiary-400" onClick={() => toggle(i.id)}>{open.has(i.id) || q ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
                        <span className={`text-sm ${i.companies.length ? 'font-medium text-tertiary-900' : 'text-tertiary-500'}`}>{i.name}</span>
                        {i.companies.length ? <CompanyChips list={i.companies} onOpen={onOpenCompany} /> : <span className="rounded-full bg-warning-50 px-2 py-0.5 text-[11px] text-warning-800">Not covered</span>}
                        <span className="text-[11px] text-tertiary-400">{i.subs_covered}/{i.subs.length} sub</span>
                      </div>
                      {(open.has(i.id) || q) && (
                        <ul className="ml-6 space-y-0.5 border-l border-tertiary-100 pl-3">
                          {i.subs.filter((x) => !q || matches(s.name, q) || matches(i.name, q) || matches(x.name, q)).map((x) => (
                            <li key={x.id} className="flex flex-wrap items-center gap-2 py-0.5" data-testid="map-sub" data-covered={x.companies.length ? 'yes' : 'no'}>
                              <span className={`text-xs ${x.companies.length ? 'font-medium text-tertiary-800' : 'text-tertiary-400'}`}>{x.name}</span>
                              {x.companies.length ? <CompanyChips list={x.companies} onOpen={onOpenCompany} /> : <span className="text-[11px] text-warning-700">empty</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="rounded-2xl border border-tertiary-100 bg-white px-3 py-6 text-center text-sm text-tertiary-500">Nothing to show for this filter.</li>}
      </ul>
    </div>
  );
}
