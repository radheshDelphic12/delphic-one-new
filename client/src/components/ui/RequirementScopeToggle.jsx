const OPTIONS = [
  { key: 'mine', label: 'My requirements' },
  { key: 'all', label: 'All requirements' },
];

/** Pill toggle for sales users: their own requirements, or everyone's (others' stay read-only). */
export default function RequirementScopeToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-full border border-tertiary-200 bg-white p-0.5" role="group" aria-label="My requirements or all requirements">
      {OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${value === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
