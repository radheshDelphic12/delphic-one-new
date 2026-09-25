import { useRef, useState } from 'react';

const SIDE_CLASS = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
};

const OPEN_DELAY_MS = 300;

/**
 * Hover/focus tooltip. Wraps children, shows a small label after a short
 * delay so it doesn't flicker on quick mouse passes.
 *
 * Args:
 *   label: Tooltip text. When falsy, renders children unwrapped (no-op).
 *   side: top | bottom | left | right — placement relative to children.
 *   block: render the wrapper as a full-width block instead of inline-flex,
 *     for wrapping a card/grid item that must stretch to fill its cell.
 */
export default function Tooltip({ label, children, side = 'top', block = false }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  if (!label) return children;

  function show() {
    timerRef.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function hide() {
    clearTimeout(timerRef.current);
    setOpen(false);
  }

  return (
    <span
      className={block ? 'relative block h-full w-full' : 'relative inline-flex'}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-tertiary-900 px-2 py-1 text-xs font-medium text-white shadow-soft ${SIDE_CLASS[side] || SIDE_CLASS.top}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
