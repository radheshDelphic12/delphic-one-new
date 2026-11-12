import { foundationError } from '../../lib/foundation/api.js';

// Shared form / layout primitives are the same ones every vertical workspace uses; only the error helper is the Foundation's own.
export * from '../acconcy/ui.jsx';

/**
 * Admin override helper: run(reason?) is tried once; if the server asks for a reason (closed month, budget override) the
 * admin is prompted for it and the call is retried with it.
 */
export async function withReason(run) {
  try {
    return await run(undefined);
  } catch (e) {
    const msg = foundationError(e, '');
    if (/reason/i.test(msg)) {
      const reason = window.prompt(`${msg}\n\nReason for this change:`);
      if (reason && reason.trim()) return run(reason.trim());
    }
    throw e;
  }
}
