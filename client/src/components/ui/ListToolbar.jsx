import { Filter } from 'lucide-react';

function FilterBadge({ title }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-xs font-medium text-tertiary-700">
      <Filter className="h-3.5 w-3.5" />
      {title}
    </span>
  );
}

/**
 * Shared filter strip above list tables — matches dashboard card styling.
 */
export default function ListToolbar({ children, left, right, title = 'Filters', showTitle = true }) {
  return (
    <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
      {left || right ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {showTitle && <FilterBadge title={title} />}
            {left}
          </div>
          <div className="flex flex-wrap items-center gap-2">{right}</div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {showTitle && <FilterBadge title={title} />}
          {children}
        </div>
      )}
    </div>
  );
}
