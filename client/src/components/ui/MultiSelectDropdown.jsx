import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * Searchable multiselect dropdown. Selected options appear as removable chips
 * showing every chosen label; the panel filters options by search text.
 *
 * Args:
 *   value: string[] selected option ids.
 *   onChange: called with the next id[].
 *   options: { id, label, hint? }[] choices.
 *   placeholder: trigger text when nothing is selected.
 *   searchPlaceholder: search field placeholder inside the open panel.
 *   emptyMessage: shown when options is empty.
 *   noResultsMessage: shown when search filters out every option.
 */
export default function MultiSelectDropdown({
  value = [],
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No options found.',
  noResultsMessage = 'No matches found.',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedOptions = useMemo(
    () => options.filter((option) => selectedSet.has(option.id)),
    [options, selectedSet]
  );
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle)
        || (option.hint && option.hint.toLowerCase().includes(needle))
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    searchRef.current?.focus();
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  function toggleOption(optionId) {
    if (selectedSet.has(optionId)) {
      onChange(value.filter((id) => id !== optionId));
      return;
    }
    onChange([...value, optionId]);
  }

  function removeOption(optionId, event) {
    event?.stopPropagation();
    onChange(value.filter((id) => id !== optionId));
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full min-h-[42px] items-start justify-between gap-2 rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-left text-sm"
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selectedOptions.length === 0 ? (
            <span className="text-tertiary-400">{placeholder}</span>
          ) : (
            selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-50 py-0.5 pl-2 pr-1 text-xs text-primary-700"
              >
                <span className="truncate">{option.label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => removeOption(option.id, event)}
                  className="rounded-full p-0.5 text-primary-500 hover:bg-primary-100 hover:text-primary-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-tertiary-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-tertiary-200 bg-white shadow-drawer">
          <div className="border-b border-tertiary-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tertiary-400" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-tertiary-200 py-1.5 pl-8 pr-2 text-sm text-tertiary-900"
              />
            </div>
          </div>

          <div role="listbox" aria-multiselectable="true" className="max-h-48 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-tertiary-400">{emptyMessage}</p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-tertiary-400">{noResultsMessage}</p>
            ) : (
              filteredOptions.map((option) => (
                <label
                  key={option.id}
                  role="option"
                  aria-selected={selectedSet.has(option.id)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-tertiary-700 hover:bg-primary-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option.id)}
                    onChange={() => toggleOption(option.id)}
                    className="rounded border-tertiary-300"
                  />
                  <span className="min-w-0 flex-1">
                    {option.label}
                    {option.hint ? <span className="ml-1 text-xs text-tertiary-400">({option.hint})</span> : null}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
