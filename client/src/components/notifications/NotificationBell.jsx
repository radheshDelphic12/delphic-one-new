import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useNotifications } from '../../lib/notifications/notificationsContext.jsx';
import NotificationItem from './NotificationItem.jsx';

/**
 * Header bell + unread badge + popover of the latest 20 notifications.
 * Mirrors the account-menu popover pattern in AppLayout (outside-click ref,
 * y-fade motion, role="menu", Esc to close).
 */
export default function NotificationBell() {
  const { items, unreadCount, loading, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const badge = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="relative rounded-lg p-2 text-tertiary-600 transition-colors hover:bg-tertiary-50 hover:text-tertiary-900"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications, ${unreadCount} unread`}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="absolute right-0 z-30 mt-2 flex max-h-[70vh] w-[min(100vw,22rem)] flex-col overflow-hidden rounded-2xl border border-tertiary-200 bg-white shadow-card max-sm:fixed max-sm:inset-x-2 max-sm:right-2 max-sm:w-auto"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-tertiary-100 px-4 py-3">
              <span className="font-heading text-sm font-semibold text-tertiary-900">Notifications</span>
              <button
                type="button"
                className="text-xs font-medium text-primary-700 hover:underline disabled:opacity-40"
                disabled={unreadCount === 0}
                onClick={() => markAllRead()}
              >
                Mark all read
              </button>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-tertiary-100 overflow-y-auto">
              {loading && items.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-tertiary-400">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-tertiary-400">You’re all caught up.</p>
              ) : (
                items.slice(0, 20).map((item) => (
                  <NotificationItem
                    key={item.id}
                    item={item}
                    compact
                    onNavigate={() => setOpen(false)}
                    onMarkRead={markRead}
                  />
                ))
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-tertiary-100 px-4 py-2.5 text-xs font-medium">
              <Link to="/notifications" className="text-primary-700 hover:underline" onClick={() => setOpen(false)}>
                View all
              </Link>
              <Link
                to="/settings?tab=notifications"
                className="text-tertiary-500 hover:text-tertiary-800"
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
