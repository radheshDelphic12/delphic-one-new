import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useSpeakUpSummary } from './speakUp.js';

const Chip = ({ to, count, label, tone }) => (
  <Link to={to} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
    <span className="text-sm font-semibold tabular-nums">{count}</span> {label}
  </Link>
);

/**
 * The Speak Up card on the dashboard: raise a complaint in confidence, see how many of mine are open, and (for handlers) what is
 * waiting. Hidden for everyone while the module is off; an admin sees a nudge to switch it on.
 */
export default function SpeakUpDashboardCard() {
  const { user } = useAuth();
  const isMaster = Boolean(user?.active_org?.is_master_workspace);
  const summary = useSpeakUpSummary(isMaster, user?.active_org?.id);
  if (!isMaster || !summary) return null;
  if (!summary.enabled && !summary.can_manage) return null;

  return (
    <section id="speak-up" className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="speakup-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900"><Megaphone className="h-4 w-4 text-primary-600" aria-hidden="true" />Speak Up – Confidential Reporting</h2>
          <p className="mt-1 text-sm text-tertiary-500">{summary.enabled ? 'Something wrong at work? Raise it in confidence, or anonymously. Only the people who handle it will see it.' : 'It is switched off. Set the handlers for each category, then switch it on.'}</p>
        </div>
        {summary.enabled
          ? <Link to="/speak-up?tab=raise" className="btn-primary text-sm">Raise a complaint</Link>
          : <Link to="/speak-up?tab=settings" className="btn-secondary text-sm">Open settings</Link>}
      </div>
      {summary.enabled && (summary.my_open > 0 || summary.handling) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.my_open > 0 && <Chip to="/speak-up?tab=mine" count={summary.my_open} label={summary.my_open === 1 ? 'of my complaints is open' : 'of my complaints are open'} tone="bg-primary-50 text-primary-700" />}
          {summary.handling && <Chip to="/speak-up?tab=inbox&filter=new" count={summary.handling.new} label="new to handle" tone="bg-blue-50 text-blue-700" />}
          {summary.handling && summary.handling.open > 0 && <Chip to="/speak-up?tab=inbox" count={summary.handling.open} label="open" tone="bg-tertiary-100 text-tertiary-700" />}
          {summary.handling && summary.handling.overdue > 0 && <Chip to="/speak-up?tab=inbox&filter=overdue" count={summary.handling.overdue} label="overdue" tone="bg-red-50 text-red-700" />}
        </div>
      )}
    </section>
  );
}
