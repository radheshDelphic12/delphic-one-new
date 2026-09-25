/**
 * Shell around a chart with title and optional subtitle/action.
 * Layout via Tailwind; theme tokens live in chartTheme.js.
 */
export default function ChartCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-tertiary-100 bg-white p-4 shadow-card ${className}`}>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm font-semibold tracking-tight text-tertiary-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-tertiary-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
