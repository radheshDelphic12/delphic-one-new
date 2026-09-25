import { ArrowRight, Building2, Loader2, X } from 'lucide-react';
import FloatingField from '../../components/ui/FloatingField.jsx';
import WorkspaceLogo from '../../components/ui/WorkspaceLogo.jsx';
import { workspaceDomainSuffix } from '../../lib/workspace.js';

/**
 * Step 1 of sign-in: which company/workspace. Typing a slug (or pasting a full
 * workspace URL) resolves it against the public branding endpoint; previously
 * used workspaces are one click away, which is the sign-in-screen half of
 * "switch workspace" for people who belong to several companies.
 */
export default function WorkspaceStep({ value, onChange, onSubmit, checking, error, recents, onPickRecent, onForgetRecent, onSkip }) {
  return (
    <div>
      <h2 className="font-login text-2xl font-bold tracking-tight text-tertiary-900 dark:text-white">Find your workspace</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-tertiary-500 dark:text-slate-400">
        Enter your company&apos;s workspace name to continue to its sign-in.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FloatingField
          label="Workspace"
          icon={Building2}
          suffix={workspaceDomainSuffix || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          error={error}
          autoComplete="organization"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
        />
        <button
          type="submit"
          disabled={checking || !value.trim()}
          className="btn-primary w-full py-3 text-sm shadow-soft transition hover:shadow-card active:scale-[0.99]"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {checking ? 'Checking…' : 'Continue'}
          {!checking && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
      </form>

      {recents.length > 0 && (
        <div className="mt-7">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-tertiary-400 dark:text-slate-500">Recent workspaces</p>
          <ul className="space-y-2">
            {recents.map((workspace) => (
              <li key={workspace.slug} className="group relative">
                <button
                  type="button"
                  disabled={checking}
                  onClick={() => onPickRecent(workspace.slug)}
                  className="flex w-full items-center gap-3 rounded-xl border border-tertiary-200 bg-white p-2.5 pr-10 text-left shadow-soft transition hover:border-primary-300 hover:bg-primary-50/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:shadow-none dark:hover:border-primary-400/50 dark:hover:bg-white/10"
                >
                  <WorkspaceLogo name={workspace.name} logoUrl={workspace.logo_url} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-tertiary-900 dark:text-slate-100">{workspace.name}</span>
                    <span className="block truncate text-xs text-tertiary-500 dark:text-slate-400">
                      {workspace.slug}
                      {workspaceDomainSuffix}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-tertiary-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600 dark:text-slate-600" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${workspace.name} from recent workspaces`}
                  title="Remove from recent"
                  onClick={() => onForgetRecent(workspace.slug)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-tertiary-300 opacity-0 transition hover:bg-tertiary-100 hover:text-tertiary-700 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onSkip}
        className="mt-6 text-sm font-medium text-primary-700 hover:underline focus:outline-none focus-visible:underline dark:text-primary-300"
      >
        I don&apos;t know my workspace
      </button>
    </div>
  );
}
