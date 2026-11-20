import { useState } from 'react';
import { Filter, ChevronDown } from 'lucide-react';

/**
 * The "Filters" label of a list toolbar. On a desktop it is just a label. On a phone it is a button that opens and closes the
 * filter controls of its toolbar (the toolbar element carries data-filter-root; global.css hides the controls while it is closed,
 * keeping this pill and the search box (data-filter-keep) visible).
 */
export default function FilterPill() {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      data-filter-keep
      aria-expanded={open}
      onClick={(e) => {
        const root = e.currentTarget.closest('[data-filter-root]');
        if (!root) return;
        const next = !open;
        if (next) root.setAttribute('data-filters-open', ''); else root.removeAttribute('data-filters-open');
        setOpen(next);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-tertiary-100 bg-canvas-muted px-3 py-1.5 text-xs font-medium text-tertiary-700 md:pointer-events-none md:cursor-default"
    >
      <Filter className="h-3.5 w-3.5" />
      Filters
      <ChevronDown className={`h-3.5 w-3.5 transition-transform md:hidden ${open ? 'rotate-180' : ''}`} aria-hidden />
    </button>
  );
}
