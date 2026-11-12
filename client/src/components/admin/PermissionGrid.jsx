import Pill from '../ui/Pill.jsx';

const SCOPE = [['own', 'Own'], ['team', 'Team'], ['all', 'Everyone']];
const RANK = { own: 1, team: 2, all: 3, true: 3 };
export const rankOf = (v) => RANK[v === true ? 'true' : v] || 0;

/** One permission: a checkbox, plus Own / Team / Everyone when the action has a scope. `floor` is the narrowest scope allowed (a set's own). */
function Action({ action, value, onChange, fromSet, disabled }) {
  const on = Boolean(value);
  const floor = fromSet ? rankOf(fromSet) : 0;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label className="flex items-center gap-2 text-sm text-tertiary-800">
        <input type="checkbox" disabled={disabled} checked={on} onChange={(e) => onChange(e.target.checked ? (action.scoped ? (fromSet || 'all') : true) : false)} />
        <span>{action.label}</span>
        {fromSet && on && <Pill tone="gray">from set</Pill>}
      </label>
      {action.scoped && (
        <select disabled={disabled || !on} value={on ? value : 'all'} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-tertiary-200 px-2 py-1 text-xs disabled:opacity-40" aria-label={`${action.label} scope`}>
          {SCOPE.filter(([v]) => rankOf(v) >= floor).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * The permission tick-grid, grouped by category so it stays readable.
 *
 * Props:
 *   categories: from GET /access/catalog.
 *   value: key -> true | own | team | all (what is ticked).
 *   onChange(key, next): next is false, true or a scope.
 *   fromSet: key -> the value the person's permission set already gives (shown as "from set").
 */
export default function PermissionGrid({ categories, value, onChange, fromSet = {}, disabled = false }) {
  return (
    <div className="space-y-3">
      {categories.map((c) => (
        <details key={c.key} open className="rounded-xl border border-tertiary-100">
          <summary className="cursor-pointer select-none rounded-xl bg-tertiary-50 px-3 py-2 text-sm font-semibold text-tertiary-800">
            {c.label}
            {c.key === 'administration' && <span className="ml-2 text-xs font-normal text-tertiary-500">Super Admin and Admin only unless granted here</span>}
          </summary>
          <div className="grid gap-3 p-3 md:grid-cols-2">
            {c.modules.map((m) => (
              <fieldset key={m.module} className="rounded-xl border border-tertiary-100 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-tertiary-500">{m.label}</legend>
                {m.actions.map((a) => <Action key={a.key} action={a} value={value[a.key]} fromSet={fromSet[a.key]} disabled={disabled} onChange={(next) => onChange(a.key, next)} />)}
              </fieldset>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
