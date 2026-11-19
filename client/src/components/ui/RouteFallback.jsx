import Skeleton from './Skeleton.jsx';

/**
 * Shown while a page's code is downloading. Mirrors the usual page shape (title row, stat cards,
 * content card) so the screen does not jump when the real page appears. Sits inside the app shell,
 * so the sidebar and header stay put.
 */
export default function RouteFallback() {
  return (
    <div className="space-y-5 p-1" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" rounded="2xl" />)}
      </div>
      <Skeleton className="h-72 w-full" rounded="2xl" />
    </div>
  );
}
