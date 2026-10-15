import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlerts } from '../../../lib/alerts/alertContext.jsx';
import { novarexError } from '../../../lib/novarex/api.js';
import { withReason } from '../ui.jsx';

export { Money, Kpi, card, today, dayOf } from '../ui.jsx';

export const inputCls = 'rounded-xl border px-3 py-2 text-sm';
export const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
export const titleOf = (v) => String(v || '').replace(/_/g, ' ');

/** A list that reloads whenever its dependencies change (filters, tabs) and on demand. */
export function useRows(fetcher, deps) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const ref = useRef(fetcher);
  useEffect(() => { ref.current = fetcher; });
  const reload = useCallback(() => Promise.resolve(ref.current()).then(setRows, (e) => pushError(novarexError(e, 'Could not load'), 'Load failed')), [pushError]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(reload, 150); return () => clearTimeout(t); }, [reload, ...deps]);
  return { rows, reload };
}

/** Run an API action with a toast, an optional confirmation, and the admin "reason for the closed month" retry. */
export function useAction(reload) {
  const { pushError, pushSuccess } = useAlerts();
  return useCallback(async (run, { confirm, done = 'Done', after } = {}) => {
    if (confirm && !window.confirm(confirm)) return null;
    try {
      const res = await withReason(run);
      pushSuccess(done);
      if (reload) await reload();
      if (after) after(res);
      return res;
    } catch (e) {
      pushError(novarexError(e, 'That did not work'), 'Not done');
      return null;
    }
  }, [pushError, pushSuccess, reload]);
}

export function Btn({ children, onClick, danger, primary, disabled, title }) {
  const cls = primary ? 'btn-primary' : danger ? 'rounded-lg border border-danger-200 px-2 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50' : 'rounded-lg border px-2 py-1 text-xs font-medium text-tertiary-700 hover:bg-primary-50';
  return <button type="button" title={title} disabled={disabled} className={`${cls} disabled:opacity-50`} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>;
}

/** A small form dialog body: labelled inputs described by `fields`, submit / cancel. */
export function FieldGrid({ children }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
