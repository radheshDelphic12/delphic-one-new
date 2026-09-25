import { X } from 'lucide-react';

/**
 * Centered overlay dialog. Layout via Tailwind; colors/hover via tokens.
 */
export default function Modal({ open, title, onClose, children, footer, wide = false }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close dialog" onClick={onClose} />
      <div
        className={`relative z-10 w-full rounded-2xl border bg-white shadow-soft ${wide ? 'max-w-xl' : 'max-w-md'}`}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h2>
          <button
            type="button"
            className="rounded-xl p-1.5 text-tertiary-400 transition-colors hover:bg-tertiary-100 hover:text-tertiary-700"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-sm">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
