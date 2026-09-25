const BUTTON =
  'inline-flex w-full items-center justify-center gap-2.5 rounded-xl border border-tertiary-200 bg-white px-3 py-2.5 text-sm font-medium text-tertiary-800 shadow-soft transition hover:bg-tertiary-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 active:scale-[0.99] disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:shadow-none dark:hover:bg-white/10';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.21-2.36H12v4.47h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.56-5.17 3.56-8.74z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.09C6.23 6.86 8.88 4.75 12 4.75z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

/**
 * Enterprise SSO entry points (Google Workspace, Microsoft Entra ID / SAML).
 *
 * There is no SSO backend in this codebase yet, so `onUnavailable` decides what
 * a click does — LoginPage tells the user plainly that SSO has to be set up by
 * their workspace admin, instead of pretending to start a flow that doesn't exist.
 */
export default function SsoButtons({ onUnavailable, disabled }) {
  return (
    <div>
      <div className="relative my-5 flex items-center" role="separator" aria-label="or continue with">
        <span className="h-px flex-1 bg-tertiary-200 dark:bg-white/10" />
        <span className="px-3 text-[11px] font-medium uppercase tracking-wider text-tertiary-400 dark:text-slate-500">or continue with</span>
        <span className="h-px flex-1 bg-tertiary-200 dark:bg-white/10" />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button type="button" disabled={disabled} className={BUTTON} onClick={() => onUnavailable('Google Workspace')} title="Requires SSO to be set up by your workspace admin">
          <GoogleMark />
          Google Workspace
        </button>
        <button type="button" disabled={disabled} className={BUTTON} onClick={() => onUnavailable('Microsoft Entra ID')} title="Requires SSO to be set up by your workspace admin">
          <MicrosoftMark />
          Microsoft Entra ID
        </button>
      </div>
    </div>
  );
}
