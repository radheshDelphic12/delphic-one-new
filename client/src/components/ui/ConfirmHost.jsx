import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { subscribeConfirm } from '../../lib/confirmAction.js';

/**
 * Single styled confirmation dialog used by confirmAction(). Renders nothing until asked,
 * so it adds no cost to first paint. Escape / backdrop = Cancel; focus lands on the safe button.
 */
export default function ConfirmHost() {
  const [req, setReq] = useState(null);
  const queueRef = useRef([]);
  const cancelRef = useRef(null);

  useEffect(() => subscribeConfirm((next) => {
    setReq((current) => {
      if (current) { queueRef.current.push(next); return current; }
      return next;
    });
  }), []);

  const finish = useCallback((answer) => {
    setReq((current) => {
      if (current) current.resolve(answer);
      return queueRef.current.shift() || null;
    });
  }, []);

  useEffect(() => {
    if (!req) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [req, finish]);

  if (!req) return null;
  const Icon = req.danger ? AlertTriangle : Info;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/40" aria-label="Cancel" onClick={() => finish(false)} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-white shadow-soft">
        <div className="flex items-start gap-4 px-5 py-5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${req.danger ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-600'}`}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-heading text-sm font-semibold text-tertiary-900">{req.title}</h2>
            <p id="confirm-message" className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-tertiary-700">{req.message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button type="button" ref={cancelRef} className="btn-secondary" onClick={() => finish(false)}>Cancel</button>
          <button type="button" className={req.danger ? 'btn-danger' : 'btn-primary'} onClick={() => finish(true)}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
