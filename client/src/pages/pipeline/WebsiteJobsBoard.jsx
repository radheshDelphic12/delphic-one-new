import { useState } from 'react';
import { Globe, Info, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Pill from '../../components/ui/Pill.jsx';
import { AddApplicantDrawer } from './ApplicantPoolBoard.jsx';

const money = (r) => {
  if (r.budget_min == null && r.budget_max == null) return null;
  const f = (n) => Number(n).toLocaleString('en-IN');
  return `${r.budget_currency || ''} ${r.budget_min != null ? f(r.budget_min) : ''}${r.budget_max != null ? ` – ${f(r.budget_max)}` : ''}`.trim();
};

/**
 * Pipeline > In-progress jobs: every requirement that is in progress, with what a website post would carry (JD, experience,
 * budget when set, work mode). The Publish button is wired to a stub: the website side is built separately.
 */
export default function WebsiteJobsBoard() {
  const { user } = useAuth();
  const { pushError, pushInfo, pushSuccess } = useAlerts();
  const [busyId, setBusyId] = useState(null);
  const [addFor, setAddFor] = useState(null);
  const reqs = useLiveData(() => apiClient.get('/applicants/requirements').then((r) => r.data.data), { intervalMs: 30000, deps: [] });
  const canPublish = ['admin', 'sales'].includes(user?.role);

  async function toggle(r) {
    const live = r.website?.published;
    setBusyId(r.id);
    try {
      const { data } = await apiClient.post(`/applicants/requirements/${r.id}/${live ? 'unpublish-website' : 'publish-website'}`, {});
      const failed = data.data?.posting?.sync_error;
      if (failed) pushError(failed, 'Saved, but the website did not update');
      else pushSuccess(live ? 'Taken off the website' : 'Live on the website careers page');
      reqs.refresh();
    } catch (e) {
      const text = apiErrorMessage(e, live ? 'Could not unpublish' : 'Could not publish');
      if (e?.response?.status === 501) pushInfo(text, 'Website not connected');
      else pushError(text, live ? 'Not unpublished' : 'Not published');
    } finally {
      setBusyId(null);
    }
  }

  const rows = reqs.data || [];
  const connected = rows.some((r) => r.website?.connected);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50/50 px-4 py-2.5 text-sm text-tertiary-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
        <p>
          Requirements that are <strong>in progress</strong>. Publishing puts the job (title, JD, experience, work mode and location) on the website careers page, only when you press the button. Budget and client details are never published.{' '}
          {connected
            ? 'Applications for a live job land in the Applicants tab automatically.'
            : 'The website connection is not configured on this server yet; applicants can already be added by hand and claimed from the Applicants tab.'}
        </p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-[#F9FAFB] text-left text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2 font-medium">Requirement</th><th className="px-3 font-medium">Experience</th><th className="px-3 font-medium">Budget</th><th className="px-3 font-medium">Work mode</th><th className="px-3 font-medium">Applicants</th><th className="px-3 text-right font-medium">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-tertiary-100" data-testid="website-job-row">
                  <td className="px-4 py-2">
                    <Link to={`/requirements/${r.id}`} className="font-medium text-primary-700 hover:underline">{r.title}</Link>
                    <p className="text-xs text-tertiary-500">{r.client}{r.tech_stack?.length ? ` · ${r.tech_stack.slice(0, 3).join(', ')}` : ''}</p>
                    {!r.has_jd && <Pill tone="amber">No JD yet</Pill>}
                    {r.website?.published && <Pill tone="green">Live on website</Pill>}
                    {r.website?.sync_error && <Pill tone="red">Website sync failed</Pill>}
                  </td>
                  <td className="px-3 tabular-nums">{r.experience_min != null || r.experience_max != null ? `${r.experience_min ?? 0}–${r.experience_max ?? '?'} yrs` : '—'}</td>
                  <td className="px-3">{money(r) || <span className="text-tertiary-400">Not mentioned</span>}</td>
                  <td className="px-3 capitalize">{r.work_mode || '—'}{r.work_location ? <span className="block text-xs normal-case text-tertiary-500">{r.work_location}</span> : null}</td>
                  <td className="px-3"><Pill tone={r.applicants.new ? 'blue' : 'gray'}>{r.applicants.new} waiting</Pill> <span className="text-xs text-tertiary-500">{r.applicants.assigned} claimed</span></td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      <button type="button" className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs" onClick={() => setAddFor(r.id)}><UserPlus className="h-3.5 w-3.5" />Add applicant</button>
                      {canPublish && (
                        <button type="button" disabled={busyId === r.id} className={`${r.website?.published ? 'btn-secondary' : 'btn-primary'} inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs`} onClick={() => toggle(r)}>
                          <Globe className="h-3.5 w-3.5" />{r.website?.published ? 'Unpublish' : 'Publish on website'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-tertiary-500">{reqs.loading ? 'Loading…' : 'No requirement is in progress right now.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <AddApplicantDrawer open={Boolean(addFor)} requirements={rows} requirementId={addFor} onClose={() => setAddFor(null)} onSaved={reqs.refresh} />
    </div>
  );
}
