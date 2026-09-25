import FilterChip from './FilterChip.jsx';
import SearchableSelect from './SearchableSelect.jsx';

const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'ytd', label: 'YTD' },
  { key: 'custom', label: 'Custom' },
];

/**
 * Filter bar for date presets, individual, and department pickers.
 */
export default function FilterBar({
  datePreset = 'this_month',
  onDatePresetChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  showDatePresets = true,
  individuals = [],
  individualId = '',
  onIndividualChange,
  departments = [],
  departmentId = '',
  onDepartmentChange,
  showIndividual = false,
  showDepartment = false,
  variant = 'card',
  children,
}) {
  const chips = [];
  if (individualId) {
    const person = individuals.find((i) => i.id === individualId);
    if (person) chips.push({ key: 'individual', label: person.name, clear: () => onIndividualChange?.('') });
  }
  if (departmentId) {
    const dept = departments.find((d) => d.id === departmentId);
    if (dept) chips.push({ key: 'department', label: dept.name, clear: () => onDepartmentChange?.('') });
  }

  const isInline = variant === 'inline';

  const filters = (
    <>
      {showDatePresets && (
        <div className={`flex flex-wrap items-center gap-2 ${isInline ? 'flex-1' : ''}`}>
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                datePreset === preset.key
                  ? 'border-[#105AA9] bg-[#105AA9] text-white shadow-sm'
                  : 'border-tertiary-100 bg-canvas-muted text-tertiary-600 hover:border-tertiary-200 hover:bg-tertiary-50'
              }`}
              onClick={() => onDatePresetChange?.(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {(showIndividual || showDepartment || children) && (
        <div className="flex flex-wrap items-center gap-3">
          {showIndividual && (
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by individual"
              value={individualId}
              onChange={(v) => onIndividualChange?.(v)}
              placeholder="All people"
              searchPlaceholder="Search people…"
              options={individuals.map((person) => ({ value: person.id, label: person.name }))}
            />
          )}
          {showDepartment && (
            <SearchableSelect
              className="w-52"
              allowClear
              ariaLabel="Filter by department"
              value={departmentId}
              onChange={(v) => onDepartmentChange?.(v)}
              placeholder="All departments"
              searchPlaceholder="Search departments…"
              options={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
            />
          )}
          {children}
        </div>
      )}
    </>
  );

  const showCustomDates = showDatePresets && datePreset === 'custom' && onDateFromChange && onDateToChange;
  const dateInputClass = 'min-w-[10.5rem] rounded-lg border border-tertiary-200 bg-white px-2 py-1.5 text-sm text-tertiary-800';

  if (isInline) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {filters}
        </div>
        {showCustomDates && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-tertiary-500">
              From
              <input
                type="date"
                className={dateInputClass}
                value={dateFrom || ''}
                max={dateTo || undefined}
                onChange={(e) => onDateFromChange(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-tertiary-500">
              To
              <input
                type="date"
                className={dateInputClass}
                value={dateTo || ''}
                min={dateFrom || undefined}
                onChange={(e) => onDateToChange(e.target.value)}
              />
            </label>
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onRemove={chip.clear} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-tertiary-200 bg-white p-4 shadow-card">
      {filters}

      {showCustomDates && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-tertiary-500">
            From
            <input
              type="date"
              className={dateInputClass}
              value={dateFrom || ''}
              max={dateTo || undefined}
              onChange={(e) => onDateFromChange(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-tertiary-500">
            To
            <input
              type="date"
              className={dateInputClass}
              value={dateTo || ''}
              min={dateFrom || undefined}
              onChange={(e) => onDateToChange(e.target.value)}
            />
          </label>
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <FilterChip key={chip.key} label={chip.label} onRemove={chip.clear} />
          ))}
        </div>
      )}
    </div>
  );
}

export { DATE_PRESETS };
