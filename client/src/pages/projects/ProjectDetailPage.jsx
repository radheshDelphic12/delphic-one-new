import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Paperclip, Plus, Trash2 } from 'lucide-react';
import apiClient, { openAuthenticatedFile } from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { dateLabel, isoDate, money, titleCase } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import KpiCard from '../../components/ui/KpiCard.jsx';
import Pill from '../../components/ui/Pill.jsx';
import { PROJECT_FIELDS } from './ProjectsHubPage.jsx';

const DOC_CATEGORIES = ['legal', 'site', 'permit', 'approval', 'title', 'other'];
const ENTRY_TYPES = ['revenue', 'expense', 'salary', 'other'];

function DocumentDrawer({ open, projectId, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ category: 'legal', title: '', reference_no: '', issued_on: '', expires_on: '', notes: '' });

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => v && body.append(k, v));
      if (file) body.append('file', file);
      await apiClient.post(`/projects/${projectId}/documents`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      pushSuccess('Document recorded');
      setForm({ category: 'legal', title: '', reference_no: '', issued_on: '', expires_on: '', notes: '' });
      setFile(null);
      onDone();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save document'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Drawer open={open} onClose={onClose} title="Legal / site document" size="md" tone="create" footer={<><button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" form="project-doc-form" className="btn-primary" disabled={saving || !form.title}>{saving ? 'Saving...' : 'Save'}</button></>}>
      <form id="project-doc-form" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">Category<select value={form.category} onChange={set('category')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>
        <label className="block text-xs font-medium text-tertiary-600">Title<input required value={form.title} onChange={set('title')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Reference no.<input value={form.reference_no} onChange={set('reference_no')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Issued on<input type="date" value={form.issued_on} onChange={set('issued_on')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-medium text-tertiary-600">Expires on<input type="date" value={form.expires_on} onChange={set('expires_on')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">Notes<textarea rows={2} value={form.notes} onChange={set('notes')} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">File <span className="font-normal text-tertiary-400">(pdf, doc, image, xlsx; optional)</span><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" /></label>
      </form>
    </Drawer>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { pushError, pushSuccess } = useAlerts();
  const [drawer, setDrawer] = useState(null);
  const { data, loading, error, refresh } = useLiveData(() => apiClient.get(`/projects/${id}`).then((r) => r.data.data), { deps: [id] });

  async function act(fn, message, rethrow = false) {
    try {
      await fn();
      if (message) pushSuccess(message);
      refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Request failed'), 'Could not save');
      if (rethrow) throw err;
    }
  }

  if (error) return <p className="text-sm text-red-600">Project not found. <Link className="underline" to="/projects">Back to projects</Link></p>;
  if (loading && !data) return <p className="text-sm text-tertiary-500">Loading...</p>;
  const project = data?.project;
  if (!project) return null;

  const entryCols = [
    { key: 'entry_date', header: 'Date', render: (r) => dateLabel(r.entry_date) },
    { key: 'entry_type', header: 'Type', render: (r) => <Pill tone={r.entry_type === 'revenue' ? 'green' : r.entry_type === 'salary' ? 'purple' : r.entry_type === 'expense' ? 'red' : 'gray'}>{titleCase(r.entry_type)}</Pill> },
    { key: 'category', header: 'Category', render: (r) => r.category || '-' },
    { key: 'description', header: 'Description', render: (r) => r.description || '-' },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-medium">{money(r.amount)}</span> },
    { key: 'x', header: '', render: (r) => <button type="button" aria-label="Delete entry" className="text-tertiary-400 hover:text-red-600" onClick={() => act(() => apiClient.delete(`/projects/${id}/finance/${r.id}`), 'Entry removed')}><Trash2 className="h-4 w-4" /></button> },
  ];
  const docCols = [
    { key: 'title', header: 'Document', render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'category', header: 'Category', render: (r) => <Pill tone="purple">{titleCase(r.category)}</Pill> },
    { key: 'reference_no', header: 'Reference', render: (r) => r.reference_no || '-' },
    { key: 'expires_on', header: 'Expires', render: (r) => (r.expires_on ? dateLabel(r.expires_on) : '-') },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'file', header: 'File', render: (r) => (r.file_url ? <button type="button" className="inline-flex items-center gap-1 text-primary-700 hover:underline" onClick={() => openAuthenticatedFile(r.file_url).catch((err) => pushError(err.message, 'Could not open file'))}><Paperclip className="h-3.5 w-3.5" />Open</button> : '-') },
    { key: 'x', header: '', render: (r) => <button type="button" aria-label="Delete document" className="text-tertiary-400 hover:text-red-600" onClick={() => act(() => apiClient.delete(`/projects/${id}/documents/${r.id}`), 'Document removed')}><Trash2 className="h-4 w-4" /></button> },
  ];
  const contractCols = [
    { key: 'title', header: 'Contract', render: (r) => r.title },
    { key: 'status', header: 'Status', render: (r) => <Pill value={r.status} /> },
    { key: 'value', header: 'Value', render: (r) => money(r.value) },
    { key: 'progress', header: 'Progress', render: (r) => `${r.progress_percent}% (billed ${money(r.billed_to_date)})` },
  ];

  return (
    <div className="space-y-4">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-tertiary-500 hover:text-tertiary-800"><ArrowLeft className="h-4 w-4" />Projects</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-lg font-semibold text-tertiary-900">{project.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tertiary-500">
            <Pill value={project.status} />{project.project_type && <span>{project.project_type}</span>}{project.location && <span>{project.location}</span>}
            {project.investor_name && <span>Investor: {project.investor_name}</span>}{project.customer_deal_ref && <span>Deal: {project.customer_deal_ref}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <select aria-label="Project status" value={project.status} onChange={(e) => act(() => apiClient.patch(`/projects/${id}`, { status: e.target.value }), 'Status updated')} className="rounded-xl border px-3 py-1.5 text-sm">{['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select>
          <button type="button" className="btn-secondary" onClick={() => setDrawer('edit')}>Edit</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Revenue" value={money(project.revenue)} theme="green" />
        <KpiCard label="Expenses" value={money(project.expense)} theme="red" />
        <KpiCard label="Salary" value={money(project.salary)} theme="purple" />
        <KpiCard label="Other" value={money(project.other)} theme="orange" />
        <KpiCard label="Net" value={money(project.net)} hint={project.budget ? `${project.budget_used_percent}% of ${money(project.budget)} budget` : undefined} theme={project.net < 0 ? 'red' : 'blue'} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-heading text-sm font-semibold text-tertiary-900">Revenue, expenses, salary and other items</h2><button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer('entry')}><Plus className="h-4 w-4" />Add entry</button></div>
        <DataTable columns={entryCols} rows={data.finance_entries} emptyLabel="No entries yet" />
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="font-heading text-sm font-semibold text-tertiary-900">Legal and site documents</h2><button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setDrawer('doc')}><Plus className="h-4 w-4" />Add document</button></div>
        <DataTable columns={docCols} rows={data.documents} emptyLabel="No documents tracked" />
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Construction contracts</h2>
        <DataTable columns={contractCols} rows={data.contracts} emptyLabel={<span>No contracts linked. Create one under <Link className="text-primary-700 underline" to="/contracts">Contracts</Link>.</span>} />
      </section>

      <FormDrawer open={drawer === 'entry'} onClose={() => setDrawer(null)} title="Add entry" submitLabel="Add" onSubmit={(v) => act(() => apiClient.post(`/projects/${id}/finance`, v), 'Entry added', true)} fields={[
        { name: 'entry_type', label: 'Type', type: 'select', required: true, default: 'expense', options: ENTRY_TYPES.map((v) => ({ value: v, label: titleCase(v) })) },
        { name: 'amount', label: 'Amount', type: 'number', required: true, min: 0 },
        { name: 'entry_date', label: 'Date', type: 'date', required: true, default: isoDate() },
        { name: 'category', label: 'Category', hint: 'materials, labour, approvals...' },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]} />
      <FormDrawer open={drawer === 'edit'} onClose={() => setDrawer(null)} title="Edit project" tone="edit" size="lg" initial={{ ...project, start_date: project.start_date?.slice(0, 10), end_date: project.end_date?.slice(0, 10) }} onSubmit={(v) => act(() => apiClient.patch(`/projects/${id}`, v), 'Project updated', true)} fields={PROJECT_FIELDS} />
      <DocumentDrawer open={drawer === 'doc'} projectId={id} onClose={() => setDrawer(null)} onDone={refresh} />
    </div>
  );
}
