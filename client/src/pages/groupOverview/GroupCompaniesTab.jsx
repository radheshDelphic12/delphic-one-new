import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CircleDollarSign, Factory, Pencil, PieChart, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { ConfirmDialog } from '../../components/resignation/resignationShared.jsx';
import { KpiTile, SectionHeading } from './groupUi.jsx';

const VIEWS = [
  { key: 'operational', label: 'Operational' },
  { key: 'planning', label: 'Planning' },
  { key: 'future', label: 'Future' },
  { key: 'sector', label: 'Group Sector' },
  { key: 'overall', label: 'Overall' },
];
const STATUS_OPTIONS = [
  { value: 'operational', label: 'Operational' },
  { value: 'planning', label: 'Planning' },
  { value: 'future', label: 'Future' },
];
// The sector picker offers these plus every sector already used; "Add a new sector…" lets an admin add another.
const ADD_SECTOR = '__add_sector__';
const DEFAULT_SECTORS = ['Technology & Digital', 'Pharmaceuticals', 'Mining & Resources', 'Trading', 'Finance & Investments', 'Spirits & Beverages', 'Real Estate', 'Infrastructure', 'Hospitality', 'Foundation / Non-profit'];
const STATUS_TONE ={ operational: 'green', planning: 'amber', future: 'blue' };
const BLANK = { name: '', short_code: '', sector: '', tagline: '', foundation_date: '', status: 'planning', notes: '' };
const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
const td = 'px-3 py-2 align-top';
const pctText = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 })}%`;
const dayText = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

function Ownership({ company }) {
  if (!company.holders.length) return <span className="text-xs text-warning-700">Not set</span>;
  const over = company.total_pct > 100;
  const full = company.total_pct === 100;
  return (
    <div className="w-32" data-testid="ownership">
      <div className="flex items-center justify-between text-xs"><b className={`tabular-nums ${over ? 'text-danger-700' : 'text-tertiary-900'}`}>{pctText(company.total_pct)}</b>{!full && !over && <span className="text-tertiary-400">of 100%</span>}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full rounded-full ${over ? 'bg-danger-500' : full ? 'bg-success-500' : 'bg-primary-500'}`} style={{ width: `${Math.min(100, company.total_pct)}%` }} /></div>
    </div>
  );
}

function HolderChips({ holders }) {
  if (!holders.length) return <span className="text-tertiary-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {holders.map((h) => (
        <span key={h.id} className="inline-flex items-center gap-1 rounded-full border border-tertiary-200 bg-white px-2 py-0.5 text-xs text-tertiary-700">
          {h.holder_label}<b className="tabular-nums text-tertiary-900">{pctText(h.pct)}</b>
        </span>
      ))}
    </div>
  );
}

/** Group Dashboard > Companies & Stakes: the register of every business of the group (current and planned), with sector, stake holders and the five views. */
export default function GroupCompaniesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [view, setView] = useState('operational');
  const [data, setData] = useState(null);
  const [editor, setEditor] = useState(null); // { id?, linked?, form }
  const [stakeEditor, setStakeEditor] = useState(null); // { company, rows }
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiClient.get('/group-companies').then(({ data: res }) => setData(res.data)).catch((err) => pushError(apiErrorMessage(err, 'Failed to load the companies'), 'Something went wrong')), [pushError]);
  useEffect(() => { load(); }, [load]);

  const companies = data?.companies || [];
  const shown = useMemo(() => (['operational', 'planning', 'future'].includes(view) ? companies.filter((c) => c.status === view) : companies), [companies, view]);
  const holdersMap = useMemo(() => {
    const map = new Map();
    for (const c of companies) for (const h of c.holders) {
      if (!map.has(h.holder_label)) map.set(h.holder_label, { label: h.holder_label, kind: h.holder_kind, items: [] });
      map.get(h.holder_label).items.push({ company: c.name, pct: h.pct });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [companies]);

  async function run(fn, okMessage, failMessage) {
    setBusy(true);
    try { await fn(); await load(); if (okMessage) pushSuccess(okMessage, 'Saved'); return true; } catch (err) { pushError(apiErrorMessage(err, failMessage), 'Could not save'); return false; } finally { setBusy(false); }
  }

  const openAdd = () => setEditor({ form: { ...BLANK, org_group_id: data.groups.length > 1 ? data.groups[0].id : '' } });
  const openEdit = (c) => setEditor({ id: c.id, linked: c.is_current, form: { name: c.name, short_code: c.short_code || '', sector: c.sector || '', tagline: c.tagline || '', foundation_date: c.foundation_date || '', status: c.status, notes: c.notes || '' } });
  const setField = (k) => (e) => setEditor((p) => ({ ...p, form: { ...p.form, [k]: e.target.value } }));

  async function saveDetails() {
    const { id, form, linked } = editor;
    if (!form.name.trim()) return pushError('Give the business a name.', 'Name needed');
    if (!id && data.groups.length > 1 && !form.org_group_id) return pushError('Choose which holding group this business belongs to.', 'Group needed');
    const body = {
      short_code: form.short_code.trim() || (id ? null : undefined),
      sector: form.sector.trim() || (id ? null : undefined),
      tagline: form.tagline.trim() || (id ? null : undefined),
      foundation_date: form.foundation_date || (id ? null : undefined),
      notes: form.notes.trim() || (id ? null : undefined),
      status: form.status,
    };
    const done = await run(async () => {
      if (id) await apiClient.patch(`/group-companies/${id}`, { ...(linked ? {} : { name: form.name.trim() }), ...body });
      else await apiClient.post('/group-companies', { name: form.name.trim(), ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null)), ...(data.groups.length > 1 && form.org_group_id ? { org_group_id: form.org_group_id } : {}) });
    }, id ? 'Details updated.' : 'Business added.', 'Failed to save');
    if (done) setEditor(null);
  }

  // ---- stakes
  const openStakes = (c) => setStakeEditor({
    company: c,
    rows: c.holders.map((h) => ({ kind: h.holder_kind, holder_company_id: h.holder_company_id || '', holder_name: h.holder_name || '', pct: String(h.pct) })),
  });
  const setRow = (i, patch) => setStakeEditor((p) => ({ ...p, rows: p.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const holderOptions = (company) => [
    { value: 'group', label: `${data.groups.find((g) => g.id === company.org_group_id)?.name || data.groups[0]?.name || 'The group'} (the group itself)` },
    ...companies.filter((c) => c.id !== company.id && c.org_group_id === company.org_group_id).map((c) => ({ value: `company:${c.id}`, label: c.name })),
    { value: 'external', label: 'Someone outside the group' },
  ];
  const rowValue = (r) => (r.kind === 'company' ? `company:${r.holder_company_id}` : r.kind);
  const total = stakeEditor ? stakeEditor.rows.reduce((s, r) => s + (Number(r.pct) || 0), 0) : 0;

  async function saveStakes() {
    const { company, rows } = stakeEditor;
    const stakes = rows.map((r) => ({ holder_kind: r.kind, ...(r.kind === 'company' ? { holder_company_id: r.holder_company_id } : {}), ...(r.kind === 'external' ? { holder_name: r.holder_name } : {}), pct: Number(r.pct) }));
    if (stakes.some((s) => !(s.pct > 0))) return pushError('Every holder needs a percentage above 0.', 'Percentage needed');
    if (total > 100.0005) return pushError(`The holders add up to ${pctText(total)}, which is more than 100%.`, 'Over 100%');
    const done = await run(() => apiClient.put(`/group-companies/${company.id}/stakes`, { stakes }), 'Ownership saved.', 'Failed to save the ownership');
    if (done) setStakeEditor(null);
  }

  // ---- sectors: rename (every business using it follows) or clear
  const [sectorEditor, setSectorEditor] = useState(false);
  const [sectorEdit, setSectorEdit] = useState(null); // { from, to }
  async function saveSector(from, to) {
    const done = await run(() => apiClient.patch('/group-companies/sectors', { from, to: to || null }), to ? 'Sector renamed.' : 'Sector cleared.', 'Failed to update the sector');
    if (done) setSectorEdit(null);
  }

  async function removeBusiness() {
    const c = removing;
    await run(() => apiClient.delete(`/group-companies/${c.id}`), `${c.name} removed.`, 'Failed to remove');
    setRemoving(null);
  }

  async function groupDefault() {
    await run(async () => { const { data: res } = await apiClient.post('/group-companies/stakes/group-default'); pushSuccess(`${res.data.updated} compan${res.data.updated === 1 ? 'y' : 'ies'} set as wholly owned by the group.`, 'Done'); }, null, 'Failed to set the ownership');
  }

  if (!data) return <Skeleton className="h-64 w-full" />;
  const { summary, sectors } = data;
  const countOf = (key) => (['operational', 'planning', 'future'].includes(key) ? summary.by_status[key] : key === 'overall' ? summary.total : sectors.length);

  return (
    <div className="space-y-4" data-testid="group-companies">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Businesses" value={summary.total} icon={Building2} theme="blue" hint={`${summary.current} with a workspace, ${summary.off_platform} without`} />
        <KpiTile label="Operational" value={summary.by_status.operational} icon={Factory} theme="green" hint="running today" />
        <KpiTile label="Planning + future" value={summary.by_status.planning + summary.by_status.future} icon={PieChart} theme="purple" hint="new businesses being planned" />
        <KpiTile label="Ownership not set" value={summary.stakes_missing} icon={CircleDollarSign} theme="orange" hint={summary.stakes_over ? `${summary.stakes_over} above 100%` : 'businesses with no holder yet'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} data-testid={`view-${v.key}`} onClick={() => setView(v.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${view === v.key ? 'border-[#105AA9] bg-[#105AA9] text-white shadow-sm' : 'border-tertiary-100 bg-canvas-muted text-tertiary-600 hover:border-tertiary-200 hover:bg-tertiary-50'}`}>
              {v.label} <span className="ml-0.5 opacity-70">{countOf(v.key)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.stakes_missing > 0 && <button type="button" className="btn-secondary text-xs" data-testid="group-default" disabled={busy} onClick={groupDefault} title="Every company workspace with no holder yet is recorded as 100% held by the group">Set empty workspaces as wholly group-owned</button>}
          <button type="button" className="btn-secondary text-xs" data-testid="manage-sectors" onClick={() => setSectorEditor(true)}>Manage sectors</button>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="add-business" onClick={openAdd}><Plus className="h-4 w-4" /> Add business</button>
        </div>
      </div>

      {view === 'sector' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="sector-view">
          {sectors.map((s) => (
            <section key={s.sector} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="sector-card" data-sector={s.sector}>
              <div className="flex items-baseline justify-between"><h3 className="font-heading text-sm font-semibold text-tertiary-900">{s.sector}</h3><span className="text-xs text-tertiary-500">{s.count} business{s.count === 1 ? '' : 'es'}</span></div>
              <ul className="mt-3 space-y-1.5">
                {s.companies.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm"><span className="text-tertiary-800">{c.name}</span><span className="flex items-center gap-2"><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill><span className="w-14 text-right text-xs tabular-nums text-tertiary-500">{c.total_pct ? pctText(c.total_pct) : '—'}</span></span></li>
                ))}
              </ul>
            </section>
          ))}
          {!sectors.length && <p className="text-sm text-tertiary-500">No businesses yet.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-tertiary-100 bg-white shadow-card" data-testid="company-table">
          <table className="min-w-full text-sm">
            <thead className="bg-canvas-muted">
              <tr><th className={th}>Company</th><th className={th}>Short</th><th className={th}>Sector</th><th className={th}>Ownership</th><th className={th}>Held by</th><th className={th}>Tag line</th><th className={th}>Foundation day</th>{view === 'overall' && <th className={th}>Status</th>}<th className={th}><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-t border-tertiary-100" data-testid="company-row" data-company={c.name}>
                  <td className={`${td} font-medium text-tertiary-900`}>
                    {c.name}
                    <span className="ml-1.5 align-middle">{c.is_current ? (c.coming_soon ? <Pill tone="amber">Coming soon</Pill> : <Pill tone="blue">Workspace</Pill>) : <Pill tone="gray">No workspace</Pill>}</span>
                    {c.holdings.length > 0 && <span className="mt-1 block text-[11px] font-normal text-tertiary-500">Holds: {c.holdings.map((h) => `${h.company} ${pctText(h.pct)}`).join(', ')}</span>}
                  </td>
                  <td className={td}>{c.short_code || <span className="text-tertiary-400">{initials(c.name)}</span>}</td>
                  <td className={td}>{c.sector ? <Pill tone="gray">{c.sector}</Pill> : <span className="text-tertiary-300">—</span>}</td>
                  <td className={td}><Ownership company={c} /></td>
                  <td className={td}><HolderChips holders={c.holders} /></td>
                  <td className={`${td} max-w-xs text-xs text-tertiary-600`}>{c.tagline || '—'}</td>
                  <td className={`${td} whitespace-nowrap`}>{dayText(c.foundation_date)}</td>
                  {view === 'overall' && <td className={td}><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill></td>}
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <button type="button" aria-label={`Ownership of ${c.name}`} title="Edit ownership" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50" onClick={() => openStakes(c)}><PieChart className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Edit ${c.name}`} title="Edit details" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></button>
                    {!c.is_current && <button type="button" aria-label={`Remove ${c.name}`} title="Remove" className="rounded p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => setRemoving(c)}><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-tertiary-500">{view === 'overall' ? 'No businesses yet.' : `Nothing is marked ${view} yet. Use Add business, or change a company's status.`}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'overall' && (
        <>
          <SectionHeading title="Who holds what" hint="Every stake of the register, grouped by holder" />
          <div className="grid gap-4 md:grid-cols-2" data-testid="holdings-view">
            {holdersMap.map((h) => (
              <section key={h.label} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
                <h3 className="font-heading text-sm font-semibold text-tertiary-900">{h.label} <span className="ml-1 text-xs font-normal text-tertiary-500">{h.kind === 'external' ? 'outside the group' : h.kind === 'group' ? 'the group' : 'business of the group'}</span></h3>
                <ul className="mt-2 space-y-1 text-sm">{h.items.map((i) => <li key={i.company} className="flex justify-between"><span>{i.company}</span><b className="tabular-nums">{pctText(i.pct)}</b></li>)}</ul>
              </section>
            ))}
            {!holdersMap.length && <p className="text-sm text-tertiary-500">No ownership recorded yet. Use the ownership icon on a business, or set the empty workspaces as wholly group-owned.</p>}
          </div>
        </>
      )}

      <Drawer open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.id ? 'Edit business' : 'Add business'} tone={editor?.id ? 'edit' : 'create'}
        footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditor(null)}>Cancel</button><button type="button" className="btn-primary" data-testid="save-business" disabled={busy} onClick={saveDetails}>{busy ? 'Saving…' : editor?.id ? 'Save changes' : 'Add business'}</button></div>}>
        {editor && (
          <div className="space-y-4" data-testid="business-form">
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Business name *</label>
              <input className={FIELD_INPUT} aria-label="Business name" value={editor.form.name} onChange={setField('name')} disabled={editor.linked} maxLength={150} />
              {editor.linked && <p className="mt-1 text-xs text-tertiary-500">This company has a workspace; its name is changed in its own Settings.</p>}
            </div>
            {!editor.id && data.groups.length > 1 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-tertiary-600">Holding group *</label>
                <SearchableSelect ariaLabel="Holding group" value={editor.form.org_group_id} onChange={(v) => setEditor((p) => ({ ...p, form: { ...p.form, org_group_id: v || '' } }))} options={data.groups.map((g) => ({ value: g.id, label: g.name }))} placeholder="Choose the holding group" searchPlaceholder="Search…" />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Short name</label><input className={FIELD_INPUT} aria-label="Short name" value={editor.form.short_code} onChange={setField('short_code')} maxLength={12} placeholder={initials(editor.form.name || '')} /></div>
              <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Status</label><SearchableSelect ariaLabel="Status" value={editor.form.status} onChange={(v) => setEditor((p) => ({ ...p, form: { ...p.form, status: v || 'planning' } }))} options={STATUS_OPTIONS} placeholder="Status" searchPlaceholder="Search…" /></div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Sector</label>
              <SearchableSelect
                ariaLabel="Sector"
                value={editor.newSector ? ADD_SECTOR : editor.form.sector}
                onChange={(v) => setEditor((p) => (v === ADD_SECTOR ? { ...p, newSector: true, form: { ...p.form, sector: '' } } : { ...p, newSector: false, form: { ...p.form, sector: v || '' } }))}
                options={[...new Set([...DEFAULT_SECTORS, ...data.sector_options, editor.form.sector].filter(Boolean))].sort().map((s) => ({ value: s, label: s })).concat({ value: ADD_SECTOR, label: 'Add a new sector…' })}
                placeholder="Select a sector"
                searchPlaceholder="Search…"
                allowClear
              />
              {editor.newSector && <input className={`${FIELD_INPUT} mt-2`} aria-label="New sector" value={editor.form.sector} onChange={setField('sector')} maxLength={100} placeholder="Type the new sector" autoFocus />}
            </div>
            <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Tag line</label><input className={FIELD_INPUT} aria-label="Tag line" value={editor.form.tagline} onChange={setField('tagline')} maxLength={300} /></div>
            <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Foundation day (planned date for a business not started yet)</label><input type="date" className={FIELD_INPUT} aria-label="Foundation day" value={editor.form.foundation_date} onChange={setField('foundation_date')} /></div>
            <div><label className="mb-1 block text-xs font-medium text-tertiary-600">Notes</label><textarea rows={3} className={FIELD_INPUT} aria-label="Notes" value={editor.form.notes} onChange={setField('notes')} maxLength={2000} /></div>
          </div>
        )}
      </Drawer>

      <Drawer open={sectorEditor} onClose={() => { setSectorEditor(false); setSectorEdit(null); }} title="Manage sectors" tone="edit"
        footer={<div className="flex justify-end"><button type="button" className="btn-secondary" onClick={() => { setSectorEditor(false); setSectorEdit(null); }}>Close</button></div>}>
        <div className="space-y-3" data-testid="sector-manager">
          <p className="text-xs text-tertiary-500">Rename a sector and every business in it follows. Clearing a sector leaves its businesses with no sector.</p>
          {sectors.filter((s) => s.sector !== 'Not set').map((s) => (
            <div key={s.sector} className="flex items-center gap-2 rounded-lg border border-tertiary-100 p-2" data-testid="sector-row">
              {sectorEdit?.from === s.sector ? (
                <>
                  <input className={FIELD_INPUT} aria-label="Sector name" value={sectorEdit.to} maxLength={100} autoFocus onChange={(e) => setSectorEdit((p) => ({ ...p, to: e.target.value }))} />
                  <button type="button" className="btn-primary text-xs" disabled={busy || !sectorEdit.to.trim()} onClick={() => saveSector(s.sector, sectorEdit.to.trim())}>Save</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setSectorEdit(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-tertiary-800">{s.sector} <span className="text-xs text-tertiary-500">({s.count})</span></span>
                  <button type="button" className="rounded p-1.5 text-tertiary-500 hover:bg-tertiary-50" aria-label={`Rename ${s.sector}`} onClick={() => setSectorEdit({ from: s.sector, to: s.sector })}><Pencil className="h-4 w-4" /></button>
                  <button type="button" className="rounded p-1.5 text-danger-600 hover:bg-danger-50" aria-label={`Clear ${s.sector}`} disabled={busy} onClick={() => saveSector(s.sector, null)}><Trash2 className="h-4 w-4" /></button>
                </>
              )}
            </div>
          ))}
          {!sectors.some((s) => s.sector !== 'Not set') && <p className="text-sm text-tertiary-500">No sector is in use yet. Pick one when you add or edit a business.</p>}
        </div>
      </Drawer>

      <Drawer open={Boolean(stakeEditor)} onClose={() => setStakeEditor(null)} title={stakeEditor ? `Ownership: ${stakeEditor.company.name}` : ''} tone="edit"
        footer={<div className="flex items-center justify-between gap-2"><span className={`text-sm font-medium ${total > 100.0005 ? 'text-danger-700' : 'text-tertiary-700'}`} data-testid="stake-total">Total {pctText(total)}</span><div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => setStakeEditor(null)}>Cancel</button><button type="button" className="btn-primary" data-testid="save-stakes" disabled={busy} onClick={saveStakes}>{busy ? 'Saving…' : 'Save ownership'}</button></div></div>}>
        {stakeEditor && (
          <div className="space-y-3" data-testid="stake-form">
            <p className="text-xs text-tertiary-500">Who holds this business and how much. The percentages add up to at most 100%; leave the rest unassigned if it is not known.</p>
            {stakeEditor.rows.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-tertiary-100 p-3 sm:grid-cols-[1fr_7rem_auto]" data-testid="stake-row">
                <div className="space-y-2">
                  <SearchableSelect ariaLabel={`Holder ${i + 1}`} value={rowValue(r)} onChange={(v) => setRow(i, v.startsWith('company:') ? { kind: 'company', holder_company_id: v.slice(8) } : { kind: v || 'group', holder_company_id: '' })} options={holderOptions(stakeEditor.company)} placeholder="Choose the holder" searchPlaceholder="Search…" />
                  {r.kind === 'external' && <input className={FIELD_INPUT} aria-label={`Outside holder name ${i + 1}`} placeholder="Name of the person or company" value={r.holder_name} onChange={(e) => setRow(i, { holder_name: e.target.value })} maxLength={150} />}
                </div>
                <div className="relative"><input type="number" min="0" max="100" step="0.001" className={`${FIELD_INPUT} pr-7`} aria-label={`Percentage ${i + 1}`} value={r.pct} onChange={(e) => setRow(i, { pct: e.target.value })} /><span className="pointer-events-none absolute right-3 top-2 text-sm text-tertiary-400">%</span></div>
                <button type="button" aria-label={`Remove holder ${i + 1}`} className="rounded p-2 text-danger-600 hover:bg-danger-50" onClick={() => setStakeEditor((p) => ({ ...p, rows: p.rows.filter((_, idx) => idx !== i) }))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" data-testid="add-holder" onClick={() => setStakeEditor((p) => ({ ...p, rows: [...p.rows, { kind: 'group', holder_company_id: '', holder_name: '', pct: String(Math.max(0, Math.round((100 - total) * 1000) / 1000) || '') }] }))}><Plus className="h-3.5 w-3.5" /> Add holder</button>
              {stakeEditor.rows.length === 0 && <button type="button" className="btn-ghost text-xs" onClick={() => setStakeEditor((p) => ({ ...p, rows: [{ kind: 'group', holder_company_id: '', holder_name: '', pct: '100' }] }))}>Wholly owned by the group (100%)</button>}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={Boolean(removing)} danger busy={busy} title="Remove this business?" message={removing ? `${removing.name} is removed from the register, together with the stakes held in it and the stakes it holds in other businesses.` : ''} confirmLabel="Remove" onConfirm={removeBusiness} onClose={() => setRemoving(null)} />
    </div>
  );
}
