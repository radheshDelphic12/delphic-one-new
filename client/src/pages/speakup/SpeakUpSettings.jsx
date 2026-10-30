import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import Toggle from '../../components/ui/Toggle.jsx';

const FIELD = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';

/** One category: reword it, switch it off, mark it restricted and choose the people who receive it. Saved per row. */
function CategoryRow({ category, members, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const [draft, setDraft] = useState(category);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(category), [category]);
  const dirty = JSON.stringify([draft.name, draft.examples, draft.restricted, draft.active, draft.handler_membership_ids]) !== JSON.stringify([category.name, category.examples, category.restricted, category.active, category.handler_membership_ids]);
  const nameOf = (id) => members.find((m) => m.value === id)?.label || category.handlers.find((h) => h.id === id)?.name || 'Unknown';

  async function save() {
    setBusy(true);
    try {
      await apiClient.patch(`/whistleblower/categories/${category.id}`, { name: draft.name, examples: draft.examples, restricted: draft.restricted, active: draft.active, handler_membership_ids: draft.handler_membership_ids });
      pushSuccess('Category saved');
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save the category'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`space-y-3 rounded-xl border p-3 ${draft.active ? 'border-tertiary-200 bg-white' : 'border-tertiary-100 bg-tertiary-50'}`}>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="block text-xs font-medium text-tertiary-600">{category.number}. Name<input className={FIELD} maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="block text-xs font-medium text-tertiary-600">Examples shown to the employee<input className={FIELD} maxLength={500} value={draft.examples} onChange={(e) => setDraft({ ...draft, examples: e.target.value })} /></label>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-tertiary-600">Handlers (who receive this category; empty = the company admins)</p>
          <div className="mt-1"><SearchableSelect value="" onChange={(id) => { if (id && !draft.handler_membership_ids.includes(id)) setDraft({ ...draft, handler_membership_ids: [...draft.handler_membership_ids, id] }); }} options={members} placeholder="Add a handler…" /></div>
          {draft.handler_membership_ids.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {draft.handler_membership_ids.map((id) => (
                <li key={id} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-xs">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => setDraft({ ...draft, handler_membership_ids: draft.handler_membership_ids.filter((x) => x !== id) })}><X className="h-3 w-3" /></button></li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div className="text-xs font-medium text-tertiary-600"><span className="mb-1 block">Restricted</span><Toggle checked={draft.restricted} onChange={(v) => setDraft({ ...draft, restricted: v })} label="Restricted: only its handlers and the group admin see it" /></div>
          <div className="text-xs font-medium text-tertiary-600"><span className="mb-1 block">Available</span><Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Employees can pick this category" /></div>
          <button type="button" className="btn-primary ml-auto" disabled={!dirty || busy || draft.name.trim().length < 2} onClick={save}>Save</button>
        </div>
      </div>
      {draft.restricted && <p className="text-xs text-amber-800">Restricted: only the handlers named here (and the group admin) see these complaints, not every admin. With no handler named, the admins receive them so nothing is lost.</p>}
    </li>
  );
}

/** Speak Up settings: switch it on, allow anonymous reports, the overdue period, and the categories with their handlers. */
export default function SpeakUpSettings({ onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [settings, setSettings] = useState(null);
  const [categories, setCategories] = useState(null);
  const [newName, setNewName] = useState('');
  const members = useOrgMembershipOptions(true);

  const load = useCallback(() => {
    apiClient.get('/whistleblower/settings').then(({ data }) => setSettings(data.data)).catch(() => setSettings(null));
    apiClient.get('/whistleblower/categories').then(({ data }) => setCategories(data.data.categories)).catch((err) => pushError(apiErrorMessage(err, 'Could not load the categories'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  async function save(patch) {
    try {
      const { data } = await apiClient.put('/whistleblower/settings', patch);
      setSettings(data.data.settings);
      pushSuccess('Saved');
      onChanged?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not save'), 'Something went wrong');
    }
  }

  async function addCategory(event) {
    event.preventDefault();
    try {
      await apiClient.post('/whistleblower/categories', { name: newName.trim() });
      setNewName('');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not add the category'), 'Something went wrong');
    }
  }

  if (!settings) return <p className="text-sm text-tertiary-500">Loading…</p>;
  return (
    <div className="space-y-5" data-testid="speakup-settings">
      <section className="space-y-4 rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-heading text-sm font-semibold text-tertiary-900">Speak Up is {settings.enabled ? 'on' : 'off'} for this company</h3>
            <p className="mt-1 text-sm text-tertiary-500">While it is off, employees do not see it. Set the handlers for each category below before you switch it on, otherwise complaints go to the company admins.</p>
          </div>
          <Toggle checked={settings.enabled} onChange={(v) => save({ enabled: v })} label="Switch Speak Up on" />
        </div>
        <div className="flex items-start justify-between gap-4 border-t pt-4">
          <div><h3 className="text-sm font-medium text-tertiary-900">Allow anonymous complaints</h3><p className="mt-1 text-sm text-tertiary-500">The reporter gets a tracking code instead of an account link. No name is saved.</p></div>
          <Toggle checked={settings.allow_anonymous} onChange={(v) => save({ allow_anonymous: v })} label="Allow anonymous complaints" />
        </div>
        <label className="block border-t pt-4 text-sm font-medium text-tertiary-900">Mark a complaint overdue after
          <span className="ml-2 inline-flex items-center gap-2"><input type="number" min={1} max={90} className="w-20 rounded-xl border px-3 py-1.5 text-sm" defaultValue={settings.sla_days} onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 90 && n !== settings.sla_days) save({ sla_days: n }); }} /> days without any activity</span>
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold text-tertiary-900">Categories and handlers</h3>
        {!categories ? <p className="text-sm text-tertiary-500">Loading…</p> : <ul className="space-y-3">{categories.map((c) => <CategoryRow key={c.id} category={c} members={members} onSaved={load} />)}</ul>}
        <form onSubmit={addCategory} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-tertiary-300 p-3">
          <label className="min-w-0 flex-1 text-xs font-medium text-tertiary-600">Add a category<input className={FIELD} minLength={2} maxLength={120} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name of the new category" /></label>
          <button type="submit" className="btn-secondary" disabled={newName.trim().length < 2}>Add</button>
        </form>
      </section>
    </div>
  );
}
