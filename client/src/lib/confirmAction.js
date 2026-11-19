// Promise-based replacement for window.confirm(). Rendered by <ConfirmHost /> (mounted once in main.jsx).
//   if (!(await confirmAction('Delete this entry?'))) return;
// Resolves true on confirm, false on Cancel / Escape / backdrop click. If no host is mounted
// (tests, odd entry points) it falls back to the native dialog so behaviour never silently breaks.

let listener = null;

export function subscribeConfirm(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

const DANGER_WORDS = /^\s*(delete|remove|reset|archive|discard|undo|revoke|restore|put this company back|cancel|reject|lock|void)\b/i;

export function confirmAction(message, options = {}) {
  const text = typeof message === 'string' ? message : String(message ?? '');
  if (!listener) {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : false);
  }
  const danger = options.danger ?? DANGER_WORDS.test(text);
  return new Promise((resolve) => {
    listener({
      message: text,
      title: options.title || (danger ? 'Please confirm' : 'Are you sure?'),
      confirmLabel: options.confirmLabel || (/^\s*delete\b/i.test(text) ? 'Delete' : /^\s*remove\b/i.test(text) ? 'Remove' : 'Yes, continue'),
      danger,
      resolve,
    });
  });
}
