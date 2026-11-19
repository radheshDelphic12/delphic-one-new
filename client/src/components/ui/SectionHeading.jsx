/**
 * Heading + one-line description for a page section or tab (icon chip, title, helper text, optional actions on the right).
 * `size="sm"` is the compact variant for second-level tabs.
 */
export default function SectionHeading({ icon: Icon, title, description, actions = null, size = 'md', className = '' }) {
  const small = size === 'sm';
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className={`flex shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100 ${small ? 'h-8 w-8' : 'h-10 w-10'}`}>
            <Icon className={small ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className={`font-heading font-semibold text-tertiary-900 ${small ? 'text-sm' : 'text-lg'}`}>{title}</h2>
          {description && <p className={`text-tertiary-500 ${small ? 'text-xs' : 'text-sm'}`}>{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
