import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Trash2 } from 'lucide-react';
import apiClient, { fetchAuthenticatedBlob, downloadAuthenticatedFile } from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { promptAction } from '../../lib/confirmAction.js';

const MAX_WIDTH = 760;
const API = '/api/v1/document-centre';

// pdf.js is large: it is loaded only when a document is opened for signing.
async function loadPdfjs() {
  const mod = await import('pdfjs-dist/build/pdf.js');
  const lib = mod.default && mod.default.getDocument ? mod.default : mod;
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

/**
 * The signing page: the PDF page by page, with the signer's own signature in a tray. Drag it onto the page (or press "Add to this page"),
 * move it where it belongs, make it bigger or smaller, then "Sign and finish". Nothing is changed in the original: a signed copy is made.
 */
export default function SigningStudio({ request, signature, stamp = null, onClose, onDone }) {
  const { pushError, pushSuccess } = useAlerts();
  const [pdf, setPdf] = useState(null);
  const [pageNo, setPageNo] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [placements, setPlacements] = useState([]); // { id, kind, page, x, y, width } as fractions of the page, from the top-left; kind = signature | stamp
  const [selected, setSelected] = useState(null);
  const [aspect, setAspect] = useState(0.35); // signature height / width
  const [stampAspect, setStampAspect] = useState(1); // stamp height / width
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const drag = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lib, blob] = await Promise.all([loadPdfjs(), fetchAuthenticatedBlob(`${API}/sign-requests/${request.id}/original`)]);
        const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        if (!cancelled) { setPdf(doc); setLoading(false); }
      } catch (err) {
        if (!cancelled) { setLoading(false); pushError(err.message || 'The document could not be opened', 'Not opened'); }
      }
    })();
    return () => { cancelled = true; };
  }, [request.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // draw the current page
  useEffect(() => {
    if (!pdf) return undefined;
    let cancelled = false;
    let task = null;
    (async () => {
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const avail = Math.min(wrapRef.current?.clientWidth || MAX_WIDTH, MAX_WIDTH);
      const scale = avail / base.width;
      const vp = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      setSize({ w: vp.width, h: vp.height });
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] });
      try { await task.promise; } catch { /* a newer render replaced this one */ }
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pdf, pageNo]);

  const sigHeightFraction = useCallback((width, kind = 'signature') => (size.h ? (width * size.w * (kind === 'stamp' ? stampAspect : aspect)) / size.h : 0), [size, aspect, stampAspect]);
  const add = (page, cx, cy, kind = 'signature') => {
    const width = kind === 'stamp' ? 0.16 : 0.22;
    const hFrac = sigHeightFraction(width, kind);
    const x = Math.min(Math.max(cx - width / 2, 0), 1 - width);
    const y = Math.min(Math.max(cy - hFrac / 2, 0), Math.max(1 - hFrac, 0));
    const p = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, page, x, y, width };
    setPlacements((cur) => [...cur, p]);
    setSelected(p.id);
  };

  function onDrop(e) {
    e.preventDefault();
    const r = overlayRef.current.getBoundingClientRect();
    const kind = e.dataTransfer?.getData('text/plain') === 'stamp' && stamp ? 'stamp' : 'signature';
    add(pageNo, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, kind);
  }
  function startMove(e, p) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(p.id);
    const r = overlayRef.current.getBoundingClientRect();
    drag.current = { id: p.id, dx: e.clientX - r.left - p.x * r.width, dy: e.clientY - r.top - p.y * r.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function moveIt(e) {
    const d = drag.current;
    if (!d) return;
    const r = overlayRef.current.getBoundingClientRect();
    setPlacements((cur) => cur.map((p) => {
      if (p.id !== d.id) return p;
      const hFrac = sigHeightFraction(p.width, p.kind);
      return { ...p, x: Math.min(Math.max((e.clientX - r.left - d.dx) / r.width, 0), 1 - p.width), y: Math.min(Math.max((e.clientY - r.top - d.dy) / r.height, 0), Math.max(1 - hFrac, 0)) };
    }));
  }
  const endMove = () => { drag.current = null; };
  const current = placements.find((p) => p.id === selected);
  const resize = (value) => setPlacements((cur) => cur.map((p) => (p.id === selected ? { ...p, width: value, x: Math.min(p.x, 1 - value) } : p)));
  const remove = (id) => { setPlacements((cur) => cur.filter((p) => p.id !== id)); if (selected === id) setSelected(null); };

  async function finish() {
    setBusy(true);
    try {
      await apiClient.post(`/document-centre/sign-requests/${request.id}/sign`, { placements: placements.map(({ kind, page, x, y, width }) => ({ kind, page, x, y, width })) });
      pushSuccess('Document signed');
      setSigned(true);
      onDone?.();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not sign the document'), 'Not signed'); } finally { setBusy(false); }
  }
  async function decline() {
    const reason = await promptAction('Why are you not signing this document? (required)\nThe person who sent it will see this.');
    if (reason === null) return;
    try {
      await apiClient.post(`/document-centre/sign-requests/${request.id}/decline`, { reason: reason.trim() });
      pushSuccess('Sent back without signing');
      onDone?.();
      onClose();
    } catch (err) { pushError(apiErrorMessage(err, 'Could not send it back'), 'Not sent'); }
  }

  const pages = pdf?.numPages || 0;
  return (
    <div className="space-y-3" data-testid="signing-studio">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button type="button" className="text-xs text-primary-700 hover:underline" onClick={onClose}>&larr; Back to the list</button>
          <h3 className="font-heading text-base font-semibold text-tertiary-900">{request.title}</h3>
          <p className="text-xs text-tertiary-500">{[request.entity_name, request.doc_type, `from ${request.requested_by?.name || ''}`].filter(Boolean).join(' · ')}{request.note ? ` · "${request.note}"` : ''}</p>
        </div>
        {signed ? (
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="download-signed" onClick={() => downloadAuthenticatedFile(`${API}/sign-requests/${request.id}/signed`, `${request.title}-signed.pdf`).catch((e) => pushError(e.message, 'Download failed'))}><Download className="h-4 w-4" />Download the signed PDF</button>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={decline}>Do not sign</button>
            <button type="button" className="btn-primary" disabled={busy || !placements.some((p) => p.kind === 'signature')} onClick={finish} data-testid="finish-signing">{busy ? 'Signing…' : `Sign and finish (${placements.length})`}</button>
          </div>
        )}
      </div>

      {signed && <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="signed-banner">Signed. The signed copy is saved; the person who sent it can download it or attach it to the record.</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div ref={wrapRef} className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-xs text-tertiary-600">
            <div className="inline-flex items-center gap-1">
              <button type="button" aria-label="Previous page" className="rounded-lg border border-tertiary-200 p-1 disabled:opacity-40" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)}><ChevronLeft className="h-4 w-4" /></button>
              <span data-testid="page-indicator">Page {pageNo} of {pages || '…'}</span>
              <button type="button" aria-label="Next page" className="rounded-lg border border-tertiary-200 p-1 disabled:opacity-40" disabled={pageNo >= pages} onClick={() => setPageNo((n) => n + 1)}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <span>Drag your signature onto the page, then move it where you want it</span>
          </div>
          {loading ? <p className="py-10 text-center text-sm text-tertiary-500">Opening the document…</p> : (
            <div className="overflow-auto rounded-xl border border-tertiary-200 bg-tertiary-100 p-2">
              <div className="relative mx-auto" style={{ width: size.w || undefined, height: size.h || undefined }}>
                <canvas ref={canvasRef} className="block bg-white shadow" data-testid="pdf-page" />
                {!signed && (
                  <div
                    ref={overlayRef}
                    className="absolute inset-0"
                    data-testid="page-overlay"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDrop}
                    onPointerMove={moveIt}
                    onPointerUp={endMove}
                    onPointerDown={() => setSelected(null)}
                  >
                    {placements.filter((p) => p.page === pageNo).map((p) => (
                      <img
                        key={p.id}
                        src={p.kind === 'stamp' ? stamp : signature}
                        alt={p.kind === 'stamp' ? 'Company stamp' : 'Your signature'}
                        draggable={false}
                        data-testid={p.kind === 'stamp' ? 'placed-stamp' : 'placed-signature'}
                        onPointerDown={(e) => startMove(e, p)}
                        onLoad={(e) => { if (e.currentTarget.naturalWidth) (p.kind === 'stamp' ? setStampAspect : setAspect)(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth); }}
                        className={`absolute cursor-move touch-none select-none ${selected === p.id ? 'outline outline-2 outline-primary-500' : 'outline outline-1 outline-dashed outline-primary-300'}`}
                        style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.width * 100}%` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-tertiary-100 bg-white p-3">
            <p className="text-xs font-semibold text-tertiary-700">Your signature</p>
            <div className="mt-2 flex items-center justify-center rounded-lg border border-dashed border-tertiary-300 bg-canvas-muted p-3">
              <img src={signature} alt="Your signature to drag" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', 'signature')} className="max-h-20 max-w-full cursor-grab" data-testid="signature-tray" onLoad={(e) => { if (e.currentTarget.naturalWidth) setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth); }} />
            </div>
            <button type="button" className="btn-secondary mt-2 w-full" disabled={signed || !pdf} data-testid="add-signature" onClick={() => add(pageNo, 0.7, 0.85)}>Add to this page</button>
          </div>
          {stamp ? (
            <div className="rounded-xl border border-tertiary-100 bg-white p-3">
              <p className="text-xs font-semibold text-tertiary-700">Company stamp</p>
              <div className="mt-2 flex items-center justify-center rounded-lg border border-dashed border-tertiary-300 bg-canvas-muted p-3">
                <img src={stamp} alt="Company stamp to drag" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', 'stamp')} className="max-h-20 max-w-full cursor-grab" data-testid="stamp-tray" onLoad={(e) => { if (e.currentTarget.naturalWidth) setStampAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth); }} />
              </div>
              <button type="button" className="btn-secondary mt-2 w-full" disabled={signed || !pdf} data-testid="add-stamp" onClick={() => add(pageNo, 0.45, 0.85, 'stamp')}>Stamp this page</button>
            </div>
          ) : <p className="rounded-xl border border-tertiary-100 bg-white p-3 text-[11px] text-tertiary-500">No company stamp is set up. A document admin adds it under Sign documents &gt; Company stamp.</p>}
          {current && (
            <div className="rounded-xl border border-tertiary-100 bg-white p-3" data-testid="placement-controls">
              <p className="text-xs font-semibold text-tertiary-700">Selected {current.kind === 'stamp' ? 'stamp' : 'signature'} (page {current.page})</p>
              <label className="mt-2 block text-xs text-tertiary-600">Size
                <input type="range" min="0.08" max="0.6" step="0.01" value={current.width} onChange={(e) => resize(Number(e.target.value))} className="mt-1 w-full" aria-label="Signature size" />
              </label>
              <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-danger-600 hover:underline" onClick={() => remove(current.id)}><Trash2 className="h-3.5 w-3.5" />Remove this one</button>
            </div>
          )}
          <div className="rounded-xl border border-tertiary-100 bg-white p-3 text-xs text-tertiary-600">
            <p className="font-semibold text-tertiary-700">Placed ({placements.length})</p>
            {placements.length === 0 ? <p className="mt-1">Nothing yet. Drag the signature onto a page.</p> : (
              <ul className="mt-1 space-y-1">
                {placements.map((p) => (
                  <li key={p.id} className="flex items-center justify-between"><button type="button" className="text-primary-700 hover:underline" onClick={() => { setPageNo(p.page); setSelected(p.id); }}>{p.kind === 'stamp' ? 'Stamp' : 'Signature'} · page {p.page}</button><button type="button" aria-label="Remove" className="text-tertiary-400 hover:text-danger-600" onClick={() => remove(p.id)}>&times;</button></li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
