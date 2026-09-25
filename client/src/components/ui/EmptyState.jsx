/**
 * Empty-state placeholder for lists and panels.
 */
export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-white px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-tertiary-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
