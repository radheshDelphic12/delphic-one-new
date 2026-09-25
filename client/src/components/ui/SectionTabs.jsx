/** Underlined tab strip used by every hub page. */
export default function SectionTabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`flex flex-wrap gap-1 border-b border-tertiary-200 ${className}`} role="tablist">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
            value === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500 hover:text-tertiary-700'
          }`}
        >
          {Icon && <Icon className="h-4 w-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}
