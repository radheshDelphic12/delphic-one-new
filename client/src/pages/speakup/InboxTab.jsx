import { useCallback, useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions } from '../../lib/lookups.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import EvidencePicker from './EvidencePicker.jsx';
import { Attachments, StatusPill } from './ReporterView.jsx';
import { STATUS_OPTIONS, dateTime, dayText } from './speakUp.js';

const FIELD = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const Row = ({ label, children }) => (children ? (<div><dt className="text-xs font-medium text-tertiary-500">{label}</dt><dd className="text-sm text-tertiary-900">{children}</dd></div>) : null);

/** One complaint for a handler: the details, who raised it (unless anonymous), the thread with internal notes, and the controls. */
function CaseDrawer({ id, onClose, onChanged }) {
  const { pushError, pushSuccess } = useAlerts();
  const [item, setItem] = useState(null);
  const [status, setStatus] = useState('');
  const [resolution, setResolution] = useState('');
  const [assignee, setAssignee] = useState('');
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const members = useOrgMembershipOptions(true);

  const show = (c) => { setItem(c); setStatus(c.status); setResolution(c.resolution || ''); setAssignee(c.assigned?.id || ''); };
  useEffect(() => {
    if (!id) { setItem(null); return; }
    apiClient.get(`/whistleblower/cases/${id}`).then(({ data }) => show(data.data.case)).catch((err) => { onClose(); pushError(apiErrorMessage(err, 'Could not open the complaint'), 'Something went wrong'); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn, done) {
    setBusy(true);
    try { const c = await fn(); show(c); onChanged(); if (done) pushSuccess(done); } catch (err) { pushError(apiErrorMessage(err, 'That did not work'), 'Something went wrong'); } finally { setBusy(false); }
  }
  const saveCase = () => run(async () => {
    const patch = {};
    if (status !== item.status) patch.status = status;
    if (resolution !== (item.resolution || '')) patch.resolution = resolution;
    if (assignee !== (item.assigned?.id || '')) patch.assigned_membership_id = assignee || null;
    if (!Object.keys(patch).length) throw new Error('Nothing changed yet');
    return (await apiClient.patch(`/whistleblower/cases/${id}`, patch)).data.data.case;
  }, 'Saved');
  const send = () => run(async () => {
    const form = new FormData();
    form.append('body', message.trim());
    form.append('internal', internal ? 'true' : 'false');
    files.forEach((f) => form.append('files', f));
    const c = (await apiClient.post(`/whistleblower/cases/${id}/messages`, form)).data.data.case;
    setMessage(''); setFiles([]); setInternal(false);
    return c;
  }, internal ? 'Note added' : 'Reply sent');

  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={item ? item.case_no : 'Complaint'} size="xl" tone="info">
      {!item ? <p className="text-sm text-tertiary-500">Loading…</p> : (
        <div className="space-y-5" data-testid="speakup-case">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={item.status} label={item.status_label} />
            {item.overdue && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">Overdue</span>}
            {item.restricted && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">Restricted category</span>}
            {item.is_anonymous && <span className="rounded-full bg-tertiary-100 px-2.5 py-0.5 text-xs text-tertiary-700">Anonymous</span>}
          </div>
          <div>
            <h3 className="font-heading text-base font-semibold text-tertiary-900">{item.subject}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-tertiary-700">{item.description}</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Raised by">{item.is_anonymous ? 'Anonymous (no name is stored)' : item.reporter?.name}</Row>
            <Row label="Category">{item.category}</Row>
            <Row label="Date of the incident">{dayText(item.incident_date)}</Row>
            <Row label="Location">{item.office}</Row>
            <Row label="Department">{item.department}</Row>
            <Row label="Individuals involved">{[...item.involved.map((p) => p.name), item.people_involved].filter(Boolean).join(', ')}</Row>
            <Row label="Raised on">{dateTime(item.created_at)}</Row>
            <Row label="Last activity">{dateTime(item.last_activity_at)}</Row>
          </dl>

          {item.can_act ? (
            <section className="space-y-3 rounded-xl border border-tertiary-200 p-3">
              <h4 className="text-sm font-semibold text-tertiary-900">Handle this complaint</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-tertiary-600">Status
                  <select className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
                <div className="text-xs font-medium text-tertiary-600">Assigned to
                  <div className="mt-1"><SearchableSelect value={assignee} onChange={setAssignee} options={members} placeholder="Nobody yet" allowClear /></div>
                </div>
              </div>
              <label className="block text-xs font-medium text-tertiary-600">Resolution {status === 'closed' ? '(required to close)' : '(what was found or done; the reporter sees it)'}
                <textarea rows={3} maxLength={4000} className={FIELD} value={resolution} onChange={(e) => setResolution(e.target.value)} />
              </label>
              <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy} onClick={saveCase}>Save changes</button></div>
            </section>
          ) : <p className="rounded-xl bg-tertiary-50 px-3 py-2 text-sm text-tertiary-600">You can read this complaint but not change it.</p>}

          <section>
            <h4 className="text-sm font-semibold text-tertiary-900">Conversation</h4>
            {item.messages.length === 0 ? <p className="mt-1 text-sm text-tertiary-500">No messages yet.</p> : (
              <ul className="mt-2 space-y-2">
                {item.messages.map((m) => (
                  <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.internal ? 'border border-dashed border-amber-300 bg-amber-50' : m.from === 'reporter' ? 'mr-8 bg-tertiary-50' : 'ml-8 bg-primary-50'}`}>
                    <p className="text-xs font-medium text-tertiary-500">{m.author} · {dateTime(m.created_at)}{m.internal ? ' · Internal note (the reporter cannot see this)' : ''}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-tertiary-900">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <Attachments files={item.attachments} />
          </section>

          {item.can_act && (
            <section className="space-y-3 rounded-xl border border-tertiary-200 p-3">
              <label className="block text-xs font-medium text-tertiary-600">Write to the reporter, or add an internal note
                <textarea rows={3} maxLength={4000} className={FIELD} value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note: only handlers can see it</label>
              <EvidencePicker files={files} onChange={setFiles} label="Attach files (optional)" />
              <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy || !message.trim()} onClick={send}>{internal ? 'Add note' : 'Send reply'}</button></div>
            </section>
          )}

          <section>
            <h4 className="text-sm font-semibold text-tertiary-900">History</h4>
            <ol className="mt-2 space-y-1 border-l-2 border-tertiary-200 pl-4">
              {item.events.map((e) => (
                <li key={e.id} className="text-sm text-tertiary-700">
                  {e.action === 'created' ? 'Received' : e.action === 'assigned' ? 'Assigned' : e.action === 'resolved' ? 'Closed' : e.action === 'reopened' ? 'Reopened' : `Status: ${e.detail?.to || ''}`}
                  <span className="ml-2 text-xs text-tertiary-500">{e.actor ? `${e.actor} · ` : ''}{dateTime(e.created_at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}

/** The handlers' inbox: the complaints routed to me (or, for an admin, the company's), with filters. */
export default function InboxTab({ meta, initialFilters, onChanged }) {
  const { pushError } = useAlerts();
  const [filters, setFilters] = useState({ status: 'open', category_id: '', q: '', overdue: false, assigned_to_me: false, ...initialFilters });
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const load = useCallback(() => {
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.category_id) params.category_id = filters.category_id;
    if (filters.q.trim()) params.q = filters.q.trim();
    if (filters.overdue) params.overdue = 'true';
    if (filters.assigned_to_me) params.assigned_to_me = 'true';
    apiClient.get('/whistleblower/cases', { params }).then(({ data }) => setRows(data.data.cases || [])).catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Could not load the complaints'), 'Something went wrong'); });
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); load(); }, [load]);

  const columns = [
    { key: 'case_no', header: 'Reference', render: (r) => <span className="font-mono text-xs font-semibold text-tertiary-900">{r.case_no}</span> },
    { key: 'subject', header: 'Complaint', render: (r) => <span>{r.subject}<span className="block text-xs text-tertiary-500">{r.category}</span></span> },
    { key: 'reporter', header: 'Raised by', render: (r) => (r.is_anonymous ? <span className="text-tertiary-500">Anonymous</span> : r.reporter) },
    { key: 'status', header: 'Status', render: (r) => <span className="inline-flex flex-wrap items-center gap-1"><StatusPill status={r.status} label={r.status_label} />{r.overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Overdue</span>}</span> },
    { key: 'assigned', header: 'Assigned to', render: (r) => r.assigned_to || <span className="text-tertiary-400">Nobody yet</span> },
    { key: 'last', header: 'Last activity', render: (r) => dateTime(r.last_activity_at) },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs font-medium text-tertiary-600">Search<input value={filters.q} onChange={set('q')} placeholder="Reference or title" className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Status
          <select value={filters.status} onChange={set('status')} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="open">All open</option><option value="">Everything</option>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Category
          <select value={filters.category_id} onChange={set('category_id')} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm"><option value="">All categories</option>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="flex items-end gap-2 pb-1.5 text-sm"><input type="checkbox" checked={filters.overdue} onChange={set('overdue')} /> Overdue only</label>
        <label className="flex items-end gap-2 pb-1.5 text-sm"><input type="checkbox" checked={filters.assigned_to_me} onChange={set('assigned_to_me')} /> Assigned to me</label>
      </div>
      {rows && rows.length === 0 && !filters.q && !filters.category_id && !filters.overdue && !filters.assigned_to_me && filters.status === 'open' ? (
        <EmptyState icon={Inbox} title="No open complaints" description="Complaints routed to you appear here, and you are notified when one arrives." />
      ) : (
        <DataTable columns={columns} rows={rows || []} loading={!rows} emptyLabel="No complaint matches these filters." onRowClick={(r) => setOpenId(r.id)} />
      )}
      <CaseDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); onChanged?.(); }} />
    </div>
  );
}
