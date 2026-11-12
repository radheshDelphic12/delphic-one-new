import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, Pencil, Plane, Trash2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { MeetingsPanel, STATE, TripForm, dayText, inr } from '../groupOverview/GroupTravelTab.jsx';

const BASE = '/super-dashboard/group/travel';

/**
 * A Group Dashboard trip opened from the calendar. Same trip as the Travel tab (one record): edit it, change its status,
 * link / add its meetings or delete it here and the Travel tab shows the change, and the other way round.
 */
export default function TripEventDrawer({ tripId, open, onClose, onChanged }) {
  const { pushSuccess, pushError } = useAlerts();
  const [trip, setTrip] = useState(null);
  const [options, setOptions] = useState(null);
  const [mode, setMode] = useState('view'); // view | edit | meetings
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const [t, o] = await Promise.all([apiClient.get(`${BASE}/${tripId}`), apiClient.get(`${BASE}/options`)]);
      setTrip(t.data.data);
      setOptions(o.data.data);
    } catch (e) {
      pushError(apiErrorMessage(e, 'Could not load the trip'), 'Load failed');
    }
  }, [tripId, pushError]);

  useEffect(() => {
    if (!open) return;
    setMode('view');
    setError('');
    setTrip(null);
    load();
  }, [open, load]);

  // The calendar should show every change straight away (dates, status, new meetings).
  const changed = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);

  async function save(body) {
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`${BASE}/${trip.id}`, body);
      pushSuccess('Trip saved');
      setMode('view');
      await changed();
    } catch (e) { setError(apiErrorMessage(e, 'Could not save the trip')); } finally { setBusy(false); }
  }
  async function setStatus(status) {
    setBusy(true);
    try {
      await apiClient.patch(`${BASE}/${trip.id}`, { status });
      pushSuccess(status === 'completed' ? 'Trip marked completed' : status === 'cancelled' ? 'Trip cancelled' : 'Trip back to planned');
      await changed();
    } catch (e) { pushError(apiErrorMessage(e, 'Could not update the trip'), 'Not saved'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete the trip "${trip.title}"? Its meetings stay on the calendar.`)) return;
    setBusy(true);
    try {
      await apiClient.delete(`${BASE}/${trip.id}`);
      pushSuccess('Trip deleted');
      onClose();
      onChanged?.();
    } catch (e) { pushError(apiErrorMessage(e, 'Could not delete'), 'Not deleted'); setBusy(false); }
  }

  const [tone, stateLabel] = trip ? STATE[trip.state] || ['gray', trip.state] : ['gray', ''];
  return (
    <Drawer open={open} onClose={() => !busy && onClose()} size="lg" tone={mode === 'view' ? 'info' : 'edit'} title={mode === 'edit' ? 'Edit trip' : mode === 'meetings' ? 'Meetings on this trip' : 'Trip'}>
      {!trip ? <Skeleton className="h-32 w-full" /> : mode === 'edit' ? (
        <TripForm key={trip.id} initial={trip} options={options} companies={options?.companies || []} onSubmit={save} saving={busy} error={error} />
      ) : mode === 'meetings' ? (
        <MeetingsPanel key={trip.id} trip={trip} options={options} onChanged={changed} />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="flex flex-wrap items-center gap-2 font-heading text-base font-semibold text-tertiary-900">
              <Plane className="h-4 w-4 text-primary-600" />{trip.title}<Pill tone={tone}>{stateLabel}</Pill>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-tertiary-500">
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{trip.origin ? `${trip.origin} → ` : ''}{trip.destination}</span>
              <span>{dayText(trip.start_date)}{trip.end_date !== trip.start_date ? ` – ${dayText(trip.end_date)}` : ''} · {trip.days} day{trip.days === 1 ? '' : 's'}</span>
            </p>
          </div>
          {trip.purpose && <p className="text-sm text-tertiary-700">{trip.purpose}</p>}

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">Travelling</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {trip.travelers.map((p) => <span key={p.id} className="rounded-full bg-canvas-muted px-2 py-0.5 text-xs text-tertiary-700">{p.name}</span>)}
              {!trip.travelers.length && <span className="text-xs text-tertiary-400">Nobody added</span>}
            </div>
          </div>

          <div>
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary-500"><Wallet className="h-3.5 w-3.5" />Budget</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-tertiary-900">
              {inr(trip.budget)}
              {trip.actual_spent !== null && <span className={`ml-2 text-xs font-medium ${trip.over_budget ? 'text-danger-600' : 'text-success-700'}`}>spent {inr(trip.actual_spent)}{trip.over_budget ? ` · ${inr(-trip.remaining_budget)} over` : ''}</span>}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">Meetings ({trip.meetings.length})</p>
            <ul className="mt-1 space-y-0.5">
              {trip.meetings.map((x) => (
                <li key={x.key} className="text-xs text-tertiary-700">
                  {x.scheduled_at ? new Date(x.scheduled_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'time not set'} · {x.account_name || x.title}
                </li>
              ))}
              {!trip.meetings.length && <li className="text-xs text-tertiary-400">None linked yet</li>}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-tertiary-100 pt-3">
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" disabled={busy} onClick={() => setMode('meetings')}><CalendarClock className="h-3.5 w-3.5" />Meetings</button>
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" disabled={busy} onClick={() => { setError(''); setMode('edit'); }}><Pencil className="h-3.5 w-3.5" />Edit trip</button>
            {trip.status === 'planned' && <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => setStatus('completed')}>Mark completed</button>}
            {trip.status === 'planned' && <button type="button" className="btn-ghost text-xs text-danger-600" disabled={busy} onClick={() => setStatus('cancelled')}>Cancel trip</button>}
            {trip.status !== 'planned' && <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => setStatus('planned')}>Back to planned</button>}
            <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs text-danger-600" disabled={busy} onClick={remove}><Trash2 className="h-3.5 w-3.5" />Delete</button>
            <Link to="/group-overview?section=travel" className="btn-ghost ml-auto text-xs" onClick={onClose}>Open in Group Dashboard</Link>
          </div>
        </div>
      )}
    </Drawer>
  );
}
