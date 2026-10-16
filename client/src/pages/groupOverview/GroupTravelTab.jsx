import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, MapPin, Pencil, Plane, Plus, Trash2, Unlink, Users, Wallet, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';

const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelCls = 'block text-xs font-medium text-tertiary-600';
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const todayLocal = () => new Date().toLocaleDateString('en-CA');
export const dayText = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'time not set');
export const STATE = {
  planned: ['blue', 'Planned'], ongoing: ['green', 'On the trip now'], completed: ['gray', 'Completed'],
  cancelled: ['red', 'Cancelled'], overdue_close: ['amber', 'Dates over - mark completed'],
};

export function TripForm({ initial, options, companies, onSubmit, saving, error }) {
  const t = initial || {};
  const [v, setV] = useState(() => ({
    title: t.title || '', org_id: t.org_id || '', origin: t.origin || '', destination: t.destination || '',
    start_date: t.start_date || todayLocal(), end_date: t.end_date || todayLocal(), purpose: t.purpose || '',
    budget: t.budget ?? '', actual_spent: t.actual_spent ?? '', status: t.status || 'planned', notes: t.notes || '',
    travelers: (t.travelers || []).map((p) => ({ user_id: p.user_id, name: p.name, org_id: p.org_id })),
  }));
  const [pick, setPick] = useState('');
  const [guest, setGuest] = useState('');
  const set = (k) => (e) => setV((c) => ({ ...c, [k]: e.target.value }));
  const people = options?.people || [];
  const addPerson = () => {
    const p = people.find((x) => `${x.user_id}:${x.org_id}` === pick);
    if (!p || v.travelers.some((x) => x.user_id === p.user_id)) return;
    setV((c) => ({ ...c, travelers: [...c.travelers, { user_id: p.user_id, name: p.name, org_id: p.org_id }] }));
    setPick('');
  };
  const addGuest = () => {
    if (!guest.trim()) return;
    setV((c) => ({ ...c, travelers: [...c.travelers, { user_id: null, name: guest.trim(), org_id: null }] }));
    setGuest('');
  };
  const bad = !v.title.trim() || !v.destination.trim() || !v.start_date || !v.end_date || v.end_date < v.start_date;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title: v.title.trim(), org_id: v.org_id || null, origin: v.origin.trim() || null, destination: v.destination.trim(),
          start_date: v.start_date, end_date: v.end_date, purpose: v.purpose.trim() || null, budget: v.budget === '' ? 0 : Number(v.budget),
          actual_spent: v.actual_spent === '' ? null : Number(v.actual_spent), status: v.status, notes: v.notes.trim() || null, travelers: v.travelers,
        });
      }}
    >
      <label className={labelCls}>Trip name<input required maxLength={200} className={inputCls} value={v.title} onChange={set('title')} placeholder="e.g. Mumbai client meetings" autoFocus /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>From<input className={inputCls} value={v.origin} onChange={set('origin')} placeholder="Indore" /></label>
        <label className={labelCls}>Going to<input required className={inputCls} value={v.destination} onChange={set('destination')} placeholder="Mumbai" /></label>
        <label className={labelCls}>Start date<input required type="date" className={inputCls} value={v.start_date} onChange={set('start_date')} /></label>
        <label className={labelCls}>End date<input required type="date" min={v.start_date} className={inputCls} value={v.end_date} onChange={set('end_date')} /></label>
        <label className={labelCls}>Company
          <select className={inputCls} value={v.org_id} onChange={set('org_id')}>
            <option value="">Whole group</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={labelCls}>Status
          <select className={inputCls} value={v.status} onChange={set('status')}><option value="planned">Planned</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        </label>
        <label className={labelCls}>Total budget (₹)<input type="number" min="0" step="any" className={inputCls} value={v.budget} onChange={set('budget')} placeholder="0" /></label>
        <label className={labelCls}>Actual spent (₹, after the trip)<input type="number" min="0" step="any" className={inputCls} value={v.actual_spent} onChange={set('actual_spent')} placeholder="not entered" /></label>
      </div>
      <div>
        <span className={labelCls}>Who is travelling</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {v.travelers.map((p, i) => (
            <span key={`${p.user_id || p.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-tertiary-200 bg-white px-2.5 py-1 text-xs font-medium text-tertiary-800">
              {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setV((c) => ({ ...c, travelers: c.travelers.filter((_, k) => k !== i) }))}><X className="h-3 w-3 text-tertiary-400 hover:text-danger-600" /></button>
            </span>
          ))}
          {!v.travelers.length && <span className="text-xs text-tertiary-400">Nobody added yet</span>}
        </div>
        <div className="mt-2 flex gap-2">
          <select className={`${inputCls} mt-0`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a person">
            <option value="">Add a person from any company…</option>
            {people.map((p) => <option key={`${p.user_id}:${p.org_id}`} value={`${p.user_id}:${p.org_id}`}>{p.name} · {p.org_name}</option>)}
          </select>
          <button type="button" className="btn-secondary shrink-0" disabled={!pick} onClick={addPerson}>Add</button>
        </div>
        <div className="mt-2 flex gap-2">
          <input className={`${inputCls} mt-0`} value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Or type a name (guest, consultant…)" aria-label="Guest name" />
          <button type="button" className="btn-secondary shrink-0" disabled={!guest.trim()} onClick={addGuest}>Add</button>
        </div>
      </div>
      <label className={labelCls}>Purpose<textarea rows={2} className={inputCls} value={v.purpose} onChange={set('purpose')} placeholder="What the trip is for" /></label>
      <label className={labelCls}>Notes<textarea rows={2} className={inputCls} value={v.notes} onChange={set('notes')} /></label>
      {v.end_date < v.start_date && <p className="text-xs text-danger-600">The end date must be on or after the start date.</p>}
      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={saving || bad}>{saving ? 'Saving…' : t.id ? 'Save trip' : 'Add trip'}</button></div>
    </form>
  );
}

export function MeetingsPanel({ trip, options, onChanged }) {
  const { pushError } = useAlerts();
  const [mode, setMode] = useState('link');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState({ account_id: '', title: '', scheduled_at: '', duration_minutes: 60, location: trip.destination || '', notes: '' });
  const linked = new Set(trip.meetings.map((x) => x.key));
  const [showAll, setShowAll] = useState(false);
  const ymd = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10); // IST calendar day
  const unlinked = (options?.meetings || []).filter((x) => !linked.has(x.key));
  const onTripDates = unlinked.filter((x) => ymd(x.scheduled_at) >= trip.start_date && ymd(x.scheduled_at) <= trip.end_date);
  const choices = showAll ? unlinked : onTripDates;
  async function run(fn, fail) {
    setBusy(true);
    try { await fn(); await onChanged(); } catch (e) { pushError(apiErrorMessage(e, fail), 'Not saved'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-tertiary-900">Meetings on this trip</h3>
        <ul className="mt-2 divide-y divide-tertiary-100 rounded-xl border border-tertiary-100">
          {trip.meetings.map((x) => (
            <li key={x.key} className="flex items-start gap-2 px-3 py-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-tertiary-900">{x.title}{x.account_name ? ` · ${x.account_name}` : ''}</p>
                <p className="text-xs text-tertiary-500">{when(x.scheduled_at)}{x.location ? ` · ${x.location}` : ''}{x.mode === 'online' ? ' · online' : ''}</p>
              </div>
              <button type="button" title="Unlink (the meeting stays on the calendar)" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" disabled={busy} onClick={() => run(() => apiClient.delete(`/super-dashboard/group/travel/${trip.id}/meetings/${x.key}`), 'Could not unlink')}><Unlink className="h-4 w-4" /></button>
            </li>
          ))}
          {!trip.meetings.length && <li className="px-3 py-3 text-sm text-tertiary-500">No meetings linked yet.</li>}
        </ul>
      </div>
      <div className="inline-flex rounded-xl border border-tertiary-200 p-0.5" role="group" aria-label="Add a meeting">
        {[['link', 'Link a calendar meeting'], ['new', 'Add a new meeting']].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
        ))}
      </div>
      {mode === 'link' ? (
        <div className="space-y-2">
          <p className="text-xs text-tertiary-500">Meetings on the Delphic Global calendar{showAll ? ' (past year to next 6 months)' : ' during the trip dates'}. Linking does not move or change them.</p>
          <label className="flex items-center gap-2 text-xs text-tertiary-600"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show meetings outside the trip dates</label>
          {!choices.length && <p className="text-xs text-warning-700">No meetings found {showAll ? '' : 'on the trip dates '}- use &ldquo;Add a new meeting&rdquo; if it is not on the calendar yet.</p>}
          <select className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Calendar meeting">
            <option value="">Choose a meeting…</option>
            {choices.map((x) => <option key={x.key} value={x.key}>{when(x.scheduled_at)} · {x.title}{x.account_name ? ` · ${x.account_name}` : ''}{x.mode === 'offline' ? ' (in person)' : ''}</option>)}
          </select>
          <button type="button" className="btn-primary" disabled={!key || busy} onClick={() => run(async () => { await apiClient.post(`/super-dashboard/group/travel/${trip.id}/meetings`, { meeting_key: key }); setKey(''); }, 'Could not link the meeting')}>Link meeting</button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await apiClient.post(`/super-dashboard/group/travel/${trip.id}/meetings/new`, { ...m, scheduled_at: new Date(m.scheduled_at).toISOString(), duration_minutes: Number(m.duration_minutes) || 60, location: m.location || null, notes: m.notes || null });
              setM((c) => ({ ...c, title: '', scheduled_at: '', notes: '' }));
            }, 'Could not add the meeting');
          }}
        >
          <p className="text-xs text-tertiary-500">Creates an in-person meeting with an active Delphic Global client. It appears on the calendar and here; the travellers are added as attendees.</p>
          <label className={labelCls}>Client
            <select required className={inputCls} value={m.account_id} onChange={(e) => setM((c) => ({ ...c, account_id: e.target.value }))}>
              <option value="">Choose a client…</option>
              {(options?.clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className={labelCls}>Meeting title<input required className={inputCls} value={m.title} onChange={(e) => setM((c) => ({ ...c, title: e.target.value }))} placeholder="e.g. Quarterly review" /></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelCls}>Date and time<input required type="datetime-local" className={inputCls} value={m.scheduled_at} onChange={(e) => setM((c) => ({ ...c, scheduled_at: e.target.value }))} /></label>
            <label className={labelCls}>Minutes<input type="number" min="5" max="1440" className={inputCls} value={m.duration_minutes} onChange={(e) => setM((c) => ({ ...c, duration_minutes: e.target.value }))} /></label>
          </div>
          <label className={labelCls}>Where<input className={inputCls} value={m.location} onChange={(e) => setM((c) => ({ ...c, location: e.target.value }))} /></label>
          <button type="submit" className="btn-primary" disabled={busy || !m.account_id || !m.title.trim() || !m.scheduled_at}>Add meeting</button>
        </form>
      )}
    </div>
  );
}

function TripCard({ trip, onEdit, onMeetings, onDelete }) {
  const [tone, stateLabel] = STATE[trip.state] || ['gray', trip.state];
  const used = trip.budget > 0 && trip.actual_spent !== null ? Math.min(100, Math.round((trip.actual_spent / trip.budget) * 100)) : null;
  return (
    <li className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="trip-card">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-heading text-base font-semibold text-tertiary-900">
            <Plane className="h-4 w-4 text-primary-600" />{trip.title}
            <Pill tone={tone}>{stateLabel}</Pill>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-tertiary-500">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{trip.origin ? `${trip.origin} → ` : ''}{trip.destination}</span>
            <span>{dayText(trip.start_date)}{trip.end_date !== trip.start_date ? ` – ${dayText(trip.end_date)}` : ''} · {trip.days} day{trip.days === 1 ? '' : 's'}</span>
            <span>{trip.org_name}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" title="Meetings" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50" onClick={onMeetings}><CalendarClock className="h-4 w-4" /></button>
          <button type="button" title="Edit" className="rounded p-1.5 text-tertiary-500 hover:bg-primary-50" onClick={onEdit}><Pencil className="h-4 w-4" /></button>
          <button type="button" title="Delete" className="rounded p-1.5 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {trip.purpose && <p className="mt-2 text-sm text-tertiary-700">{trip.purpose}</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">Travelling</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {trip.travelers.map((p) => <span key={p.id} className="rounded-full bg-canvas-muted px-2 py-0.5 text-xs text-tertiary-700">{p.name}</span>)}
            {!trip.travelers.length && <span className="text-xs text-tertiary-400">Nobody added</span>}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">Budget</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-tertiary-900">{inr(trip.budget)}{trip.actual_spent !== null && <span className={`ml-2 text-xs font-medium ${trip.over_budget ? 'text-danger-600' : 'text-success-700'}`}>spent {inr(trip.actual_spent)}{trip.over_budget ? ` · ${inr(-trip.remaining_budget)} over` : ''}</span>}</p>
          {used !== null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-tertiary-100"><div className={`h-full ${trip.over_budget ? 'bg-danger-500' : 'bg-primary-500'}`} style={{ width: `${used}%` }} /></div>}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">Meetings ({trip.meetings.length})</p>
          <ul className="mt-1 space-y-0.5">
            {trip.meetings.slice(0, 3).map((x) => <li key={x.key} className="truncate text-xs text-tertiary-700">{when(x.scheduled_at)} · {x.account_name || x.title}</li>)}
            {trip.meetings.length > 3 && <li className="text-xs text-tertiary-400">+{trip.meetings.length - 3} more</li>}
            {!trip.meetings.length && <li className="text-xs text-tertiary-400">None linked - <button type="button" className="text-primary-700 hover:underline" onClick={onMeetings}>link a meeting</button></li>}
          </ul>
        </div>
      </div>
    </li>
  );
}

export default function GroupTravelTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [view, setView] = useState('upcoming');
  const [company, setCompany] = useState('');
  const [drawer, setDrawer] = useState(null); // { trip } edit/new | { meetingsFor: id }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const data = useLiveData(() => apiClient.get('/super-dashboard/group/travel', { params: { view, ...(company ? { org_id: company } : {}) } }).then((r) => r.data.data), { intervalMs: 60000, deps: [view, company] });
  const opts = useLiveData(() => apiClient.get('/super-dashboard/group/travel/options').then((r) => r.data.data), { deps: [] });
  useEffect(() => { if (data.error) pushError(apiErrorMessage(data.error, 'Could not load the trips'), 'Load failed'); }, [data.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => { await Promise.all([data.refresh(), opts.refresh()]); }, [data, opts]);
  const d = data.data;
  const options = opts.data;
  const meetingsTrip = useMemo(() => (drawer?.meetingsFor ? d?.trips.find((t) => t.id === drawer.meetingsFor) : null), [drawer, d]);

  async function save(body) {
    setSaving(true);
    setError('');
    try {
      if (drawer.trip) await apiClient.patch(`/super-dashboard/group/travel/${drawer.trip.id}`, body);
      else await apiClient.post('/super-dashboard/group/travel', body);
      pushSuccess(drawer.trip ? 'Trip saved' : 'Trip added');
      setDrawer(null);
      refresh();
    } catch (e) { setError(apiErrorMessage(e, 'Could not save the trip')); } finally { setSaving(false); }
  }
  async function remove(trip) {
    if (!window.confirm(`Delete the trip "${trip.title}"? Its meetings stay on the calendar.`)) return;
    try { await apiClient.delete(`/super-dashboard/group/travel/${trip.id}`); refresh(); } catch (e) { pushError(apiErrorMessage(e, 'Could not delete'), 'Not deleted'); }
  }

  const s = d?.summary;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 p-0.5" role="group" aria-label="Trips shown">
          {[['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${view === k ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
        <label className="text-xs font-medium text-tertiary-600">Company
          <select className="ml-2 rounded-xl border px-3 py-1.5 text-sm" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company filter">
            <option value="">All companies</option>
            {(options?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary ml-auto inline-flex items-center gap-1.5" onClick={() => { setError(''); setDrawer({ trip: null }); }}><Plus className="h-4 w-4" />Plan a trip</button>
      </div>

      {data.loading && !d ? <Skeleton className="h-32 w-full" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Trips" value={s?.trips ?? 0} hint={`${s?.ongoing ?? 0} on the road now`} icon={Plane} theme="blue" />
            <KpiCard label="People travelling" value={s?.travellers ?? 0} hint="Across all companies" icon={Users} theme="purple" />
            <KpiCard label="Meetings linked" value={s?.meetings ?? 0} hint="From the Delphic Global calendar" icon={CalendarClock} theme="cyan" />
            <KpiCard label="Budget" value={inr(s?.budget)} hint={`Spent ${inr(s?.spent)}${s?.needs_closing ? ` · ${s.needs_closing} to close` : ''}`} icon={Wallet} theme={s?.spent > s?.budget ? 'red' : 'green'} />
          </div>
          <ul className="space-y-3" aria-label="Trips">
            {(d?.trips || []).map((t) => (
              <TripCard key={t.id} trip={t} onEdit={() => { setError(''); setDrawer({ trip: t }); }} onMeetings={() => setDrawer({ meetingsFor: t.id })} onDelete={() => remove(t)} />
            ))}
          </ul>
          {!d?.trips.length && (
            <div className="rounded-2xl border border-dashed border-tertiary-200 bg-white px-6 py-10 text-center">
              <Plane className="mx-auto h-8 w-8 text-tertiary-300" />
              <p className="mt-2 font-heading text-sm font-semibold text-tertiary-900">{view === 'past' ? 'No past trips' : 'No trips planned'}</p>
              <p className="mt-1 text-sm text-tertiary-500">Plan a trip for anyone in the group, set one total budget and link the client meetings it is for.</p>
            </div>
          )}
        </>
      )}

      <Drawer open={Boolean(drawer && 'trip' in drawer)} onClose={() => setDrawer(null)} size="lg" tone={drawer?.trip ? 'edit' : 'create'} title={drawer?.trip ? 'Edit trip' : 'Plan a trip'}>
        {drawer && 'trip' in drawer && <TripForm key={drawer.trip?.id || 'new'} initial={drawer.trip} options={options} companies={options?.companies || []} onSubmit={save} saving={saving} error={error} />}
      </Drawer>
      <Drawer open={Boolean(meetingsTrip)} onClose={() => setDrawer(null)} size="lg" tone="edit" title={meetingsTrip ? `Meetings · ${meetingsTrip.title}` : 'Meetings'}>
        {meetingsTrip && <MeetingsPanel key={meetingsTrip.id} trip={meetingsTrip} options={options} onChanged={refresh} />}
      </Drawer>
    </div>
  );
}
