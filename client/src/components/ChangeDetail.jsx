import { ACTION_LABEL, entityLabel, whenLabel } from './changeLogUi.js';

const show = (v) => {
  if (v === null || v === undefined || v === '') return <span className="text-tertiary-400">empty</span>;
  if (typeof v === 'object') return <code className="break-all text-xs">{JSON.stringify(v)}</code>;
  return String(v);
};

/** One log entry: who, when, and the old / new values field by field. */
export default function ChangeDetail({ row }) {
  const fields = [...new Set([...Object.keys(row.old_values || {}), ...Object.keys(row.new_values || {})])].filter((k) => k !== 'where' && k !== 'rows' && k !== 'data' && k !== 'count');
  const bulk = String(row.action).startsWith('bulk_');
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <dt className="text-tertiary-500">When</dt><dd className="text-tertiary-900">{whenLabel(row.created_at)}</dd>
        <dt className="text-tertiary-500">Who</dt><dd className="text-tertiary-900">{row.actor_name || 'System'}</dd>
        {row.company && (<><dt className="text-tertiary-500">Company</dt><dd className="text-tertiary-900">{row.company}</dd></>)}
        <dt className="text-tertiary-500">Action</dt><dd className="text-tertiary-900">{ACTION_LABEL[row.action] || row.action}</dd>
        <dt className="text-tertiary-500">Record</dt><dd className="text-tertiary-900">{entityLabel(row.entity_type)}{row.entity_label ? `: ${row.entity_label}` : ''}</dd>
      </dl>
      {bulk ? (
        <pre className="max-h-80 overflow-auto rounded-xl bg-tertiary-50 p-3 text-xs">{JSON.stringify({ old: row.old_values, new: row.new_values }, null, 2)}</pre>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-tertiary-500"><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Before</th><th className="py-1">After</th></tr></thead>
          <tbody className="divide-y divide-tertiary-100 align-top">
            {fields.map((k) => (
              <tr key={k}>
                <td className="py-1.5 pr-3 font-medium text-tertiary-800">{k}</td>
                <td className="py-1.5 pr-3 text-red-700">{show(row.old_values?.[k])}</td>
                <td className="py-1.5 text-green-700">{show(row.new_values?.[k])}</td>
              </tr>
            ))}
            {!fields.length && <tr><td colSpan={3} className="py-3 text-tertiary-500">No field values were recorded.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
