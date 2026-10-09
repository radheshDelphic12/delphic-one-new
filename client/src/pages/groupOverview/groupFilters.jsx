import { useEffect, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, Lock, LockOpen, SlidersHorizontal, X } from 'lucide-react';

// Filter pieces shared by every Group Dashboard tab, so a period means the same thing everywhere.

export const monthStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Indian financial year (April - March), the convention the rest of the app uses.
export function presetRange(key, pickedMonth) {
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyYear, 3, 1);
  switch (key) {
    case 'this_month': return { from: monthStr(cur), to: monthStr(cur) };
    case 'prev_month': return { from: monthStr(addMonths(cur, -1)), to: monthStr(addMonths(cur, -1)) };
    case 'month': return pickedMonth ? { from: pickedMonth, to: pickedMonth } : null;
    case 'quarter': { const q = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); return { from: monthStr(q), to: monthStr(cur) }; }
    case 'prev_quarter': { const q = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1); return { from: monthStr(q), to: monthStr(addMonths(q, 2)) }; }
    case 'fy': return { from: monthStr(fyStart), to: monthStr(cur) };
    case 'prev_fy': return { from: monthStr(new Date(fyYear - 1, 3, 1)), to: monthStr(new Date(fyYear, 2, 1)) };
    case 'last_12': return { from: monthStr(addMonths(cur, -11)), to: monthStr(cur) };
    default: return null;
  }
}

// [value, label, group] - the group only shapes the dropdown menu.
export const PRESETS = [
  ['this_month', 'This month', 'Months'], ['prev_month', 'Last month', 'Months'], ['month', 'Pick a month', 'Months'],
  ['quarter', 'This quarter', 'Quarters'], ['prev_quarter', 'Last quarter', 'Quarters'],
  ['fy', 'Financial year', 'Years'], ['prev_fy', 'Last financial year', 'Years'], ['last_12', 'Last 12 months', 'Years'],
  ['custom', 'Custom start and end month', 'Custom'],
];
export const GROUPINGS = [['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']];
export const FIGURES = [['all', 'All (live)'], ['locked', 'Locked'], ['unlocked', 'Unlocked']];

// A row of pills: one choice at a time, the chosen one filled.
export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary-400">{label}</div>
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-tertiary-50 p-1" role="group" aria-label={label}>
        {options.map(([k, text]) => (
          <button
            key={k}
            type="button"
            aria-pressed={value === k}
            onClick={() => onChange(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === k ? 'bg-white text-primary-700 shadow-soft ring-1 ring-primary-200' : 'text-tertiary-600 hover:bg-white/70'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Period state for a tab: a preset, a single picked month, or a custom start / end month.
 * `range` is { from, to } as YYYY-MM, `valid` is false until both ends are set and in order.
 */
export function usePeriod(initialPreset = 'last_12') {
  const [preset, setPreset] = useState(initialPreset);
  const [custom, setCustom] = useState(presetRange('last_12'));
  const [picked, setPicked] = useState(monthStr(new Date()));
  const range = preset === 'custom' ? custom : presetRange(preset, picked);
  const valid = Boolean(range?.from && range?.to && range.to >= range.from);
  return { preset, setPreset, custom, setCustom, picked, setPicked, range, valid, initialPreset, isDefault: preset === initialPreset && custom.from === presetRange('last_12').from && custom.to === presetRange('last_12').to && picked === monthStr(new Date()), reset: () => { setPreset(initialPreset); setCustom(presetRange('last_12')); setPicked(monthStr(new Date())); } };
}

/** The Period pills plus the month inputs the chosen pill needs. */
export function PeriodFilters({ period, label = 'Period', presets = PRESETS }) {
  const { preset, setPreset, custom, setCustom, picked, setPicked } = period;
  const inputCls = 'mt-1 block rounded-lg border px-2 py-1.5 text-sm';
  return (
    <>
      <Segmented label={label} value={preset} options={presets} onChange={setPreset} />
      {preset === 'month' && (
        <label className="text-xs font-medium text-tertiary-600">Month
          <input type="month" value={picked} onChange={(e) => e.target.value && setPicked(e.target.value)} className={inputCls} />
        </label>
      )}
      {preset === 'custom' && (
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-tertiary-600">Start month
            <input type="month" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={inputCls} />
          </label>
          <label className="text-xs font-medium text-tertiary-600">End month
            <input type="month" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={inputCls} />
          </label>
        </div>
      )}
    </>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (m) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const rangeHint = (key) => {
  if (key === 'month' || key === 'custom') return '';
  const r = presetRange(key);
  if (!r) return '';
  return r.from === r.to ? monthText(r.from) : `${monthText(r.from)} - ${monthText(r.to)}`;
};
const fieldCls = 'mt-1 w-full rounded-xl border border-tertiary-200 bg-white px-3 py-2 text-sm text-tertiary-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const labelOf = (options, value) => (options || []).find(([k]) => String(k) === String(value))?.[1] ?? value;

/**
 * A custom dropdown (instead of the browser's plain <select>): a rounded trigger, a menu with the choices grouped under
 * small headings, the current one ticked, an optional hint on the right, and keyboard support (arrows, Enter, Escape).
 * options: [value, label, group?]; `hintOf(value)` returns the small right-hand text.
 */
export function ChoiceMenu({ label, value, options, onChange, hintOf }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef(null);
  const current = options.find(([k]) => String(k) === String(value));
  const flat = options;

  useEffect(() => {
    if (!open) return undefined;
    setHi(Math.max(0, flat.findIndex(([k]) => String(k) === String(value))));
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    // Capture phase: Escape closes only this menu, not the Filters panel around it.
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (k) => { onChange(k); setOpen(false); };
  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHi((i) => (e.key === 'ArrowDown' ? Math.min(flat.length - 1, i + 1) : Math.max(0, i - 1)));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(flat[hi][0]);
    }
  };

  // Keep the options in their order, with a heading wherever the group changes.
  const headings = flat.map(([, , g], i) => (g && g !== flat[i - 1]?.[2] ? g : null));
  return (
    <div className="relative" ref={wrap}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current ? current[1] : ''}`} onClick={() => setOpen((o) => !o)} onKeyDown={onTriggerKey}
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm font-medium text-tertiary-900 shadow-sm transition hover:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 ${open ? 'border-primary-500 ring-2 ring-primary-100' : 'border-tertiary-200'}`}>
        <span className="truncate">{current ? current[1] : 'Select'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-tertiary-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute left-0 right-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-tertiary-100 bg-white p-1.5 shadow-xl ring-1 ring-black/5">
          {flat.map(([k, text], i) => {
            const heading = headings[i];
            const on = String(k) === String(value);
            const hint = hintOf ? hintOf(k) : '';
            return (
              <li key={k} role="presentation">
                {heading && <div className={`px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary-400 ${i === 0 ? 'pt-1' : 'pt-2.5'}`}>{heading}</div>}
                <button type="button" role="option" aria-selected={on} onMouseEnter={() => setHi(i)} onClick={() => choose(k)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${on ? 'bg-primary-50 font-semibold text-primary-800' : 'text-tertiary-800'} ${hi === i && !on ? 'bg-tertiary-50' : ''}`}>
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />}</span>
                  <span className="min-w-0 flex-1 truncate">{text}</span>
                  {hint && <span className="shrink-0 text-[11px] font-normal text-tertiary-400">{hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const FIGURE_LOOK = {
  all: { icon: Activity, hint: 'Closed and open months together, from live figures.' },
  locked: { icon: Lock, hint: 'Only months that are closed (final figures).' },
  unlocked: { icon: LockOpen, hint: 'Live figures of months that are not closed yet.' },
};

/** Which figures to read - shown under the filters, not inside them: All (live), Locked or Unlocked. */
export function FigureSwitch({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-tertiary-100 pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-400">Figures</span>
      <div className="inline-flex rounded-xl border border-tertiary-200 bg-tertiary-50/70 p-1" role="group" aria-label="Figures">
        {FIGURES.map(([k, text]) => {
          const Icon = FIGURE_LOOK[k].icon;
          const on = value === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => onChange(k)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${on ? 'bg-primary-600 text-white shadow-sm' : 'text-tertiary-600 hover:bg-white hover:text-tertiary-900'}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{text}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-tertiary-500">{FIGURE_LOOK[value]?.hint}</span>
    </div>
  );
}

/**
 * Fields for the period, bound to usePeriod(): a Period dropdown, plus the month input(s) the chosen option needs.
 * Spread into GroupFilterBar: { fields, values, defaults, change }.
 */
export function periodBinding(period, label = 'Period') {
  const { preset, setPreset, custom, setCustom, picked, setPicked } = period;
  const def = presetRange('last_12');
  return {
    fields: [
      { key: 'period', label, type: 'select', options: PRESETS, full: true, hintOf: rangeHint },
      { key: 'month', label: 'Month', type: 'month', hidden: preset !== 'month' },
      { key: 'from', label: 'Start month', type: 'month', hidden: preset !== 'custom' },
      { key: 'to', label: 'End month', type: 'month', hidden: preset !== 'custom' },
    ],
    values: { period: preset, month: picked, from: custom.from, to: custom.to },
    defaults: { period: period.initialPreset, month: monthStr(new Date()), from: def.from, to: def.to },
    change: (key, value) => {
      if (key === 'period') setPreset(value);
      else if (key === 'month') value && setPicked(value);
      else if (key === 'from') setCustom((c) => ({ ...c, from: value }));
      else if (key === 'to') setCustom((c) => ({ ...c, to: value }));
    },
  };
}

/**
 * One calm toolbar for the Group Dashboard tabs (same pattern as the Zephyr list filters): a single "Filters" button that
 * opens a panel of dropdowns, and small removable chips for whatever is switched on. `children` sit on the right
 * (live indicator, refresh, ...); `below` goes under the toolbar (the Figures switch).
 *
 * fields: [{ key, label, type: 'select' | 'month' | 'checks', options, hidden, full, hintOf }]
 *   select: options are [value, label, group?]; checks: options are [id, label] and values[key] is the selected ids
 *   (empty = all, which is the default); month: a YYYY-MM input.
 * A field is "on" when its value differs from defaults[key]. onToggle(key, id) is called for 'checks'.
 */
export function GroupFilterBar({ fields, values, defaults = {}, onChange, onToggle, onReset, below, children }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const list = fields.filter((f) => !f.hidden);
  const isOn = (f) => (f.type === 'checks' ? (values[f.key] || []).length > 0 : String(values[f.key] ?? '') !== String(defaults[f.key] ?? ''));
  const active = list.filter(isOn);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const chipText = (f) => {
    if (f.type === 'checks') return (values[f.key] || []).map((id) => labelOf(f.options, id)).join(', ');
    if (f.type === 'select') return labelOf(f.options, values[f.key]);
    return values[f.key];
  };
  const clearOne = (f) => onChange(f.key, f.type === 'checks' ? [] : defaults[f.key] ?? '');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative" ref={wrap}>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2 text-sm font-semibold shadow-sm transition hover:border-primary-300 ${active.length ? 'border-primary-500 text-primary-800' : 'border-tertiary-200 text-tertiary-700'}`}>
            <SlidersHorizontal className="h-4 w-4" />Filters
            {active.length > 0 && <span className="rounded-full bg-primary-600 px-1.5 text-xs font-semibold leading-5 text-white">{active.length}</span>}
          </button>
          {open && (
            <div role="dialog" aria-label="Filters" className="absolute left-0 z-30 mt-2 w-[min(92vw,30rem)] rounded-2xl border border-tertiary-100 bg-white shadow-2xl ring-1 ring-black/5">
              <div className="flex items-center justify-between border-b border-tertiary-100 px-4 py-3">
                <div>
                  <h3 className="font-heading text-sm font-semibold text-tertiary-900">Filters</h3>
                  <p className="text-xs text-tertiary-500">Results update as soon as you change a choice.</p>
                </div>
                <button type="button" aria-label="Close filters" className="rounded-lg p-1.5 text-tertiary-400 hover:bg-tertiary-50 hover:text-tertiary-700" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                {list.map((f) => (
                  <div key={f.key} className={`block text-xs font-semibold text-tertiary-600 ${f.full || f.type === 'checks' ? 'sm:col-span-2' : ''}`}>
                    {f.type === 'checks' ? (
                      <fieldset>
                        <legend>{f.label}</legend>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {f.options.map(([id, text]) => {
                            const sel = values[f.key] || [];
                            const on = sel.length === 0 || sel.includes(id);
                            return (
                              <label key={id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${on ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-tertiary-200 text-tertiary-500 hover:bg-tertiary-50'}`}>
                                <input type="checkbox" className="accent-primary-600" checked={on} onChange={() => onToggle(f.key, id)} />{text}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ) : f.type === 'select' ? (
                      <div>
                        <span>{f.label}</span>
                        <ChoiceMenu label={f.label} value={values[f.key] ?? ''} options={f.options} onChange={(v) => onChange(f.key, v)} hintOf={f.hintOf} />
                      </div>
                    ) : (
                      <label className="block">
                        {f.label}
                        <input className={fieldCls} type="month" value={values[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)} />
                      </label>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-tertiary-100 bg-tertiary-50/50 px-4 py-3">
                <button type="button" className="text-sm font-medium text-tertiary-500 hover:text-primary-700 disabled:opacity-40" onClick={() => { onReset(); setOpen(false); }} disabled={!active.length}>Clear all</button>
                <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
        {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {active.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-1 pl-3 pr-1.5 text-xs text-primary-800 ring-1 ring-primary-100">
              <span className="text-primary-600">{f.label}:</span> <span className="font-semibold">{chipText(f)}</span>
              <button type="button" aria-label={`Remove ${f.label} filter`} className="rounded-full p-0.5 hover:bg-primary-100" onClick={() => clearOne(f)}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <button type="button" className="text-xs font-medium text-tertiary-500 hover:text-primary-700" onClick={onReset}>Clear all</button>
        </div>
      )}
      {below}
    </div>
  );
}
