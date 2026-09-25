import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';

/**
 * Compact card actions menu (⋯). Use for stage moves and navigation links.
 *
 * Args:
 *   items: [{ key, label, onClick?, to?, href?, danger?, disabled? }]
 *          - `to`   renders a React-Router <Link> (cmd/ctrl/middle-click = new tab)
 *          - `href` renders a plain <a>
 *          - otherwise a <button onClick>
 *   label: Accessible label for the trigger (default "Actions").
 */
export default function CardActionsMenu({ items = [], label = 'Actions' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();
  const usable = (items || []).filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (usable.length === 0) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="rounded-md p-1 text-tertiary-400 transition-colors hover:bg-tertiary-50 hover:text-tertiary-700"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-tertiary-200 bg-white py-1 shadow-lg"
        >
          {usable.map((item) => {
            const cls = `block w-full px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
              item.danger ? 'text-danger-700 hover:bg-danger-50' : 'text-tertiary-700 hover:bg-tertiary-50'
            }`;
            const stop = (event) => event.stopPropagation();
            const onActivate = (event) => {
              event.stopPropagation();
              setOpen(false);
              item.onClick?.();
            };
            return (
              <li key={item.key} role="none">
                {item.to && !item.disabled ? (
                  <Link to={item.to} role="menuitem" className={cls} onClick={onActivate} onPointerDown={stop}>
                    {item.label}
                  </Link>
                ) : item.href && !item.disabled ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    className={cls}
                    onClick={onActivate}
                    onPointerDown={stop}
                  >
                    {item.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    className={cls}
                    onClick={onActivate}
                    onPointerDown={stop}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
