import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../apiClient.js';
import { useAuth } from '../authContext.jsx';
import { useAlerts } from '../alerts/alertContext.jsx';

const NotificationsContext = createContext(null);

const PAGE_SIZE = 20;
const POLL_MS = 60_000;

/**
 * Holds the notification list + unread count. All fetches are non-critical: on
 * failure we swallow the error and keep the last-known state (the bell must never
 * break the page). Polls the unread count every 60s while the tab is visible.
 *
 * SSE / WebSocket swap-in point: replace the setInterval poll below with a live
 * subscription and call `reload()` / bump `unreadCount` on push.
 */
export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const { pushInfo } = useAlerts();

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const cursorRef = useRef(null);
  const lastUnreadRef = useRef(0);
  const announcedRef = useRef(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data } = await apiClient.get('/notifications', { params: { limit: PAGE_SIZE } });
      setItems(data.data || []);
      setHasMore(Boolean(data.has_more));
      cursorRef.current = data.next_cursor || null;
    } catch {
      /* keep last-known state */
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refreshCount = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await apiClient.get('/notifications/unread-count');
      const next = data.data?.count ?? 0;
      if (next > lastUnreadRef.current && announcedRef.current) {
        pushInfo('You have new notifications', '');
      }
      lastUnreadRef.current = next;
      announcedRef.current = true;
      setUnreadCount(next);
    } catch {
      /* keep last-known count */
    }
  }, [user, pushInfo]);

  const loadMore = useCallback(async () => {
    if (!user || !cursorRef.current) return;
    try {
      const { data } = await apiClient.get('/notifications', {
        params: { limit: PAGE_SIZE, cursor: cursorRef.current },
      });
      setItems((prev) => [...prev, ...(data.data || [])]);
      setHasMore(Boolean(data.has_more));
      cursorRef.current = data.next_cursor || null;
    } catch {
      /* ignore */
    }
  }, [user]);

  const markRead = useCallback(async (ids) => {
    if (!ids?.length) return;
    const idSet = new Set(ids);
    setItems((prev) => prev.map((n) => (idSet.has(n.id) && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - ids.length));
    try {
      await apiClient.post('/notifications/read', { ids });
      refreshCount();
    } catch {
      refreshCount();
    }
  }, [refreshCount]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await apiClient.post('/notifications/read-all');
    } catch {
      refreshCount();
    }
  }, [refreshCount]);

  // Initial load + reset when the user changes (login / logout).
  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      lastUnreadRef.current = 0;
      announcedRef.current = false;
      return;
    }
    reload();
    refreshCount();
  }, [user, reload, refreshCount]);

  // 60s poll, paused while the tab is hidden; refetch on return to visible.
  useEffect(() => {
    if (!user) return undefined;
    let timer = null;
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (!document.hidden) refreshCount();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (!document.hidden) refreshCount();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refreshCount]);

  // Unread interview-related notifications (scheduled / rescheduled / cancelled /
  // reminder) — mirrored as a dot on the Calendar nav item. Derived from the
  // latest page of items, which is enough for an at-a-glance indicator.
  const interviewUnread = useMemo(
    () =>
      items.filter(
        (n) => !n.read_at && typeof n.type === 'string' && n.type.startsWith('interview_')
      ).length,
    [items]
  );

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      interviewUnread,
      loading,
      hasMore,
      reload,
      refreshCount,
      markRead,
      markAllRead,
      loadMore,
    }),
    [items, unreadCount, interviewUnread, loading, hasMore, reload, refreshCount, markRead, markAllRead, loadMore]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
