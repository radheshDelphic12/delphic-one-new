import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

const STATUS_OPTIONS = [
  { value: 'both', label: 'Pending + Approved' },
  { value: 'approved', label: 'Approved only' },
  { value: 'pending', label: 'Pending only' },
];

const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// The error body of a blob request is a Blob; read the API message out of it.
async function blobErrorMessage(err, fallback) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text());
      return body?.errors?.[0]?.message || body?.message || fallback;
    } catch {
      return fallback;
    }
  }
  return apiErrorMessage(err, fallback);
}

/**
 * Project-wise timesheet Excel for one person and month (Log time page; the Project Timesheets tab for admins).
 * The month comes from the page's own filter. `members` (admin view) adds an employee picker; without it the
 * download is the signed-in person's own. Warns about days with nothing logged, but never blocks the download.
 */
export default function ProjectTimesheetDownload({ month, year, members }) {
  const { pushError } = useAlerts();
  const [memberId, setMemberId] = useState('');
  const [statuses, setStatuses] = useState('both');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);
  const needsMember = Array.isArray(members);

  useEffect(() => {
    if (needsMember && !memberId) {
      setProjects([]);
      return undefined;
    }
    let cancelled = false;
    setProjects(null);
    apiClient
      .get('/timesheets/project-timesheet/options', { params: { month, year, statuses, org_membership_id: memberId || undefined } })
      .then(({ data }) => {
        if (cancelled) return;
        const list = data.data?.projects || [];
        setProjects(list);
        setProjectId((cur) => (cur === 'all' || list.some((p) => p.id === cur) ? cur : ''));
      })
      .catch((err) => {
        if (cancelled) return;
        setProjects([]);
        pushError(apiErrorMessage(err, 'Failed to load the projects for this month'), 'Project timesheet');
      });
    return () => { cancelled = true; };
  }, [month, year, statuses, memberId, needsMember]); // eslint-disable-line react-hooks/exhaustive-deps

  const picked = projectId === 'all' ? projects || [] : (projects || []).filter((p) => p.id === projectId);
  const missing = picked.flatMap((p) => p.missing_dates.map((d) => ({ project: p.name, date: d })));
  const missingDates = [...new Set(missing.map((m) => m.date))].sort();

  async function download() {
    setBusy(true);
    try {
      const response = await apiClient.get('/timesheets/project-timesheet/download', {
        params: { month, year, statuses, project_id: projectId, org_membership_id: memberId || undefined },
        responseType: 'blob',
      });
      const disposition = response.headers?.['content-disposition'] || '';
      const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] || `project-timesheet-${year}-${String(month).padStart(2, '0')}.xlsx`;
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushError(await blobErrorMessage(err, 'Failed to download the project timesheet'), 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  const empty = projects !== null && projects.length === 0 && (!needsMember || memberId);
  return (
    <section className="space-y-2 rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" aria-label="Download project timesheet">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-2 inline-flex items-center gap-2 font-heading text-sm font-semibold text-tertiary-900">
          <FileSpreadsheet className="h-4 w-4 text-primary-600" /> Download project timesheet
        </h3>
        {needsMember && (
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} aria-label="Employee" className="rounded-xl border px-3 py-1.5 text-sm">
            <option value="">Select employee…</option>
            {members.map((m) => <option key={m.org_membership_id} value={m.org_membership_id}>{m.name}</option>)}
          </select>
        )}
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects || projects.length === 0} aria-label="Project" className="max-w-[16rem] rounded-xl border px-3 py-1.5 text-sm">
          <option value="">{projects === null ? 'Loading projects…' : 'Select project…'}</option>
          {projects && projects.length > 1 && <option value="all">All projects (zip)</option>}
          {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={statuses} onChange={(e) => setStatuses(e.target.value)} aria-label="Entry status" className="rounded-xl border px-3 py-1.5 text-sm">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={!projectId || busy} onClick={download}>
          <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
      {empty && <p className="text-xs text-tertiary-500">No hours logged in this month{statuses === 'both' ? '' : ' with this status'}, so there is no project timesheet to download.</p>}
      {needsMember && !memberId && <p className="text-xs text-tertiary-500">Select an IT employee to download their project timesheet.</p>}
      {missingDates.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{missingDates.length} day{missingDates.length === 1 ? '' : 's'} with no log: {missingDates.map(dayLabel).join(', ')}. They show as &quot;Not Logged&quot; in the Excel. You can still download.</span>
        </p>
      )}
    </section>
  );
}
