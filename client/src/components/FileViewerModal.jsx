import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { fetchAuthenticatedBlob, downloadAuthenticatedFile } from '../lib/apiClient.js';
import { useAlerts } from '../lib/alerts/alertContext.jsx';

function extOf(url = '') {
  const base = String(url).split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > -1 ? base.slice(dot + 1).toLowerCase() : '';
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

/**
 * In-app viewer for an uploaded document.
 *   - PDF / image  → rendered inline (iframe / <img>), no download, no popup.
 *   - .docx        → converted to HTML in the browser via `docx-preview`.
 *   - everything else (.doc, .xlsx, .csv, …) → download prompt (no browser renderer exists).
 *
 * Props: open, onClose, doc: { label, file_url, file_type?, file_size_bytes? }
 */
export default function FileViewerModal({ open, onClose, doc }) {
  const { pushError } = useAlerts();
  const [objectUrl, setObjectUrl] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [docxState, setDocxState] = useState('idle'); // idle | rendering | done | error
  const blobRef = useRef(null);
  const docxRef = useRef(null);

  const ext = doc ? extOf(doc.file_url) : '';
  const isPdf = ext === 'pdf' || (doc?.file_type || '').includes('pdf');
  const isImage = IMAGE_EXT.includes(ext) || (doc?.file_type || '').startsWith('image/');
  const isDocx =
    ext === 'docx' ||
    (doc?.file_type || '').includes('officedocument.wordprocessingml');
  const canPreview = isPdf || isImage || isDocx;

  // Fetch the file once per open.
  useEffect(() => {
    if (!open || !doc?.file_url) return undefined;
    let cancelled = false;
    let url = null;
    setStatus('loading');
    setDocxState('idle');
    setObjectUrl(null);
    blobRef.current = null;
    fetchAuthenticatedBlob(doc.file_url)
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        pushError(err.message || 'Failed to open file', 'Something went wrong');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, doc?.file_url, pushError]);

  // Render .docx into the container once the blob is ready and the node is mounted.
  useEffect(() => {
    if (status !== 'ready' || !isDocx || !blobRef.current || !docxRef.current) return undefined;
    let cancelled = false;
    const container = docxRef.current;
    container.innerHTML = '';
    setDocxState('rendering');
    import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(blobRef.current, container, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true,
        })
      )
      .then(() => {
        if (!cancelled) setDocxState('done');
      })
      .catch(() => {
        if (!cancelled) setDocxState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [status, isDocx]);

  if (!open || !doc) return null;

  async function download() {
    try {
      await downloadAuthenticatedFile(doc.file_url, doc.label || undefined);
    } catch (err) {
      pushError(err.message || 'Failed to download file', 'Something went wrong');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close viewer" onClick={onClose} />
      <div className="relative z-10 flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-drawer">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h2 className="truncate font-heading text-sm font-semibold text-tertiary-900">
            {doc.label || 'Attachment'}
            {ext && (
              <span className="ml-2 rounded bg-tertiary-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-tertiary-500">
                {ext}
              </span>
            )}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={download}>
              Download
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-tertiary-400 transition-colors hover:bg-tertiary-100 hover:text-tertiary-700"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-tertiary-50">
          {status === 'loading' && (
            <div className="flex h-full items-center justify-center text-sm text-tertiary-400">Loading…</div>
          )}
          {status === 'error' && (
            <div className="flex h-full items-center justify-center text-sm text-danger-600">
              Could not load this file.
            </div>
          )}

          {status === 'ready' && isPdf && (
            <iframe title={doc.label || 'Document'} src={objectUrl} className="h-full w-full border-0" />
          )}

          {status === 'ready' && isImage && (
            <div className="flex h-full items-center justify-center p-4">
              <img src={objectUrl} alt={doc.label || 'Attachment'} className="max-h-full max-w-full object-contain" />
            </div>
          )}

          {status === 'ready' && isDocx && (
            <div className="min-h-full">
              {docxState === 'rendering' && (
                <div className="flex h-full items-center justify-center text-sm text-tertiary-400">
                  Rendering document…
                </div>
              )}
              {docxState === 'error' && (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-sm text-tertiary-600">Couldn&apos;t render this Word document.</p>
                  <button type="button" className="btn-primary" onClick={download}>
                    Download to open
                  </button>
                </div>
              )}
              {/* docx-preview renders its own page-styled DOM here */}
              <div ref={docxRef} className={docxState === 'done' ? 'p-4' : 'hidden'} />
            </div>
          )}

          {status === 'ready' && !canPreview && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-tertiary-600">
                {ext ? `.${ext.toUpperCase()} files` : 'This file type'} can&apos;t be previewed in the browser.
              </p>
              <button type="button" className="btn-primary" onClick={download}>
                Download to open
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
