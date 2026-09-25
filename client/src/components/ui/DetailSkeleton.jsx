import Skeleton from './Skeleton.jsx';

/**
 * Loading placeholder shaped like a typical detail page: header bar plus a
 * couple of panel sections, so there's no blank flash or layout jump when
 * real content arrives.
 */
export default function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="space-y-2 border-b pb-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded border bg-white p-4">
              <Skeleton className="mb-3 h-4 w-32" />
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="rounded border bg-white p-4">
            <Skeleton className="mb-3 h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
