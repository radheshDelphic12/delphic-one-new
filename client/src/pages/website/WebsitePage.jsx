import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { dateLabel, titleCase } from '../../lib/format.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { PostingStatus } from './WebsitePublishPanel.jsx';

const TABS = [
  { key: 'submissions', label: 'Form submissions' },
  { key: 'postings', label: 'Job postings' },
];
const FORM_LABEL = { contact: 'Contact', career: 'Career', secure: 'Delphic Secure' };
const SELECT = 'rounded-xl border px-3 py-1.5 text-sm';

/** Delphic website control: what the website's forms collected, and which jobs are live on /career. */
export default function WebsitePage() {
  const [tab, setTab] = useState('submissions');
  const status = useLiveData(() => apiClient.get('/website/status').then((r) => r.data.data));

  if (!status.data) return null;
  if (!status.data.configured) {
    const missing = [!status.data.secret && 'WEBSITE_SCRIPT_SECRET', ...Object.entries(status.data.scripts).filter(([, set]) => !set).map(([s]) => `WEBSITE_${s.toUpperCase()}_SCRIPT_URL`)].filter(Boolean);
    return (
      <div className="rounded-lg border bg-white p-6 text-sm text-tertiary-600">
        <h1 className="font-heading text-lg font-semibold text-tertiary-900">Website</h1>
        <p className="mt-2">Website control is not configured on this server. Missing: {missing.join(', ')}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">Website</h1>
        <div className="flex gap-1 rounded-xl bg-tertiary-100 p-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white text-tertiary-900 shadow-card' : 'text-tertiary-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'submissions' ? <SubmissionsTab /> : <PostingsTab />}
    </div>
  );
}

function SubmissionsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [formType, setFormType] = useState('');
  const [statusFilter, setStatusFilter] = useState('new');
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(null);
  const list = useLiveData(
    () => apiClient.get('/website/submissions', { params: { limit: 100, ...(formType ? { form_type: formType } : {}), ...(statusFilter ? { status: statusFilter } : {}) } }).then((r) => r.data),
    { deps: [formType, statusFilter] }
  );

  async function sync() {
    setSyncing(true);
    try {
      const { data } = await apiClient.post('/website/submissions/sync');
      const summary = data.data;
      if (summary.errors.length) pushError(summary.errors.join('; '), 'Sync partly failed');
      else pushSuccess(summary.imported ? `Imported ${summary.imported} new submission${summary.imported === 1 ? '' : 's'}` : 'Already up to date');
      list.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Sync failed'), 'Website');
    } finally {
      setSyncing(false);
    }
  }

  const rows = list.data?.data || [];
  const newCount = (form) => (list.data?.counts || []).filter((c) => c.status === 'new' && (!form || c.form_type === form)).reduce((n, c) => n + c.count, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <select aria-label="Form" value={formType} onChange={(e) => setFormType(e.target.value)} className={SELECT}>
            <option value="">All forms ({newCount()} new)</option>
            {Object.entries(FORM_LABEL).map(([value, label]) => <option key={value} value={value}>{label} ({newCount(value)} new)</option>)}
          </select>
          <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT}>
            <option value="">Any status</option><option value="new">New</option><option value="converted">Converted</option><option value="dismissed">Dismissed</option>
          </select>
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={sync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Syncing...' : 'Sync now'}
        </button>
      </div>
      <p className="text-xs text-tertiary-500">New submissions are pulled from the website sheets every 10 minutes.</p>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Received</th><th className="px-3 py-2">Form</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Details</th><th className="px-3 py-2">Status</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-tertiary-500">{list.loading ? 'Loading...' : 'Nothing here.'}</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} className="cursor-pointer border-t hover:bg-tertiary-50" onClick={() => setOpen(row)}>
                <td className="whitespace-nowrap px-3 py-2">{row.submitted_at ? dateLabel(row.submitted_at) : '-'}</td>
                <td className="px-3 py-2">{FORM_LABEL[row.form_type]}</td>
                <td className="px-3 py-2 font-medium text-tertiary-900">{row.name || '-'}</td>
                <td className="px-3 py-2">{row.email || '-'}</td>
                <td className="max-w-xs truncate px-3 py-2 text-tertiary-500">{row.payload?.Role || row.payload?.Company || row.payload?.Message || ''}</td>
                <td className="px-3 py-2"><Pill value={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <SubmissionDrawer submission={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); list.refresh(); }} />}
    </div>
  );
}

function SubmissionDrawer({ submission, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({ total_experience_years: '', primary_skills: '' });
  const [requirementId, setRequirementId] = useState('');
  const isCareer = submission.form_type === 'career';
  const isNew = submission.status === 'new';
  // In-progress requirements: the ones whose applicant pool can take this person.
  const pools = useLiveData(() => apiClient.get('/applicants/requirements').then((r) => r.data.data), { enabled: isCareer && isNew });

  async function run(path, body, message) {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/website/submissions/${submission.id}/${path}`, body);
      pushSuccess(data.data?.linked_existing ? 'Linked to the existing candidate with this email' : message);
      onDone();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Action failed'), 'Website');
    } finally {
      setBusy(false);
    }
  }

  function convertProfile(event) {
    event.preventDefault();
    run(
      'convert-profile',
      { total_experience_years: Number(profile.total_experience_years), primary_skills: profile.primary_skills.split(',').map((s) => s.trim()).filter(Boolean) },
      'Candidate created'
    );
  }

  const footer = isNew ? (
    <>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => run('dismiss', {}, 'Dismissed')}>Dismiss</button>
      {isCareer
        ? <button type="submit" form="convert-profile" className="btn-primary" disabled={busy}>Create candidate</button>
        : <button type="button" className="btn-primary" disabled={busy} onClick={() => run('convert-lead', {}, 'Lead created')}>Convert to lead</button>}
    </>
  ) : null;

  return (
    <Drawer open onClose={onClose} title={`${FORM_LABEL[submission.form_type]} · ${submission.name || 'Submission'}`} size="md" footer={footer}>
      <div className="space-y-4">
        <dl className="space-y-2 text-sm">
          {Object.entries(submission.payload || {}).map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs font-medium text-tertiary-500">{key}</dt>
              <dd className="whitespace-pre-wrap break-words text-tertiary-900">
                {/^https?:\/\//.test(value) ? <a href={value} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline">{value}</a> : value || '-'}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-tertiary-500">
          <Pill value={submission.status} />
          {submission.handled_by_user && <span>by {submission.handled_by_user.name}{submission.handled_at ? ` · ${dateLabel(submission.handled_at)}` : ''}</span>}
          {submission.converted_lead_id && <Link to="/leads" className="text-primary-700 hover:underline">Open leads</Link>}
          {submission.converted_profile_id && <Link to={`/profiles/${submission.converted_profile_id}`} className="text-primary-700 hover:underline">Open candidate</Link>}
          {submission.converted_applicant_id && <Link to="/pipeline" className="text-primary-700 hover:underline">In the applicant pool</Link>}
        </div>
        {isNew && isCareer && (
          <div className="space-y-2 rounded-lg border border-primary-100 bg-primary-50/40 p-3">
            <p className="text-xs text-tertiary-600">Send to a job&apos;s applicant pool, where the first recruiter to claim the applicant owns them. Applications for a job you published are routed there automatically.</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Requirement" value={requirementId} onChange={(e) => setRequirementId(e.target.value)} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm">
                <option value="">{pools.loading ? 'Loading jobs...' : 'Choose an in-progress job'}</option>
                {(pools.data || []).map((r) => <option key={r.id} value={r.id}>{r.title}{r.client ? ` · ${r.client}` : ''}</option>)}
              </select>
              <button type="button" className="btn-secondary" disabled={busy || !requirementId} onClick={() => run('to-applicant', { requirement_id: requirementId }, 'Added to the applicant pool')}>Send to pool</button>
            </div>
          </div>
        )}
        {isNew && isCareer && (
          <form id="convert-profile" onSubmit={convertProfile} className="space-y-3 rounded-lg bg-tertiary-50 p-3">
            <p className="text-xs text-tertiary-600">The website form doesn&apos;t ask for these, so fill them in to create the candidate. If a candidate with this email already exists, the application is linked to them instead.</p>
            <label className="block text-xs font-medium text-tertiary-600">Total experience (years)
              <input required type="number" min="0" max="60" step="0.5" value={profile.total_experience_years} onChange={(e) => setProfile({ ...profile, total_experience_years: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-medium text-tertiary-600">Primary skills <span className="font-normal text-tertiary-400">(comma separated)</span>
              <input required value={profile.primary_skills} onChange={(e) => setProfile({ ...profile, primary_skills: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
            </label>
          </form>
        )}
      </div>
    </Drawer>
  );
}

function PostingsTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [busyId, setBusyId] = useState(null);
  const list = useLiveData(() => apiClient.get('/website/postings').then((r) => r.data.data));

  async function act(posting, path, message) {
    setBusyId(posting.id);
    try {
      await apiClient.post(`/website/postings/${posting.id}/${path}`);
      pushSuccess(message);
      list.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Website update failed'), 'Website');
    } finally {
      setBusyId(null);
    }
  }

  const rows = list.data || [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-tertiary-500">Publish a job from its requirement page. Closing or dropping the requirement takes it off the website automatically.</p>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-tertiary-50 text-left text-xs uppercase text-tertiary-500">
            <tr><th className="px-3 py-2">Website title</th><th className="px-3 py-2">Requirement</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last synced</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-tertiary-500">{list.loading ? 'Loading...' : 'No jobs published yet.'}</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium text-tertiary-900">{p.title}{p.sync_error && <p className="text-xs font-normal text-red-600">{p.sync_error}</p>}</td>
                <td className="px-3 py-2"><Link to={`/requirements/${p.requirement_id}`} className="text-primary-700 hover:underline">{p.requirement?.title}</Link> <span className="text-xs text-tertiary-400">{titleCase(p.requirement?.status)}</span></td>
                <td className="px-3 py-2"><PostingStatus posting={p} /></td>
                <td className="whitespace-nowrap px-3 py-2">{p.last_synced_at ? dateLabel(p.last_synced_at) : '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {p.sync_error && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" disabled={busyId === p.id} onClick={() => act(p, 'retry', 'Website synced')}>Retry</button>}
                  {p.status === 'published'
                    ? <button type="button" className="ml-3 text-xs font-medium text-primary-700 hover:underline" disabled={busyId === p.id} onClick={() => act(p, 'close', 'Removed from the website')}>Close</button>
                    : !['closed', 'dropped'].includes(p.requirement?.status) && <button type="button" className="ml-3 text-xs font-medium text-primary-700 hover:underline" disabled={busyId === p.id} onClick={() => act(p, 'reopen', 'Back on the website')}>Reopen</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
