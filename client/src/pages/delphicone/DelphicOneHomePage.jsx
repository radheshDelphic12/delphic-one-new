import { useNavigate } from 'react-router-dom';
import { doxApi } from '../../lib/delphicone/api.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { Tile, rupees, th, thr, td, tdr, useLoad } from './ui.jsx';

const STAGE_LABEL = { new: 'New', contacted: 'Contacted', demo: 'Demo', trial: 'Trial', won: 'Won', lost: 'Lost' };

export default function DelphicOneHomePage() {
  const navigate = useNavigate();
  const [s] = useLoad(() => doxApi.summary(), []);
  if (!s) return <Skeleton className="h-64" />;
  const { customers: c, leads: l, receivables: r } = s;
  return (
    <div className="space-y-5" data-testid="dox-home">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Recurring revenue (active)" value={rupees(c.mrr)} hint="per 30 days, before GST" />
        <Tile label="Customers" value={c.total} hint={`${c.by_status.active} active · ${c.by_status.trial} on trial · ${c.by_status.read_only} read-only · ${c.by_status.churned} churned`} onClick={() => navigate('/delphic-one/customers')} />
        <Tile label="Users on the product" value={c.users} hint="active and trial customers" />
        <Tile label="Open leads" value={l.open} hint={l.followups_due ? `${l.followups_due} to follow up now` : 'nothing due'} tone={l.followups_due ? 'border-warning-200' : ''} onClick={() => navigate('/delphic-one/leads')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="To collect" value={rupees(r.outstanding)} hint="unpaid on sent invoices" onClick={() => navigate('/delphic-one/invoices?filter=open')} />
        <Tile label="Overdue" value={rupees(r.overdue)} hint={`${r.overdue_count} invoice${r.overdue_count === 1 ? '' : 's'} past the due date`} tone={r.overdue_count ? 'border-danger-200' : ''} onClick={() => navigate('/delphic-one/invoices?filter=overdue')} />
        <Tile label="Follow-ups due" value={r.followups_due} hint="invoices whose follow-up date has come" tone={r.followups_due ? 'border-warning-200' : ''} onClick={() => navigate('/delphic-one/invoices?filter=followup_due')} />
        <Tile label="No due date set" value={r.no_due_date} hint="unpaid invoices that cannot go overdue yet" onClick={() => navigate('/delphic-one/invoices?filter=no_due_date')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <h3 className="px-3 pt-3 font-heading text-sm font-semibold text-tertiary-900">Leads by stage</h3>
          <table className="min-w-full text-sm" data-testid="dox-stages">
            <thead><tr><th className={th}>Stage</th><th className={thr}>Leads</th><th className={thr}>Expected / 30 days</th></tr></thead>
            <tbody>{l.stages.map((x) => <tr key={x.stage} className="border-t border-tertiary-100"><td className={td}>{STAGE_LABEL[x.stage]}</td><td className={tdr}>{x.count}</td><td className={tdr}>{rupees(x.expected_value)}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="overflow-x-auto rounded-2xl border border-tertiary-100 bg-white shadow-card">
          <h3 className="px-3 pt-3 font-heading text-sm font-semibold text-tertiary-900">Trials ending in the next 7 days</h3>
          <table className="min-w-full text-sm" data-testid="dox-trials">
            <thead><tr><th className={th}>Customer</th><th className={th}>Trial ends</th></tr></thead>
            <tbody>
              {c.trials_ending.map((t) => <tr key={t.id} className="border-t border-tertiary-100"><td className={td}>{t.name}</td><td className={td}>{t.trial_ends_on}</td></tr>)}
              {!c.trials_ending.length && <tr><td colSpan={2} className="px-3 py-6 text-center text-sm text-tertiary-500">No trial is ending soon.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
