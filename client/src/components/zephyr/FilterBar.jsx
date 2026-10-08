import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';

const fieldCls = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';

function shown(field, value) {
  if (field.type === 'select') {
    const opt = (field.options || []).find((o) => String(o.value) === String(value));
    return opt ? opt.label : value;
  }
  return value;
}

/**
 * One calm toolbar for every Zephyr list: a search box, a single "Filters" menu that holds the
 * dropdowns, and small removable chips for whatever is switched on. Page actions go in `children`.
 *
 * fields: [{ key, label, type: 'select' | 'text' | 'date' | 'number', options, any, placeholder, min, hidden }]
 *   - select: `any` is the label of the "no filter" choice (its value is defaults[key], '' if unset).
 * values / defaults: plain objects keyed by field key. A field counts as active when it differs from its default.
 */
export default function FilterBar({ q, onQ, searchPlaceholder = 'Search…', searchLabel = 'Search', fields, values, defaults = {}, onChange, onReset, children }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const list = fields.filter((f) => !f.hidden);
  const active = list.filter((f) => String(values[f.key] ?? '') !== String(defaults[f.key] ?? ''));

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const reset = () => {
    onReset();
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400" />
          <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchLabel} className="w-full rounded-xl border bg-white py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100" />
        </div>

        {list.length > 0 && (
          <div className="relative" ref={wrap}>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium transition hover:border-primary-300 ${active.length ? 'border-primary-500 text-primary-800' : 'text-tertiary-700'}`}>
              <SlidersHorizontal className="h-4 w-4" />Filters
              {active.length > 0 && <span className="rounded-full bg-primary-600 px-1.5 text-xs font-semibold leading-5 text-white">{active.length}</span>}
            </button>
            {open && (
              <div role="dialog" aria-label="Filters" className="absolute left-0 z-30 mt-2 w-[min(92vw,26rem)] rounded-2xl border bg-white p-4 shadow-card">
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((f) => (
                    <label key={f.key} className={`block text-xs font-medium text-tertiary-600 ${f.full ? 'sm:col-span-2' : ''}`}>
                      {f.label}
                      {f.type === 'select' ? (
                        <select className={fieldCls} value={values[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)}>
                          <option value={defaults[f.key] ?? ''}>{f.any || 'Any'}</option>
                          {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input className={fieldCls} type={f.type || 'text'} min={f.min} value={values[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />
                      )}
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <button type="button" className="text-sm font-medium text-tertiary-500 hover:text-primary-700 disabled:opacity-40" onClick={reset} disabled={!active.length && !q}>Clear all</button>
                  <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
        )}

        {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
      </div>

      {(active.length > 0 || q) && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-1 pl-3 pr-1.5 text-xs text-primary-800">
              <span className="text-primary-600">{f.label}:</span> <span className="font-medium">{shown(f, values[f.key])}</span>
              <button type="button" aria-label={`Remove ${f.label} filter`} className="rounded-full p-0.5 hover:bg-primary-100" onClick={() => onChange(f.key, defaults[f.key] ?? '')}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <button type="button" className="text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={onReset}>Clear all</button>
        </div>
      )}
    </div>
  );
}
