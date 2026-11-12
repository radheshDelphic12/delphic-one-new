import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Search } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ReporterView, { StatusPill } from './ReporterView.jsx';
import { dateTime } from './speakUp.js';

/** The complaints I raised (confidential ones; an anonymous complaint is followed from Track a complaint). */
export default function MyComplaints({ onRaise, onChanged }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [item, setItem] = useState(null);

  const load = useCallback(() => {
    apiClient.get('/whistleblower/mine').then(({ data }) => setRows(data.data || [])).catch((err) => { setRows([]); pushError(apiErrorMessage(err, 'Could not load your complaints'), 'Something went wrong'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!openId) { setItem(null); return; }
    apiClient.get(`/whistleblower/mine/${openId}`).then(({ data }) => setItem(data.data.case)).catch((err) => { setOpenId(null); pushError(apiErrorMessage(err, 'Could not open the complaint'), 'Something went wrong'); });
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) => !q || r.case_no.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q));
  }, [rows, query]);

  async function reply(body, files) {
    const form = new FormData();
    form.append('body', body);
    files.forEach((f) => form.append('files', f));
    const { data } = await apiClient.post(`/whistleblower/mine/${openId}/messages`, form);
    setItem(data.data.case);
    load();
    onChanged?.();
  }

  const columns = [
    { key: 'case_no', header: 'Reference number', render: (r) => <span className="font-mono text-xs font-semibold text-tertiary-900">{r.case_no}</span> },
    { key: 'subject', header: 'Title', render: (r) => <span>{r.subject}<span className="block text-xs text-tertiary-500">{r.category}</span></span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} label={r.status_label} /> },
    { key: 'created_at', header: 'Raised', render: (r) => dateTime(r.created_at) },
    { key: 'last', header: 'Last update', render: (r) => dateTime(r.last_activity_at) },
  ];

  return (
    <div className="space-y-3">
      <label className="relative block max-w-sm">
        <span className="sr-only">Find by reference number</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-tertiary-400" aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by reference number (SU-2026-0001)" className="w-full rounded-xl border border-tertiary-200 py-2 pl-9 pr-3 text-sm" />
      </label>
      {rows && rows.length === 0 ? (
        <EmptyState icon={MessageSquareText} title="You have not raised a complaint" description="Complaints you raise as confidential are listed here with their status. An anonymous complaint is followed with its reference number and tracking code." action={<button type="button" className="btn-primary" onClick={onRaise}>Raise a complaint</button>} />
      ) : (
        <DataTable columns={columns} rows={shown} loading={!rows} emptyLabel="No complaint matches that reference number." onRowClick={(r) => setOpenId(r.id)} />
      )}
      <Drawer open={Boolean(openId)} onClose={() => setOpenId(null)} title="Your complaint" size="xl" tone="info">
        {item ? <ReporterView item={item} onReply={reply} /> : <p className="text-sm text-tertiary-500">Loading…</p>}
      </Drawer>
    </div>
  );
}
