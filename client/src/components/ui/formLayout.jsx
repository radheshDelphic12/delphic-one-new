/**
 * Shared form primitives so every create/edit form looks the same:
 * a titled card section, a two-column field grid, one input style.
 */

/** Canonical class for <input> / <select> / <textarea> inside a form field. */
export const FIELD_INPUT =
  'w-full rounded-md border border-tertiary-200 bg-white px-3 py-2 text-sm text-tertiary-900 ' +
  'transition-colors placeholder:text-tertiary-400 focus:border-primary-300 focus:outline-none ' +
  'focus:ring-2 focus:ring-primary-100 disabled:bg-tertiary-50 disabled:text-tertiary-500';

/** A titled card. Fields go in a 2-column grid unless `grid={false}`. */
export function FormSection({ title, description, children, grid = true }) {
  return (
    <section className="overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-soft">
      {title && (
        <header className="border-b border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5">
          <h3 className="font-heading text-sm font-semibold text-tertiary-800">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-tertiary-500">{description}</p>}
        </header>
      )}
      <div className={grid ? 'grid gap-4 p-4 sm:grid-cols-2' : 'space-y-4 p-4'}>{children}</div>
    </section>
  );
}

/** Label + control + optional hint / error. `full` spans both columns. */
export function FormField({ label, required = false, hint, error, full = false, children }) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      {label && (
        <label className="mb-1 block text-xs font-medium text-tertiary-600">
          {label}
          {required && <span className="text-danger-500"> *</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-xs text-tertiary-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  );
}
