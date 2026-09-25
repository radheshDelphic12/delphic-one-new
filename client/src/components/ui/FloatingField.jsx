import { useId, useState } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

/**
 * Floating-label text input for auth-style forms.
 *
 * - The label sits inside the field and lifts on focus / when filled
 *   (`placeholder=" "` + `peer` — no JS state for the animation).
 * - `type="password"` gets an integrated show/hide toggle.
 * - `error` paints the field red and renders a small tooltip bubble beneath it,
 *   linked via aria-describedby so screen readers announce it.
 * - Has `dark:` classes, active under an ancestor `.auth-dark` (see tailwind.config.js).
 *
 * Args:
 *   label: floating label text.
 *   error: message string; falsy = no error.
 *   icon: optional Lucide icon component shown at the left.
 *   suffix: optional node rendered inside the right edge (e.g. ".delphic.one").
 *   ...props: forwarded to <input> (value, onChange, type, autoComplete, required, …).
 */
export default function FloatingField({ label, error, icon: Icon, suffix, id, type = 'text', className = '', ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';

  const ring = error
    ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
    : 'border-tertiary-200 focus:border-primary-500 focus:ring-primary-500/15 dark:border-white/10 dark:focus:border-primary-400 dark:focus:ring-primary-400/20';

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-400 dark:text-slate-500"
            aria-hidden="true"
          />
        )}
        <input
          {...props}
          id={inputId}
          type={isPassword && revealed ? 'text' : type}
          placeholder=" "
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={`float-input peer block w-full rounded-xl border bg-white pb-2 pt-[1.35rem] text-sm text-tertiary-900 shadow-soft outline-none transition placeholder-transparent focus:ring-4 dark:bg-white/5 dark:text-slate-100 dark:shadow-none ${
            Icon ? 'pl-10' : 'pl-3.5'
          } ${isPassword ? 'pr-11' : suffix ? 'pr-28' : 'pr-3.5'} ${ring}`}
        />
        <label
          htmlFor={inputId}
          className={`float-label pointer-events-none absolute top-3.5 origin-left text-sm text-tertiary-400 transition-all duration-150 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-primary-600 peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-[11px] dark:text-slate-500 dark:peer-focus:text-primary-300 ${
            Icon ? 'left-10' : 'left-3.5'
          } ${error ? 'peer-focus:text-danger-600' : ''}`}
        >
          {label}
        </label>

        {suffix && (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 select-none text-sm text-tertiary-400 dark:text-slate-500">
            {suffix}
          </span>
        )}
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            onClick={() => setRevealed((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-tertiary-400 transition hover:bg-tertiary-100 hover:text-tertiary-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="auth-row-in relative mt-2 flex items-start gap-1.5 rounded-lg bg-danger-50 px-2.5 py-1.5 text-xs font-medium text-danger-700 before:absolute before:-top-1 before:left-4 before:h-2 before:w-2 before:rotate-45 before:bg-danger-50 dark:bg-danger-500/15 dark:text-red-300 dark:before:bg-transparent"
        >
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
