import { novarexError } from '../../lib/novarex/api.js';

// Shared form / layout primitives are the ones every vertical workspace uses; only the error helper is Novarex's own.
export * from '../acconcy/ui.jsx';

/**
 * Admin override helper: run(reason?) is tried once; if the server asks for a reason (a closed month) the admin is
 * prompted for it and the call is retried with it.
 */
export async function withReason(run) {
  try {
    return await run(undefined);
  } catch (e) {
    const msg = novarexError(e, '');
    if (/reason/i.test(msg)) {
      const reason = window.prompt(`${msg}\n\nReason for this change:`);
      if (reason && reason.trim()) return run(reason.trim());
    }
    throw e;
  }
}

/** Small coloured delta: +12.5% / -3% against the previous period (a rise in an expense is shown as unfavourable). */
export function Delta({ pct, inverse = false }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-tertiary-400">no comparison</span>;
  const up = pct > 0;
  const good = pct === 0 ? null : inverse ? !up : up;
  const tone = good === null ? 'text-tertiary-500' : good ? 'text-emerald-700' : 'text-red-600';
  return <span className={`text-xs font-medium ${tone}`}>{up ? '▲' : pct < 0 ? '▼' : '■'} {Math.abs(pct)}% vs previous period</span>;
}
