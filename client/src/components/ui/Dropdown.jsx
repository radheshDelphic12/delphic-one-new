import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

/**
 * Lightweight dropdown menu with optional trigger label/icon.
 */
export default function Dropdown({ label, icon: Icon, children, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function onDocClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const alignClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {Icon && <Icon className="h-4 w-4" />}
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className={`absolute ${alignClass} z-30 mt-1 min-w-[10rem] rounded-xl border bg-white py-1 shadow-soft`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DropdownItem({ children, onClick, danger = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-tertiary-50 ${
        danger ? 'text-danger-600' : 'text-tertiary-700'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
