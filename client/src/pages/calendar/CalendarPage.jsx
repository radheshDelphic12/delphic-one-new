import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, MailPlus, Plus } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { STATUS_LEGEND } from '../../lib/interviewRounds.js';
import {
  addDays,
  addMonths,
  buildWeekDays,
  dayLabel,
  endOfDay,
  firstOfMonth,
  monthLabel,
  startOfDay,
  startOfWeek,
  weekLabel,
} from './monthGrid.js';
import CalendarMonthView from './CalendarMonthView.jsx';
import CalendarTimeGrid from './CalendarTimeGrid.jsx';
import CalendarAgendaView from './CalendarAgendaView.jsx';
import EventDetailDrawer from './EventDetailDrawer.jsx';
import FeedbackDrawer from './FeedbackDrawer.jsx';
import SendInviteDrawer from './SendInviteDrawer.jsx';

const VIEW_KEY = 'delphic_calendar_view';
const STATUSES = ['all', 'scheduled', 'completed', 'cancelled'];
const AUDIENCES = [
  { id: 'all', label: 'All types' },
  { id: 'internal', label: 'Internal' },
  { id: 'external', label: 'External' },
];
const SORTS = [
  { id: 'time', label: 'Sort by time' },
  { id: 'audience', label: 'Sort by type' },
];
const VIEWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Agenda' },
];

function readStoredView() {
  const stored = localStorage.getItem(VIEW_KEY);
  if (stored === 'agenda' || stored === 'month' || stored === 'week' || stored === 'day') return stored;
  return 'day';
}

export default function CalendarPage() {
  const { user } = useAuth();
  const { pushError } = useAlerts();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [view, setView] = useState(readStoredView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState(user?.role === 'recruiter' ? 'mine' : 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [audience, setAudience] = useState('all');
  const [sortBy, setSortBy] = useState('time');

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [detailEvent, setDetailEvent] = useState(null);
  const [feedbackEvent, setFeedbackEvent] = useState(null);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const range = useMemo(() => {
    if (view === 'agenda') {
      const from = startOfDay(new Date());
      const to = addDays(from, 60);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    if (view === 'day') {
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    }
    if (view === 'week') {
      const from = startOfWeek(anchor);
      const to = endOfDay(addDays(from, 6));
      return { from, to };
    }
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    to.setDate(to.getDate() + 14);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = { from: range.from.toISOString(), to: range.to.toISOString() };
      if (scope === 'mine') params.mine = '1';
      if (statusFilter !== 'all') params.status = statusFilter;
      if (audience !== 'all') params.audience = audience;
      if (sortBy !== 'time') params.sort = sortBy;
      const { data } = await apiClient.get('/interviews', { params });
      setEvents(data.data || []);
    } catch (err) {
      setError(true);
      pushError(apiErrorMessage(err, 'Failed to load the calendar'));
    } finally {
      setLoading(false);
    }
  }, [range, scope, statusFilter, audience, sortBy, pushError]);

  useEffect(() => {
    load();
  }, [load]);

  function openDetail(ev) {
    setDetailEvent(ev);
  }
  function openFeedback(ev) {
    setDetailEvent(null);
    setFeedbackEvent(ev);
  }

  function goToday() {
    setAnchor(startOfDay(new Date()));
  }

  function goPrev() {
    if (view === 'month') setAnchor((a) => firstOfMonth(addMonths(a, -1)));
    else if (view === 'week') setAnchor((a) => addDays(a, -7));
    else if (view === 'day') setAnchor((a) => addDays(a, -1));
    else setAnchor((a) => addDays(a, -7));
  }

  function goNext() {
    if (view === 'month') setAnchor((a) => firstOfMonth(addMonths(a, 1)));
    else if (view === 'week') setAnchor((a) => addDays(a, 7));
    else if (view === 'day') setAnchor((a) => addDays(a, 1));
    else setAnchor((a) => addDays(a, 7));
  }

  const heading =
    view === 'agenda'
      ? 'Next 60 days'
      : view === 'week'
        ? weekLabel(anchor)
        : view === 'day'
          ? dayLabel(anchor)
          : monthLabel(anchor);

  // Role-wise "schedule" CTA. There is no standalone scheduler; interviews are
  // added from a submission's interview-rounds panel, client meetings from an
  // account's stage/meeting flow, so route to the right list.
  const scheduleCta =
    user?.role === 'bda'
      ? { label: 'Schedule meeting', to: '/accounts' }
      : ['recruiter', 'sales', 'admin'].includes(user?.role)
        ? { label: 'Schedule interview', to: '/submissions' }
        : null;

  const weekDays = useMemo(() => buildWeekDays(anchor), [anchor]);
  const dayColumn = useMemo(() => {
    const today = new Date();
    const d = startOfDay(anchor);
    return [{ date: d, isToday: d.toDateString() === today.toDateString() }];
  }, [anchor]);

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-tertiary-100 bg-white px-3 py-2 shadow-card">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg p-1.5 text-tertiary-500 hover:bg-tertiary-50"
            aria-label="Previous"
            onClick={goPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={goToday}>
            Today
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-tertiary-500 hover:bg-tertiary-50"
            aria-label="Next"
            onClick={goNext}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-1 font-heading text-sm font-semibold text-tertiary-900">{heading}</h2>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={view}
            onChange={(e) => setView(e.target.value)}
            className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs"
            aria-label="Calendar view"
          >
            {VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-lg border border-tertiary-200 p-0.5">
            <button
              type="button"
              onClick={() => setScope('mine')}
              className={`rounded px-2 py-1 text-xs ${scope === 'mine' ? 'bg-primary-600 text-white' : 'text-tertiary-600'}`}
              title="Interviews you scheduled, are tagged on, or submitted the candidate for"
            >
              My interviews
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`rounded px-2 py-1 text-xs ${scope === 'all' ? 'bg-primary-600 text-white' : 'text-tertiary-600'}`}
              title="Every interview and meeting, across all users"
            >
              All
            </button>
          </div>

          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs"
            title="Internal vs external interviews"
          >
            {AUDIENCES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs capitalize"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <button type="button" className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs" onClick={() => setInviteOpen(true)}>
            <MailPlus className="h-3.5 w-3.5" />
            Send invite
          </button>

          {scheduleCta && (
            <Link
              to={scheduleCta.to}
              className="btn-primary inline-flex items-center gap-1 px-2.5 py-1 text-xs"
              title={scheduleCta.label}
            >
              <Plus className="h-3.5 w-3.5" />
              {scheduleCta.label}
            </Link>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-tertiary-100 pt-2 text-[11px] text-tertiary-500">
          {STATUS_LEGEND.map((l) => (
            <span key={l.key} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${l.dot}`} /> {l.label}
            </span>
          ))}
          <span className="text-tertiary-400">Scheduled slots show the interview category; an outcome recolours the slot.</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={CalendarX}
          title="Couldn’t load the calendar"
          description="Something went wrong fetching your interviews."
          action={
            <button type="button" className="btn-primary text-xs" onClick={load}>
              Retry
            </button>
          }
        />
      ) : view === 'month' ? (
        <>
          <div className="md:hidden">
            <CalendarAgendaView
              events={events}
              onOpenDetail={openDetail}
              onFeedback={openFeedback}
              onCancel={openDetail}
            />
          </div>
          <div className="hidden md:block">
            <CalendarMonthView anchor={anchor} events={events} onSelectEvent={openDetail} onFeedback={openFeedback} />
          </div>
        </>
      ) : view === 'week' ? (
        <>
          <div className="md:hidden">
            <CalendarAgendaView
              events={events}
              onOpenDetail={openDetail}
              onFeedback={openFeedback}
              onCancel={openDetail}
            />
          </div>
          <div className="hidden md:block">
            <CalendarTimeGrid days={weekDays} events={events} onSelectEvent={openDetail} onFeedback={openFeedback} />
          </div>
        </>
      ) : view === 'day' ? (
        <CalendarTimeGrid days={dayColumn} events={events} onSelectEvent={openDetail} onFeedback={openFeedback} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No interviews in this range"
          description="Schedule one from a submission’s interview-rounds panel."
        />
      ) : (
        <CalendarAgendaView
          events={events}
          onOpenDetail={openDetail}
          onFeedback={openFeedback}
          onCancel={openDetail}
        />
      )}

      <SendInviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EventDetailDrawer
        event={detailEvent}
        open={Boolean(detailEvent)}
        onClose={() => setDetailEvent(null)}
        onFeedback={openFeedback}
        onChanged={load}
      />
      <FeedbackDrawer
        event={feedbackEvent}
        open={Boolean(feedbackEvent)}
        onClose={() => setFeedbackEvent(null)}
        onSaved={load}
      />
    </div>
  );
}
