import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Where each kind of locked calculation is regularised (recalculated and
// re-finalized; billing then regenerates its invoice).
const WHERE = {
  billing: { to: '/analytics?section=sales', label: 'Billing & Sales' },
  salary: { to: '/analytics?section=salary', label: 'Salary' },
  resource_revenue: { to: '/analytics?section=resources', label: 'Resource revenue' },
  vendor_payment: { to: '/analytics?section=vendors', label: 'Vendors' },
};

/**
 * After an admin corrects timesheets or attendance in a locked month, the
 * locked calculations built on them are flagged "Historical Calculation
 * Affected". This lists them with a link to regularise each one: recalculate
 * and re-finalize it, then regenerate the invoice. `refreshKey` re-reads the
 * list after a correction. Renders nothing when nothing is affected.
 */
const money = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// Old / new value of a change: plain values as text, objects as "key: value" pairs.
function showValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'object') return String(v);
  const parts = Object.entries(v).filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object').map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`);
  return parts.length ? parts.join(', ') : '—';
}

// What was changed in one locked calculation, so the red banner can be explained.
function ChangeDetails({ row }) {
  const open = (row.changes || []).filter((c) => c.status === 'open');
  const list = open.length ? open : row.changes || [];
  if (!list.length) return <p className="text-xs text-red-700">No change details were recorded for this one.</p>;
  return (
    <ul className="space-y-2">
      {list.map((c) => (
        <li key={c.id} className="rounded-lg border border-red-100 bg-white px-3 py-2 text-xs text-slate-700">
          <p className="font-medium text-slate-900">{c.description}</p>
          <p className="mt-0.5 text-slate-500">
            {c.date ? `For ${fmtDate(c.date)} · ` : ''}
            {c.changed_by?.name ? `changed by ${c.changed_by.name} · ` : ''}
            detected {fmtDate(c.detected_at)}
          </p>
          {(c.old_value || c.new_value) && (
            <p className="mt-1">
              <span className="text-slate-500">Was:</span> {showValue(c.old_value)} <span className="mx-1 text-slate-400">→</span>
              <span className="text-slate-500">Now:</span> {showValue(c.new_value)}
            </p>
          )}
          {c.potential_amount !== null && (
            <p className="mt-1">
              Locked amount {money(c.previous_amount)} → would now be <b>{money(c.potential_amount)}</b>
              {c.difference ? <span className={c.difference > 0 ? ' text-emerald-700' : ' text-red-700'}> ({c.difference > 0 ? '+' : ''}{money(c.difference)})</span> : null}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AffectedCalculationsBanner({ refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .get('/calculations', { params: { status: 'change_detected' } })
      .then(({ data }) => { if (alive) setRows(data.data || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [refreshKey]);

  if (!rows.length) return null;
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-red-800">
        <AlertTriangle className="h-4 w-4" />
        {rows.length} locked calculation{rows.length === 1 ? '' : 's'} affected by corrections
      </p>
      <p className="mt-0.5 text-xs text-red-700">Locked figures are never rewritten. Open each one, <b>Recalculate &amp; re-finalize</b> it, then regenerate the invoice.</p>
      <p className="mt-0.5 text-xs text-red-700">Click a figure to see exactly what was changed.</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.slice(0, 12).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              aria-expanded={openId === r.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-red-800 hover:bg-red-50 ${openId === r.id ? 'border-red-400 bg-red-100' : 'border-red-200 bg-white'}`}
            >
              {r.scope_label || r.kind_label} · {MONTHS[r.period_month - 1]} {r.period_year}
              <span className="text-red-500">({r.open_changes || 0} change{r.open_changes === 1 ? '' : 's'})</span>
            </button>
          </li>
        ))}
        {rows.length > 12 && <li className="px-1 py-1 text-xs text-red-700">+{rows.length - 12} more</li>}
      </ul>
      {rows.some((r) => r.id === openId) && (() => {
        const r = rows.find((x) => x.id === openId);
        const where = WHERE[r.kind] || WHERE.billing;
        return (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold text-red-800">
              {r.scope_label || r.kind_label} · {MONTHS[r.period_month - 1]} {r.period_year} — locked at {money(r.locked_amount)}
            </p>
            <ChangeDetails row={r} />
            <Link to={where.to} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs text-red-800 hover:bg-red-50">
              Open in {where.label} to recalculate →
            </Link>
          </div>
        );
      })()}
    </section>
  );
}
