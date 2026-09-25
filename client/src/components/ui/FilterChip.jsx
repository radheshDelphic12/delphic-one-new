import { X } from 'lucide-react';

/**
 * Removable filter chip showing an active filter value.
 */
export default function FilterChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
      {label}
      {onRemove && (
        <button
          type="button"
          className="rounded-full p-0.5 transition-colors hover:bg-primary-100"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
