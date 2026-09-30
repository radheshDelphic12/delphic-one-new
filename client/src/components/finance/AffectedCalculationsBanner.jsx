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
export default function AffectedCalculationsBanner({ refreshKey = 0 }) {
  const [rows, setRows] = useState([]);

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
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.slice(0, 12).map((r) => {
          const where = WHERE[r.kind] || WHERE.billing;
          return (
            <li key={r.id}>
              <Link to={where.to} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs text-red-800 hover:bg-red-50">
                {r.scope_label || r.kind_label} · {MONTHS[r.period_month - 1]} {r.period_year}
                <span className="text-red-500">→ {where.label}</span>
              </Link>
            </li>
          );
        })}
        {rows.length > 12 && <li className="px-1 py-1 text-xs text-red-700">+{rows.length - 12} more</li>}
      </ul>
    </section>
  );
}
