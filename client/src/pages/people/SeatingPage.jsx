import { useCallback, useEffect, useMemo, useState } from 'react';
import { Armchair, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { adminFor } from '../../lib/access.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { confirmAction } from '../../lib/confirmAction.js';
import useSavedState from '../../lib/useSavedState.js';
import Modal from '../../components/ui/Modal.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm';

function Stat({ label, value, hint, tone = '' }) {
  return (
    <div className={`rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card ${tone}`}>
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-tertiary-500">{hint}</p>}
    </div>
  );
}

/**
 * People > Seating: the desks of an office, who sits where, who is in the office today, and the room left for hiring (free desks against
 * the people still without a desk, the people joining soon and the open positions of the teams).
 */
export default function SeatingPage() {
  const { user } = useAuth();
  const canEdit = adminFor(user, 'hr_settings.update');
  const { pushError, pushSuccess } = useAlerts();
  const [locationId, setLocationId] = useSavedState('seating.location', '');
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState({ prefix: 'D-', count: 10, start: 1, zone: '' });
  const [seatFor, setSeatFor] = useState(null); // the desk being assigned
  const [find, setFind] = useState('');
  const load = useCallback(() => apiClient.get('/seating', { params: locationId ? { location_id: locationId } : {} }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ locations: [], seats: [], unseated: [], summary: null }); pushError(apiErrorMessage(err, 'Could not load the seating'), 'Something went wrong'); }), [locationId, pushError]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, msg) => { try { await fn(); if (msg) pushSuccess(msg); load(); } catch (err) { pushError(apiErrorMessage(err, 'Could not save'), 'Not saved'); } };
  const zones = useMemo(() => {
    const m = new Map();
    for (const s of data?.seats || []) m.set(s.zone || 'Desks', [...(m.get(s.zone || 'Desks') || []), s]);
    return [...m.entries()];
  }, [data]);
  if (!data) return <p className="text-sm text-tertiary-500">Loading...</p>;
  if (!data.location) return <p className="rounded-2xl border border-dashed border-tertiary-200 p-6 text-center text-sm text-tertiary-500">Add an office first (HR Settings &gt; Offices).</p>;
  const s = data.summary;
  const candidates = [...data.unseated, ...(data.joining || [])].filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div className="space-y-4" data-testid="seating">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs font-medium text-tertiary-600">Office
          <select value={data.location.id} onChange={(e) => setLocationId(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2 text-sm" data-testid="seating-office">{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.city ? `, ${l.city}` : ''}</option>)}</select>
        </label>
        {canEdit && <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)} data-testid="seating-add"><Plus className="h-4 w-4" />Add desks</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="seating-summary">
        <Stat label="Desks" value={s.seats} hint={`${s.occupied} taken · ${s.free} free`} />
        <Stat label="People at this office" value={s.people} hint={`${s.unseated} without a desk`} tone={s.unseated ? 'border-amber-200 bg-amber-50/40' : ''} />
        <Stat label="In the office today" value={s.in_office_today} hint="checked in today" />
        <Stat label="Joining soon / open positions" value={`${s.joining_soon} / ${s.open_positions}`} hint="people not started yet / open team positions" />
        <Stat label="Room for hiring" value={s.room_for_hiring} hint={s.room_for_hiring < 0 ? `${-s.room_for_hiring} more desks needed for those already planned` : s.room_for_hiring < s.open_positions ? `free desks after seating everyone; ${s.open_positions - Math.max(s.room_for_hiring, 0)} short of the open positions` : 'free desks after seating everyone'} tone={s.room_for_hiring < 0 ? 'border-danger-200 bg-danger-50/30' : ''} />
      </div>

      {data.seats.length === 0 ? <p className="rounded-2xl border border-dashed border-tertiary-200 p-6 text-center text-sm text-tertiary-500">No desks for this office yet.{canEdit ? ' Add desks to start the seating map.' : ''}</p> : zones.map(([zone, seats]) => (
        <section key={zone} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{zone} · {seats.filter((x) => !x.person).length} free of {seats.length}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {seats.map((seat) => (
              <div key={seat.id} data-testid="seat" className={`relative rounded-xl border p-2 text-xs ${!seat.active ? 'border-dashed border-tertiary-200 bg-tertiary-50 text-tertiary-400' : seat.person ? (seat.person.in_office_today ? 'border-success-200 bg-success-50' : 'border-primary-100 bg-primary-50/50') : 'border-tertiary-200 bg-white'}`}>
                <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1 font-semibold text-tertiary-800"><Armchair className="h-3.5 w-3.5" />{seat.label}</span>
                  {canEdit && !seat.person && <button type="button" aria-label={`Delete desk ${seat.label}`} className="text-tertiary-300 hover:text-danger-600" onClick={async () => { if (await confirmAction(`Delete desk ${seat.label}?`)) run(() => apiClient.delete(`/seating/seats/${seat.id}`), 'Desk deleted'); }}><Trash2 className="h-3 w-3" /></button>}
                </div>
                {seat.person ? (
                  <div className="mt-1">
                    <p className="truncate font-medium text-tertiary-900" title={seat.person.name}>{seat.person.name}</p>
                    <p className="truncate text-[10px] text-tertiary-500">{seat.person.designation || seat.person.department || ''}</p>
                    <p className={`text-[10px] ${seat.person.in_office_today ? 'text-success-700' : 'text-tertiary-500'}`}>{seat.person.in_office_today ? 'In today' : seat.person.today ? seat.person.today.replace('_', ' ') : 'Not in yet'}</p>
                    {canEdit && <button type="button" className="mt-1 text-[10px] text-primary-700 hover:underline" onClick={() => run(() => apiClient.put(`/seating/seats/${seat.id}/person`, { org_membership_id: null }), 'Desk freed')}>Free desk</button>}
                  </div>
                ) : seat.assigned_elsewhere ? <p className="mt-1 text-[10px] text-tertiary-500">Taken by someone from another office</p> : (
                  canEdit && seat.active ? <button type="button" className="mt-2 text-[11px] font-medium text-primary-700 hover:underline" onClick={() => { setSeatFor(seat); setFind(''); }} data-testid="seat-assign">Seat someone</button> : <p className="mt-1 text-[10px] text-tertiary-400">{seat.active ? 'Free' : 'Switched off'}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {data.unseated.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
          <h3 className="text-sm font-semibold text-tertiary-900">Without a desk ({data.unseated.length})</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">{data.unseated.map((p) => <span key={p.id} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-tertiary-800 shadow-sm">{p.name}{p.in_office_today ? ' · in today' : ''}</span>)}</div>
        </section>
      )}

      <Modal open={adding} title={`Add desks to ${data.location.name}`} onClose={() => setAdding(false)} footer={<><button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button><button type="button" className="btn-primary" onClick={() => run(() => apiClient.post('/seating/seats', { location_id: data.location.id, prefix: add.prefix, count: Number(add.count), start: Number(add.start), zone: add.zone || null }), 'Desks added').then(() => setAdding(false))} data-testid="seating-add-save">Add</button></>}>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-medium text-tertiary-600">Desk number prefix<input className={inputCls} value={add.prefix} onChange={(e) => setAdd((a) => ({ ...a, prefix: e.target.value }))} /></label>
          <label className="text-xs font-medium text-tertiary-600">How many<input type="number" min="1" max="500" className={inputCls} value={add.count} onChange={(e) => setAdd((a) => ({ ...a, count: e.target.value }))} /></label>
          <label className="text-xs font-medium text-tertiary-600">Start at<input type="number" min="1" className={inputCls} value={add.start} onChange={(e) => setAdd((a) => ({ ...a, start: e.target.value }))} /></label>
          <label className="text-xs font-medium text-tertiary-600">Floor / zone (optional)<input className={inputCls} value={add.zone} onChange={(e) => setAdd((a) => ({ ...a, zone: e.target.value }))} placeholder="e.g. Floor 2" /></label>
        </div>
        <p className="mt-2 text-xs text-tertiary-500">Adds {add.prefix}{add.start} to {add.prefix}{Number(add.start) + Number(add.count || 1) - 1}. Desk numbers already in use are skipped.</p>
      </Modal>

      <Modal open={Boolean(seatFor)} title={seatFor ? `Who sits at ${seatFor.label}?` : ''} onClose={() => setSeatFor(null)}>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a person" className={inputCls} />
        <ul className="mt-2 max-h-72 divide-y divide-tertiary-100 overflow-y-auto">
          {candidates.length === 0 && <li className="py-2 text-xs text-tertiary-500">Everyone at this office has a desk.</li>}
          {candidates.map((p) => <li key={p.id}><button type="button" className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-primary-50" data-testid="seat-candidate" onClick={() => run(() => apiClient.put(`/seating/seats/${seatFor.id}/person`, { org_membership_id: p.id }), `${p.name} seated at ${seatFor.label}`).then(() => setSeatFor(null))}><span>{p.name}</span><span className="text-xs text-tertiary-500">{p.status === 'pending_onboarding' ? 'joining' : p.designation || ''}</span></button></li>)}
        </ul>
      </Modal>
    </div>
  );
}
