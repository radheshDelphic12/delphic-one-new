import { useEffect, useState } from 'react';
import apiClient, { downloadAuthenticatedFile } from '../lib/apiClient.js';
import { useAlerts } from '../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../lib/alerts/apiErrorMessage.js';
import FileViewerModal from './FileViewerModal.jsx';

function fileExt(url = '') {
  const base = String(url).split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > -1 ? base.slice(dot + 1).toUpperCase() : 'FILE';
}

function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadName(doc) {
  const ext = fileExt(doc.file_url);
  const label = (doc.label || 'attachment').replace(/[^\w.\- ]+/g, '').trim() || 'attachment';
  return label.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? label : `${label}.${ext.toLowerCase()}`;
}

/**
 * Reusable files panel for account | requirement | profile | submission.
 * Props: entityType, entityId, canUpload?, defaultLabel?
 */
export default function FilesPanel({
  entityType,
  entityId,
  canUpload = true,
  defaultLabel = 'Attachment',
  title = 'Files',
  accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.csv',
  multiple = false,
}) {
  const { pushError } = useAlerts();
  const [files, setFiles] = useState([]);
  const [label, setLabel] = useState(defaultLabel);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);

  async function loadFiles() {
    if (!entityType || !entityId) return;
    setLoading(true);
    try {
      const { data } = await apiClient.get('/documents', {
        params: { entity_type: entityType, entity_id: entityId },
      });
      setFiles(data.data || []);
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to load files'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles();
  }, [entityType, entityId]);

  async function uploadFile(event) {
    const picked = Array.from(event.target.files || []);
    event.target.value = '';
    if (picked.length === 0) return;
    setUploading(true);
    // One request per file, in order — the endpoint takes a single file each.
    for (const file of multiple ? picked : picked.slice(0, 1)) {
      try {
        const body = new FormData();
        body.append('entity_type', entityType);
        body.append('entity_id', entityId);
        body.append('label', (label || defaultLabel).trim() || defaultLabel);
        body.append('file', file);
        // Let the browser set `multipart/form-data; boundary=…` — passing the
        // header explicitly drops the boundary and the upload hangs ("Uploading…").
        await apiClient.post('/documents', body);
      } catch (requestError) {
        pushError(apiErrorMessage(requestError, `Failed to upload ${file.name}`), 'Something went wrong');
      }
    }
    await loadFiles();
    setUploading(false);
  }

  async function deleteFile(documentId) {
    try {
      await apiClient.delete(`/documents/${documentId}`);
      await loadFiles();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to delete file'), 'Something went wrong');
    }
  }

  async function downloadFile(doc) {
    try {
      await downloadAuthenticatedFile(doc.file_url, downloadName(doc));
    } catch (requestError) {
      pushError(requestError.message || 'Failed to download file', 'Something went wrong');
    }
  }

  return (
    <section className="overflow-hidden rounded border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-tertiary-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-tertiary-800">{title}</h2>
        {canUpload && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Label"
              className="w-28 rounded border px-2 py-1 text-xs"
            />
            <label className="cursor-pointer text-xs font-medium text-primary-700 hover:underline">
              {uploading ? 'Uploading…' : multiple ? '+ Upload files' : '+ Upload'}
              <input type="file" accept={accept} multiple={multiple} className="hidden" disabled={uploading} onChange={uploadFile} />
            </label>
          </div>
        )}
      </div>

      <table className="min-w-full text-left text-sm">
        <thead className="border-b text-xs uppercase text-tertiary-500">
          <tr>
            <th className="px-4 py-2 font-medium">Label</th>
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-4 py-2 font-medium">Uploaded</th>
            <th className="px-4 py-2 font-medium">By</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading && (
            <tr>
              <td colSpan={5} className="px-4 py-5 text-center text-tertiary-400">
                Loading files…
              </td>
            </tr>
          )}
          {!loading &&
            files.map((doc) => (
              <tr key={doc.id} className="hover:bg-tertiary-50">
                <td className="px-4 py-2">{doc.label}</td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded bg-tertiary-100 px-1.5 py-0.5 text-[10px] font-semibold text-tertiary-600">
                      {fileExt(doc.file_url)}
                    </span>
                    {doc.file_size_bytes ? (
                      <span className="text-xs text-tertiary-400">{humanSize(doc.file_size_bytes)}</span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-2 text-tertiary-500">
                  {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2 text-tertiary-600">{doc.uploaded_by?.name || '—'}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setViewerDoc(doc)}
                      className="text-xs font-medium text-primary-700 hover:underline"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile(doc)}
                      className="text-xs font-medium text-primary-700 hover:underline"
                    >
                      Download
                    </button>
                    {canUpload && (
                      <button
                        type="button"
                        onClick={() => deleteFile(doc.id)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          {!loading && files.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-5 text-center text-tertiary-400">
                No files uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <FileViewerModal open={Boolean(viewerDoc)} doc={viewerDoc} onClose={() => setViewerDoc(null)} />
    </section>
  );
}
