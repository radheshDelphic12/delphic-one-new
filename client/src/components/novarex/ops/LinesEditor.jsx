import { Plus, Trash2 } from 'lucide-react';

const cell = 'w-full rounded-lg border px-2 py-1.5 text-sm';

/**
 * Editable table of document lines (purchase order, receipt, order, transfer ...). `fields` = [{ key, label, type: 'select' | 'num' | 'text' | 'date',
 * options | optionsFor(line), width, step, onPick(line, value) -> patch }]. The caller owns the array.
 */
export default function LinesEditor({ value, onChange, fields, blank = {}, addLabel = 'Add line', readOnly = false, totals }) {
  const setLine = (i, patch) => onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-tertiary-50 text-left text-xs text-tertiary-500">
            <tr>{fields.map((f) => <th key={f.key} className="px-2 py-1.5 font-medium" style={f.width ? { width: f.width } : undefined}>{f.label}</th>)}{!readOnly && <th className="w-8" />}</tr>
          </thead>
          <tbody>
            {value.length === 0 && <tr><td colSpan={fields.length + 1} className="px-3 py-3 text-center text-xs text-tertiary-500">No lines yet.</td></tr>}
            {value.map((l, i) => (
              <tr key={i} className="border-t">
                {fields.map((f) => {
                  const opts = f.optionsFor ? f.optionsFor(l) : f.options;
                  const change = (val) => setLine(i, { [f.key]: val, ...(f.onPick ? f.onPick(l, val) : {}) });
                  return (
                    <td key={f.key} className="px-1.5 py-1">
                      {readOnly ? <span className="px-1">{f.type === 'select' ? (opts || []).find((o) => o.value === l[f.key])?.label || '-' : l[f.key] ?? '-'}</span>
                        : f.type === 'select' ? (
                          <select className={cell} value={l[f.key] ?? ''} onChange={(e) => change(e.target.value)} aria-label={f.label}>
                            <option value="">Select...</option>
                            {(opts || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input className={cell} type={f.type === 'num' ? 'number' : f.type === 'date' ? 'date' : 'text'} step={f.type === 'num' ? f.step || 'any' : undefined} min={f.type === 'num' ? '0' : undefined} value={l[f.key] ?? ''} onChange={(e) => change(e.target.value)} aria-label={f.label} />
                        )}
                    </td>
                  );
                })}
                {!readOnly && <td className="px-1"><button type="button" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" title="Remove line" onClick={() => onChange(value.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2">
        {!readOnly ? <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => onChange([...value, { ...blank }])}><Plus className="h-4 w-4" />{addLabel}</button> : <span />}
        {totals && <span className="text-sm font-medium text-tertiary-800">{totals}</span>}
      </div>
    </div>
  );
}
