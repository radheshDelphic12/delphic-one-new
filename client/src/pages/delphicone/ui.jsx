import { useCallback, useEffect, useState } from 'react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

// Small shared pieces of the Delphic One workspace pages.
export const inputCls = 'mt-1 w-full rounded-xl border border-tertiary-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
export const labelCls = 'block text-xs font-medium text-tertiary-600';
export const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-tertiary-500';
export const thr = `${th} text-right`;
export const td = 'px-3 py-2 align-top';
export const tdr = `${td} text-right tabular-nums`;

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const today = () => new Date().toLocaleDateString('en-CA');

export function Tile({ label, value, hint, tone = '', onClick }) {
  const body = (
    <>
      <p className="text-xs text-tertiary-500">{label}</p>
      <p className="font-heading text-xl font-semibold tabular-nums text-tertiary-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-tertiary-500">{hint}</p>}
    </>
  );
  const cls = `rounded-2xl border border-tertiary-100 bg-white p-3 text-left shadow-card ${tone}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:bg-primary-50/40`}>{body}</button> : <div className={cls}>{body}</div>;
}

/** Load something from the API, with a reload function; an error is shown as an alert and gives an empty result. */
export function useLoad(fn, deps, empty = null) {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then((d) => { if (live) setData(d); }).catch((err) => { if (live) setData(empty); pushError(apiErrorMessage(err, 'Could not load'), 'Load failed'); });
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return [data, reload];
}

export function useSave() {
  const { pushError, pushSuccess } = useAlerts();
  return useCallback(async (fn, ok, fallback) => {
    try { const r = await fn(); if (ok) pushSuccess(ok); return r; } catch (err) { pushError(apiErrorMessage(err, fallback), 'Not saved'); return undefined; }
  }, [pushError, pushSuccess]);
}
