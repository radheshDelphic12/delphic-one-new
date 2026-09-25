import { useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  BadgeCheck,
  Bell,
  Building2,
  CalendarClock,
  CalendarX,
  MessageSquareText,
  UserPlus,
  UserX,
} from 'lucide-react';
import { entityLink, formatRelative } from '../../lib/notifications/notificationLinks.js';

const ICONS = {
  requirement_assigned: UserPlus,
  requirement_unassigned: UserX,
  requirement_created: Building2,
  requirement_status_changed: Bell,
  account_activated: Building2,
  interview_scheduled: CalendarClock,
  interview_rescheduled: CalendarClock,
  interview_cancelled: CalendarX,
  interview_reminder: AlarmClock,
  interview_feedback_submitted: MessageSquareText,
  candidate_submitted_to_client: BadgeCheck,
  candidate_rejected: UserX,
  candidate_backout: UserX,
  candidate_offer: BadgeCheck,
};

/**
 * One notification row. Click marks it read then navigates to the linked record.
 *
 * Args:
 *   item: Notification ({ id, type, title, body, read_at, created_at, entity_* }).
 *   onNavigate: Called after markRead so the container can close (e.g. the bell popover).
 *   onMarkRead: (ids: string[]) => void.
 *   compact: Tighter padding for the bell popover.
 */
export default function NotificationItem({ item, onNavigate, onMarkRead, compact = false }) {
  const navigate = useNavigate();
  const Icon = ICONS[item.type] || Bell;
  const unread = !item.read_at;

  function handleClick() {
    if (unread) onMarkRead?.([item.id]);
    onNavigate?.();
    navigate(entityLink(item));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-start gap-3 border-l-2 text-left transition-colors ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      } ${
        unread
          ? 'border-l-primary-600 bg-primary-50/40 hover:bg-primary-50/70'
          : 'border-l-transparent hover:bg-tertiary-50/80'
      }`}
    >
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          unread ? 'bg-primary-100 text-primary-700' : 'bg-tertiary-100 text-tertiary-500'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-heading text-sm font-semibold text-tertiary-900">{item.title}</span>
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-600" aria-hidden="true" />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-tertiary-600">{item.body}</span>
        <span className="mt-1 block text-[11px] text-tertiary-400">{formatRelative(item.created_at)}</span>
      </span>
    </button>
  );
}
