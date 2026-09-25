/**
 * Shared helpers for RHS row-peek drawers.
 */

export function PeekField({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-tertiary-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-tertiary-900">{children ?? '—'}</dd>
    </div>
  );
}

export function PeekActions({ children }) {
  return <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">{children}</div>;
}
