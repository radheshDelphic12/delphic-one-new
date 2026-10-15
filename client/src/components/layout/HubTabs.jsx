/**
 * The tab bar of a hub page (People, Finance, Payroll ...). `modern` is the refreshed look (a rounded card with a soft
 * highlight on the open tab); without it the original underline bar is drawn, so the group superadmin keeps the old look.
 */
export default function HubTabs({ tabs, value, onSelect, modern = false }) {
  // a single tab (an employee's Finance or Payroll) needs no tab bar in the refreshed look
  if (modern && tabs.length < 2) return <div aria-hidden="true" className="h-2" />;
  return (
    <div className={modern ? 'flex flex-wrap gap-1 rounded-2xl border border-tertiary-100 bg-white p-1.5 shadow-card' : 'flex flex-wrap gap-1 border-b border-tertiary-200'} role="tablist">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          className={modern
            ? `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${value === key ? 'bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-100' : 'text-tertiary-500 hover:bg-tertiary-50 hover:text-tertiary-800'}`
            : `inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${value === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`}
          onClick={() => onSelect(key)}
        >
          {Icon && <Icon className="h-4 w-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}
