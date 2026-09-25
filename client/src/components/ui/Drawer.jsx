import { createContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

/** Cap panel width so forms never feel page-wide. */
const SIZE_CLASS = {
  sm: 'w-[min(100vw,22rem)]',
  md: 'w-[min(100vw,26rem)]',
  lg: 'w-[min(100vw,30rem)]',
  // Two-column forms — wide enough to halve the vertical scroll.
  xl: 'w-[min(100vw,46rem)]',
};

const TONE_HEADER = {
  default: 'border-b bg-white',
  create: 'border-b border-primary-100 bg-primary-50',
  edit: 'border-b border-amber-100 bg-amber-50',
  danger: 'border-b border-danger-100 bg-danger-50',
  info: 'border-b border-sky-100 bg-sky-50',
};

const TONE_ACCENT = {
  default: 'border-l-tertiary-200',
  create: 'border-l-primary-600',
  edit: 'border-l-amber-500',
  danger: 'border-l-danger-600',
  info: 'border-l-sky-500',
};

/**
 * The header's action slot: `FormActionsBar` portals its buttons here so the
 * primary CTA sits next to the close (✕) instead of in a separate row. `null`
 * when no Drawer is mounting the consumer (falls back to inline rendering).
 */
export const DrawerActionsContext = createContext(null);

/**
 * Right-hand slide-over panel — fixed narrow column, scrollable body.
 *
 * Args:
 *   open: Whether visible.
 *   title: Header title.
 *   onClose: Backdrop / Esc / ✕ — also the "cancel" action for forms inside.
 *   children: Scrollable body.
 *   footer: Optional sticky footer actions.
 *   size: sm | md | lg | xl (never full-page).
 *   tone: default | create | edit | danger | info — header/accent color.
 */
export default function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  tone = 'default',
}) {
  const panelRef = useRef(null);
  const [actionsSlot, setActionsSlot] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const widthClass = SIZE_CLASS[size] || SIZE_CLASS.md;
  const headerClass = TONE_HEADER[tone] || TONE_HEADER.default;
  const accentClass = TONE_ACCENT[tone] || TONE_ACCENT.default;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.button
            type="button"
            aria-label="Close panel"
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={`relative z-10 flex h-full max-h-screen flex-col border-l-4 bg-white shadow-drawer ${widthClass} ${accentClass}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={`flex shrink-0 items-center gap-3 px-4 py-3 ${headerClass}`}>
              <h2 className="min-w-0 flex-1 truncate font-heading text-base font-semibold text-tertiary-900">
                {title}
              </h2>
              <div ref={setActionsSlot} className="flex shrink-0 items-center gap-2 empty:hidden" />
              <button
                type="button"
                className="shrink-0 rounded-xl p-1.5 text-tertiary-400 transition-colors hover:bg-white/80 hover:text-tertiary-700"
                aria-label="Cancel and close"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-sm text-tertiary-700">
              <DrawerActionsContext.Provider value={actionsSlot}>{children}</DrawerActionsContext.Provider>
            </div>
            {footer && (
              <div className="flex shrink-0 justify-end gap-2 border-t bg-tertiary-50 px-4 py-3">{footer}</div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
