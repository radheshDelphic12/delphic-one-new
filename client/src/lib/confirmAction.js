// Promise-based replacements for window.confirm() and window.prompt(). Rendered by <ConfirmHost /> (mounted once in main.jsx).
//   if (!(await confirmAction('Delete this entry?'))) return;
//   const reason = await promptAction('Reason for deleting this entry (required):');   // string, or null on Cancel / Escape
// confirmAction resolves true on confirm, false on Cancel / Escape / backdrop click. If no host is mounted
// (tests, odd entry points) both fall back to the native dialogs so behaviour never silently breaks.

let listener = null;

export function subscribeConfirm(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

const DANGER_WORDS = /^\s*(delete|remove|reset|archive|discard|undo|revoke|restore|put this company back|cancel|reject|lock|void)\b/i;

/**
 * Drop-in for window.prompt(message, defaultValue): the same styled dialog with a text box. Resolves the typed text (a string), or null on
 * Cancel / Escape / backdrop click. A message that says "(required)" keeps the button disabled until something is typed (a "reason" needs 3
 * characters); a default that looks like YYYY-MM-DD gets a date picker; a message that starts with Delete / Remove / Cancel ... is styled red.
 */
export function promptAction(message, defaultValue = '', options = {}) {
  const text = typeof message === 'string' ? message : String(message ?? '');
  const initial = defaultValue == null ? '' : String(defaultValue);
  if (!listener) {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt(text, initial) : null);
  }
  const danger = options.danger ?? DANGER_WORDS.test(text);
  const required = options.required ?? /\brequired\b/i.test(text);
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(initial);
  const asksWhy = /reason|why/i.test(text);
  const title = options.title || (danger ? 'Please confirm' : asksWhy ? 'Reason' : 'Enter a value');
  return new Promise((resolve) => {
    listener({
      prompt: true,
      message: text.split('\n').filter((l) => l.trim()).join('\n') || text,
      title,
      confirmLabel: options.confirmLabel || (/^\s*delete\b/i.test(text) ? 'Delete' : /^\s*remove\b/i.test(text) ? 'Remove' : /^\s*cancel\b/i.test(text) ? 'Cancel it' : 'OK'),
      danger,
      required,
      minLength: required ? (asksWhy ? 3 : 1) : 0,
      inputType: isDate ? 'date' : 'text',
      multiline: options.multiline ?? /reason|why|note/i.test(text),
      defaultValue: initial,
      resolve,
    });
  });
}

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
