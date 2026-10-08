import { useRef, useState } from 'react';

const PANEL_WIDTH = 320;

function formatDay(ymd) {
  return ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString() : null;
}

/**
 * A count that lists its projects on hover / keyboard focus: name, code,
 * client, agreement end date and the people on it. The panel is
 * position:fixed so the table's scroll container can't clip it.
 */
export default function ProjectsHover({ projects, title, children }) {
  const [pos, setPos] = useState(null);
  const timer = useRef(null);
  const anchor = useRef(null);

  if (!projects?.length) return children;

  function show() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - PANEL_WIDTH / 2), window.innerWidth - PANEL_WIDTH - 8);
      const below = r.bottom + 6;
      // Open upwards when there's no room below.
      setPos(window.innerHeight - below < 260 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: below });
    }, 150);
  }

  function hide() {
    clearTimeout(timer.current);
    setPos(null);
  }

  return (
    <span
      ref={anchor}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => e.stopPropagation()}
      className="cursor-help rounded underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      aria-label={`${title}: ${projects.map((p) => p.name).join(', ')}`}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          className="fixed z-50 block max-h-72 overflow-y-auto rounded-xl border border-tertiary-100 bg-white p-2 text-left shadow-soft"
          style={{ ...pos, width: PANEL_WIDTH }}
        >
          <span className="block px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary-500">{title}</span>
          {projects.map((p) => (
            <span key={p.id} className="block rounded-lg px-2 py-1.5 hover:bg-tertiary-50">
              <span className="block text-sm font-medium text-tertiary-900">
                {p.name}
                {p.code && <span className="ml-1.5 text-xs font-normal text-tertiary-500">{p.code}</span>}
              </span>
              <span className="block text-xs text-tertiary-600">Client: {p.client_name || '—'}</span>
              {(p.agreement_end_date || p.resources?.length > 0) && (
                <span className="block text-xs text-tertiary-500">
                  {p.agreement_end_date && `Ends ${formatDay(p.agreement_end_date)}${p.days_remaining !== null && p.days_remaining !== undefined ? ` (${p.days_remaining}d)` : ''}`}
                  {p.agreement_end_date && p.resources?.length > 0 && ' · '}
                  {p.resources?.length > 0 && p.resources.map((x) => x.name).join(', ')}
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
