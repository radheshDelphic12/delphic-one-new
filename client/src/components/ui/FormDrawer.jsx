import { useEffect, useId, useState } from 'react';
import Drawer from './Drawer.jsx';
import SearchableSelect from './SearchableSelect.jsx';

const INPUT = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';

function blank(fields, initial) {
  const out = {};
  for (const f of fields) out[f.name] = initial?.[f.name] ?? f.default ?? (f.type === 'checkbox' ? false : '');
  return out;
}

/**
 * Field-driven create/edit drawer.
 *
 * fields: [{ name, label, type: text|number|date|email|url|textarea|select|search|checkbox,
 *            options?: [{value,label,hint?}], required?, hint?, default?, step?, min?,
 *            show?: (values) => boolean, half?: boolean }]
 *
 * onSubmit receives cleaned values: empty strings are dropped, numbers are numbers.
 * Throw from onSubmit to keep the drawer open (the caller shows the error).
 */
export default function FormDrawer({ open, title, fields, initial, submitLabel = 'Save', onClose, onSubmit, size = 'md', tone = 'create', intro }) {
  const formId = useId();
  const [values, setValues] = useState(() => blank(fields, initial));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValues(blank(fields, initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the drawer opens
  }, [open]);

  function set(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    const cleaned = {};
    for (const f of fields) {
      if (f.show && !f.show(values)) continue;
      const raw = values[f.name];
      if (f.type === 'checkbox') cleaned[f.name] = Boolean(raw);
      else if (raw === '' || raw === undefined || raw === null) continue;
      else cleaned[f.name] = f.type === 'number' ? Number(raw) : raw;
    }
    setSaving(true);
    try {
      await onSubmit(cleaned);
      onClose();
    } catch {
      // Caller surfaces the error; keep the drawer open so nothing is lost.
    } finally {
      setSaving(false);
    }
  }

  const visible = fields.filter((f) => !f.show || f.show(values));

  return (
    <Drawer
      open={open}
      title={title}
      onClose={onClose}
      size={size}
      tone={tone}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form={formId} className="btn-primary" disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className={size === 'xl' ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
        {intro && <p className={`text-xs text-tertiary-500 ${size === 'xl' ? 'col-span-2' : ''}`}>{intro}</p>}
        {visible.map((f) => (
          <div key={f.name} className={size === 'xl' && !f.half && (f.type === 'textarea' || f.full) ? 'col-span-2' : ''}>
            {f.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm text-tertiary-700">
                <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
                {f.label}
              </label>
            ) : (
              <label className="block text-xs font-medium text-tertiary-600">
                {f.label}
                {f.hint && <span className="ml-1 font-normal text-tertiary-400">({f.hint})</span>}
                {f.type === 'select' && (
                  <select required={f.required} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} className={INPUT}>
                    {!f.required && <option value="">-</option>}
                    {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {f.type === 'search' && (
                  <div className="mt-1">
                    <SearchableSelect value={values[f.name]} onChange={(v) => set(f.name, v)} options={f.options || []} placeholder={f.placeholder || 'Select'} allowClear={!f.required} required={f.required} />
                  </div>
                )}
                {f.type === 'textarea' && (
                  <textarea required={f.required} rows={3} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} className={INPUT} />
                )}
                {!['select', 'search', 'textarea'].includes(f.type) && (
                  <input
                    required={f.required}
                    type={f.type || 'text'}
                    step={f.type === 'number' ? f.step || 'any' : undefined}
                    min={f.min}
                    value={values[f.name]}
                    onChange={(e) => set(f.name, e.target.value)}
                    className={INPUT}
                  />
                )}
              </label>
            )}
          </div>
        ))}
      </form>
    </Drawer>
  );
}
