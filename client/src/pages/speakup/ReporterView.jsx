import { useState } from 'react';
import { FileText } from 'lucide-react';
import { downloadFile } from '../../lib/downloadFile.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EvidencePicker from './EvidencePicker.jsx';
import { STATUS_STYLE, dateTime, dayText, fileSize } from './speakUp.js';

export const StatusPill = ({ status, label }) => <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || 'bg-tertiary-100 text-tertiary-700'}`}>{label}</span>;

export function Attachments({ files, downloadable = true }) {
  const { pushError } = useAlerts();
  if (!files?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-tertiary-400" aria-hidden="true" />
          {downloadable ? (
            <button type="button" className="min-w-0 truncate text-left text-primary-700 hover:underline" onClick={() => downloadFile(`/whistleblower/attachments/${f.id}`, undefined, f.file_name).catch((err) => pushError(apiErrorMessage(err, 'Could not download the file'), 'Download failed'))}>{f.file_name}</button>
          ) : <span className="min-w-0 truncate">{f.file_name}</span>}
          <span className="text-xs text-tertiary-500">{fileSize(f.size_bytes)}</span>
        </li>
      ))}
    </ul>
  );
}

const Row = ({ label, children }) => (children ? (<div><dt className="text-xs font-medium text-tertiary-500">{label}</dt><dd className="text-sm text-tertiary-900">{children}</dd></div>) : null);

/**
 * What the person who raised a complaint sees: its status and timeline, what they wrote, the team's replies (never the internal
 * notes or who the handlers are), and a box to add more information or evidence. Used for My complaints and for the anonymous tracker.
 */
export default function ReporterView({ item, onReply, downloadable = true }) {
  const { pushError } = useAlerts();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  async function send(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onReply(body.trim(), files);
      setBody('');
      setFiles([]);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not send your message'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="speakup-reporter-view">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-tertiary-900">{item.case_no}</span>
        <StatusPill status={item.status} label={item.status_label} />
        {item.is_anonymous && <span className="rounded-full bg-tertiary-100 px-2.5 py-0.5 text-xs text-tertiary-700">Anonymous</span>}
      </div>
      <div>
        <h3 className="font-heading text-base font-semibold text-tertiary-900">{item.subject}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-tertiary-700">{item.description}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="Category">{item.category}</Row>
        <Row label="Date of the incident">{dayText(item.incident_date)}</Row>
        <Row label="Location">{item.office}</Row>
        <Row label="Department">{item.department}</Row>
        <Row label="Individuals involved">{item.people_involved}</Row>
        <Row label="Raised on">{dateTime(item.created_at)}</Row>
      </dl>
      {item.resolution && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm">
          <p className="text-xs font-medium text-green-800">Outcome</p>
          <p className="mt-0.5 whitespace-pre-wrap text-tertiary-900">{item.resolution}</p>
        </div>
      )}

      <section>
        <h4 className="text-sm font-semibold text-tertiary-900">Progress</h4>
        <ol className="mt-2 space-y-1 border-l-2 border-tertiary-200 pl-4">
          {item.timeline.map((e) => (
            <li key={e.id} className="text-sm text-tertiary-700">
              <span className="font-medium">{e.action === 'created' ? 'Received' : e.action === 'reopened' ? 'Reopened' : e.to || 'Updated'}</span>
              <span className="ml-2 text-xs text-tertiary-500">{dateTime(e.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-tertiary-900">Messages</h4>
        {item.messages.length === 0 ? <p className="mt-1 text-sm text-tertiary-500">No messages yet. The team will write here if they need anything from you.</p> : (
          <ul className="mt-2 space-y-2">
            {item.messages.map((m) => (
              <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.from === 'you' ? 'ml-8 bg-primary-50' : 'mr-8 bg-tertiary-50'}`}>
                <p className="text-xs font-medium text-tertiary-500">{m.from === 'you' ? 'You' : 'Speak Up team'} · {dateTime(m.created_at)}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-tertiary-900">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        <Attachments files={item.attachments} downloadable={downloadable} />
      </section>

      <form onSubmit={send} className="space-y-3 rounded-xl border border-tertiary-200 p-3">
        <label className="block text-xs font-medium text-tertiary-600">Add more information or evidence
          <textarea rows={3} maxLength={4000} className="mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything new, an answer to the team's question, or a file you forgot to add." />
        </label>
        <EvidencePicker files={files} onChange={setFiles} label="Attach files (optional)" />
        <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send'}</button></div>
      </form>
    </div>
  );
}
