import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellOff } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useNotifications } from '../../lib/notifications/notificationsContext.jsx';
import { formatRelative } from '../../lib/notifications/notificationLinks.js';
import NotificationItem from '../../components/notifications/NotificationItem.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

const PAGE_SIZE = 20;

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function NotificationsPage() {
  const { markRead, markAllRead, unreadCount } = useNotifications();
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (reset) => {
      const params = { limit: PAGE_SIZE };
      if (filter === 'unread') params.unread = '1';
      if (!reset && cursor) params.cursor = cursor;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const { data } = await apiClient.get('/notifications', { params });
        setItems((prev) => (reset ? data.data || [] : [...prev, ...(data.data || [])]));
        setHasMore(Boolean(data.has_more));
        setCursor(data.next_cursor || null);
      } catch {
        if (reset) setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, cursor]
  );

  // Reload from scratch whenever the filter changes.
  useEffect(() => {
    setCursor(null);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPage closes over cursor; intentional reset
  }, [filter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const n of items) {
      const k = dayKey(n.created_at);
      if (!map.has(k)) map.set(k, { label: dayLabel(n.created_at), rows: [] });
      map.get(k).rows.push(n);
    }
    return [...map.values()];
  }, [items]);

  function handleMarkRead(ids) {
    markRead(ids);
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
  }

  async function handleMarkAll() {
    await markAllRead();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    if (filter === 'unread') fetchPage(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5">
          {['all', 'unread'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:text-tertiary-900'
              }`}
            >
              {key}
              {key === 'unread' && unreadCount > 0 ? ` (${unreadCount > 99 ? '99+' : unreadCount})` : ''}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={unreadCount === 0}
          onClick={handleMarkAll}
        >
          Mark all read
        </button>
      </div>

      {loading ? (
        <div className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={filter === 'unread' ? 'No unread notifications' : 'You’re all caught up'}
          description="Lifecycle updates - assignments, interviews, stage changes - will show up here."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 z-10 border-b border-tertiary-100 bg-tertiary-50/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary-500 backdrop-blur">
                {group.label}
              </div>
              <div className="divide-y divide-tertiary-100">
                {group.rows.map((item) => (
                  <NotificationItem key={item.id} item={item} onMarkRead={handleMarkRead} />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="border-t border-tertiary-100 p-3 text-center">
              <button type="button" className="btn-secondary text-xs" disabled={loadingMore} onClick={() => fetchPage(false)}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}

      <p className="text-center text-[11px] text-tertiary-400">
        {items.length > 0 && `Showing ${items.length} · latest ${formatRelative(items[0].created_at)}`}
      </p>
    </div>
  );
}
