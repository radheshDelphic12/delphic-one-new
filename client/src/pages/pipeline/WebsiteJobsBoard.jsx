import { useState } from 'react';
import { Globe, Info, Link2, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { userCan } from '../../lib/permissions.js';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { POSTING_FIELDS, PostingStatus } from '../website/WebsitePublishPanel.jsx';
import { AddApplicantDrawer } from './ApplicantPoolBoard.jsx';

const SOURCES = [['linkedin', 'LinkedIn'], ['website', 'Website'], ['whatsapp', 'WhatsApp'], ['naukri', 'Naukri'], ['referral', 'Referral'], ['other', 'Other']];
const CHANNEL_LABEL = Object.fromEntries(SOURCES);
// The public page of a published job. VITE_PUBLIC_JOBS_BASE can point it at the public domain (for example https://app.delphic.in).
const jobLink = (slug, src) => `${(import.meta.env.VITE_PUBLIC_JOBS_BASE || window.location.origin).replace(/\/$/, '')}/careers/${slug}?src=${src}`;

/** Copies the job's public link with the chosen source, so each post (LinkedIn, WhatsApp, ...) can be tracked. */
function CopyLink({ slug, onCopied, onFailed }) {
  const [src, setSrc] = useState('linkedin');
  async function copy() {
    const url = jobLink(slug, src);
    try { await navigator.clipboard.writeText(url); onCopied(url); } catch { onFailed(url); }
  }
  return (
    <span className="inline-flex items-center gap-1" data-testid="job-link">
      <select aria-label="Source of this link" className="rounded-lg border border-tertiary-200 px-1.5 py-1 text-xs" value={src} onChange={(e) => setSrc(e.target.value)}>
        {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button type="button" className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs" onClick={copy}><Link2 className="h-3.5 w-3.5" />Copy link</button>
    </span>
  );
}

const money = (r) => {
  if (r.budget_min == null && r.budget_max == null) return null;
  const f = (n) => Number(n).toLocaleString('en-IN');
  return `${r.budget_currency || ''} ${r.budget_min != null ? f(r.budget_min) : ''}${r.budget_max != null ? ` – ${f(r.budget_max)}` : ''}`.trim();
};

/**
 * Pipeline > In-progress jobs: every requirement that is in progress, with what a website post carries (JD, experience,
 * work mode). Publishing uses the website module (Apps Script): the button opens the same public-copy form as the
 * requirement page and only publishes when it is pressed.
 */
export default function WebsiteJobsBoard() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const [addFor, setAddFor] = useState(null);
  const [publishing, setPublishing] = useState(null); // { requirement, posting, defaults }
  const reqs = useLiveData(() => apiClient.get('/applicants/requirements').then((r) => r.data.data), { intervalMs: 30000, deps: [] });
  const canPublish = userCan(user, 'manageWebsite');
  const status = useLiveData(() => apiClient.get('/website/status').then((r) => r.data.data), { enabled: canPublish, deps: [canPublish] });
  const configured = Boolean(status.data?.configured);
  const postings = useLiveData(() => apiClient.get('/website/postings').then((r) => r.data.data), { deps: [configured], enabled: canPublish && configured });
  const postingOf = new Map((postings.data || []).map((p) => [p.requirement_id, p]));

  async function openPublish(r) {
    try {
      const { data } = await apiClient.get(`/website/postings/requirement/${r.id}`);
      setPublishing({ requirement: r, posting: data.data.posting, defaults: data.data.defaults });
    } catch (e) { pushError(apiErrorMessage(e, 'Could not open the website form'), 'Website'); }
  }
  async function save(values) {
    const { posting, requirement } = publishing;
    try {
      if (posting) await apiClient.patch(`/website/postings/${posting.id}`, values);
      else await apiClient.post('/website/postings', { ...values, requirement_id: requirement.id });
      pushSuccess(posting ? 'Website posting updated' : 'Published to the website');
      reqs.refresh();
      postings.refresh();
    } catch (e) {
      pushError(apiErrorMessage(e, 'Could not publish'), 'Website');
      throw e;
    }
  }

  const rows = reqs.data || [];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50/50 px-4 py-2.5 text-sm text-tertiary-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
        <p>Requirements that are <strong>in progress</strong>. Publishing puts the job on the website career page only when you press the button; only the public copy (title, location, description) is sent. Applicants who apply on the website are worked from <strong>Website → Submissions</strong>, and anyone added here can be claimed from the Applicants tab.</p>
      </div>
      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-[#F9FAFB] text-left text-xs uppercase tracking-wide text-tertiary-500">
              <tr><th className="px-4 py-2 font-medium">Requirement</th><th className="px-3 font-medium">Experience</th><th className="px-3 font-medium">Budget</th><th className="px-3 font-medium">Work mode</th><th className="px-3 font-medium">Applicants</th><th className="px-3 text-right font-medium">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const posting = postingOf.get(r.id);
                return (
                  <tr key={r.id} className="border-t border-tertiary-100" data-testid="website-job-row">
                    <td className="px-4 py-2">
                      <Link to={`/requirements/${r.id}`} className="font-medium text-primary-700 hover:underline">{r.title}</Link>
                      <p className="text-xs text-tertiary-500">{r.client}{r.tech_stack?.length ? ` · ${r.tech_stack.slice(0, 3).join(', ')}` : ''}</p>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {!r.has_jd && <Pill tone="amber">No JD yet</Pill>}
                        {posting && <PostingStatus posting={posting} />}
                      </span>
                    </td>
                    <td className="px-3 tabular-nums">{r.experience_min != null || r.experience_max != null ? `${r.experience_min ?? 0}–${r.experience_max ?? '?'} yrs` : '—'}</td>
                    <td className="px-3">{money(r) || <span className="text-tertiary-400">Not mentioned</span>}</td>
                    <td className="px-3 capitalize">{r.work_mode || '—'}{r.work_location ? <span className="block text-xs normal-case text-tertiary-500">{r.work_location}</span> : null}</td>
                    <td className="px-3"><Pill tone={r.applicants.new ? 'blue' : 'gray'}>{r.applicants.new} waiting</Pill> <span className="text-xs text-tertiary-500">{r.applicants.assigned} claimed</span>
                      {Object.keys(r.channels || {}).length > 0 && <p className="mt-0.5 text-xs text-tertiary-500" data-testid="channel-counts">{Object.entries(r.channels).map(([k, n]) => `${CHANNEL_LABEL[k] || 'Unknown'} ${n}`).join(' · ')}</p>}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button type="button" className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs" onClick={() => setAddFor(r.id)}><UserPlus className="h-3.5 w-3.5" />Add applicant</button>
                        {posting?.status === 'published' && posting.slug && <CopyLink slug={posting.slug} onCopied={() => pushSuccess('Link copied. Anyone who applies through it is counted under the source you chose.')} onFailed={(url) => pushError(`Copy this link: ${url}`, 'Link')} />}
                        {canPublish && (
                          <button type="button" className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs" disabled={!configured} title={configured ? undefined : 'Website control is not configured on this server'} onClick={() => openPublish(r)}>
                            <Globe className="h-3.5 w-3.5" />{posting ? 'Edit website listing' : 'Publish on website'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-tertiary-500">{reqs.loading ? 'Loading…' : 'No requirement is in progress right now.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <AddApplicantDrawer open={Boolean(addFor)} requirements={rows} requirementId={addFor} onClose={() => setAddFor(null)} onSaved={reqs.refresh} />
      <FormDrawer
        open={Boolean(publishing)}
        onClose={() => setPublishing(null)}
        title={publishing?.posting ? 'Edit website listing' : 'Publish to website'}
        submitLabel={publishing?.posting ? 'Save and sync' : 'Publish'}
        intro="Only these fields are sent to the website. Budget, billing and client details stay in the platform."
        fields={POSTING_FIELDS}
        initial={publishing?.posting || publishing?.defaults}
        onSubmit={save}
        size="lg"
      />
    </div>
  );
}
