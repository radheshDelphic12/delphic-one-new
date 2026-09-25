/**
 * Circular icon button for header/toolbar actions.
 */
export default function IconButton({ icon: Icon, label, onClick, active = false, className = '' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
        active
          ? 'border-primary-200 bg-primary-50 text-primary-700'
          : 'border-transparent bg-canvas-muted text-tertiary-600 hover:bg-white hover:text-tertiary-900'
      } ${className}`}
      onClick={onClick}
    >
      {Icon && <Icon className="h-4 w-4" />}
    </button>
  );
}
