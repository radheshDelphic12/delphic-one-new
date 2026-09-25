import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * Single-select searchable combobox — drop-in replacement for a native <select>
 * on data-driven or long option lists.
 *
 * Args:
 *   value: currently selected option value (string).
 *   onChange: called with the next value string ('' when cleared).
 *   options: { value, label, hint?, disabled? }[] choices.
 *   placeholder: trigger text when nothing is selected.
 *   searchPlaceholder: placeholder inside the filter field.
 *   noResultsMessage: shown when the query filters everything out.
 *   disabled, required: mirror the native <select> attributes.
 *   allowClear: show an inline clear (×) when a value is selected.
 *   name, id, className, ariaLabel: passthrough.
 */
const TRIGGER_CLASS =
  'flex w-full items-center justify-between gap-2 rounded border border-tertiary-200 bg-white px-2 py-1.5 text-left text-sm text-tertiary-900 disabled:cursor-not-allowed disabled:bg-tertiary-50';

export default function SearchableSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  noResultsMessage = 'No matches',
  disabled = false,
  required = false,
  allowClear = false,
  name,
  id,
  className = '',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const reactId = useId();
  const listboxId = `${id || reactId}-listbox`;

  const selected = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        String(option.label).toLowerCase().includes(needle)
        || (option.hint && String(option.hint).toLowerCase().includes(needle))
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(-1);
      return undefined;
    }
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    searchRef.current?.focus();
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function commit(option) {
    onChange?.(option ? option.value : '');
    setOpen(false);
  }

  function onKeyDown(event) {
    if (disabled) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option && !option.disabled) commit(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={TRIGGER_CLASS}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-tertiary-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        {allowClear && selected && !disabled ? (
          <X
            className="h-3.5 w-3.5 shrink-0 text-tertiary-400 hover:text-tertiary-700"
            onClick={(event) => {
              event.stopPropagation();
              commit(null);
            }}
          />
        ) : (
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-tertiary-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {required && (
        <input
          tabIndex={-1}
          name={name}
          value={value || ''}
          required
          onChange={() => {}}
          onFocus={() => !disabled && setOpen(true)}
          // 1px + opacity:0 (not display:none) keeps native `required` validation
          // able to focus/scroll to this control on an invalid submit.
          className="pointer-events-none absolute bottom-0 left-2 h-px w-px opacity-0"
        />
      )}

      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-tertiary-200 bg-white shadow-drawer">
          <div className="border-b border-tertiary-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tertiary-400" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg border border-tertiary-200 py-1.5 pl-8 pr-2 text-sm text-tertiary-900"
              />
            </div>
          </div>
          <div ref={listRef} role="listbox" id={listboxId} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-tertiary-400">{noResultsMessage}</p>
            ) : (
              filtered.map((option, idx) => {
                const isSelected = String(option.value) === String(value);
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={`${option.value}-${idx}`}
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => commit(option)}
                    className={`block w-full px-3 py-2 text-left text-sm disabled:opacity-40 ${
                      isActive ? 'bg-primary-50' : ''
                    } ${isSelected ? 'font-medium text-primary-700' : 'text-tertiary-700'}`}
                  >
                    {option.label}
                    {option.hint ? <span className="ml-1 text-xs text-tertiary-400">{option.hint}</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
