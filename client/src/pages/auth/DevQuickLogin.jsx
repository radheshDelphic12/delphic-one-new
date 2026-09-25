import { useState } from 'react';
import { Building2, Check, ChevronUp, Copy, FlaskConical, Loader2, ShieldCheck, Briefcase, TrendingUp, UserSearch } from 'lucide-react';
import { DEFAULT_DEV_PASSWORD, QUICK_LOGIN_ACCOUNTS } from '../../lib/testAccounts.js';

const OPEN_KEY = 'delphic_devbar_open';

// Full class strings per role so Tailwind can see them (no interpolation).
const ROLE_STYLE = {
  admin: { icon: ShieldCheck, badge: 'bg-violet-500/15 text-violet-300 ring-violet-400/30' },
  multi_org: { icon: Building2, badge: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-400/30' },
  bda: { icon: Briefcase, badge: 'bg-amber-500/15 text-amber-300 ring-amber-400/30' },
  sales: { icon: TrendingUp, badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' },
  recruiter: { icon: UserSearch, badge: 'bg-sky-500/15 text-sky-300 ring-sky-400/30' },
};

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Dev-only quick sign-in, as a collapsible floating bar instead of a boxed
 * form section. Rendered by LoginPage only when isQuickLoginEnabled().
 * Signs in to the account's DEFAULT workspace (no workspace step), which is
 * what lets "Multi-Org Admin" land you in one org with a second to switch to.
 */
export default function DevQuickLogin({ onPick, pendingEmail, disabled }) {
  const [open, setOpen] = useState(readOpen);
  const [copied, setCopied] = useState(false);

  function toggle() {
    setOpen((value) => {
      try {
        localStorage.setItem(OPEN_KEY, value ? '0' : '1');
      } catch {
        // Persisting the bar's state is a convenience only.
      }
      return !value;
    });
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(DEFAULT_DEV_PASSWORD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin); the password is shown on screen anyway.
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-3">
      <div className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/95 text-slate-100 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="dev-quick-login"
          className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
        >
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-inset ring-amber-400/30">
            <FlaskConical className="h-3 w-3" aria-hidden="true" /> Dev
          </span>
          <span className="flex-1 text-sm font-medium">Quick sign-in as a seeded role</span>
          <span className="hidden text-xs text-slate-400 sm:inline">{QUICK_LOGIN_ACCOUNTS.length} accounts</span>
          <ChevronUp className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>

        {open && (
          <div id="dev-quick-login" className="auth-row-in max-h-[50vh] overflow-y-auto border-t border-white/10 p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                Password for all: <span className="font-mono font-medium text-slate-200">{DEFAULT_DEV_PASSWORD}</span>
              </span>
              <button
                type="button"
                onClick={copyPassword}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-300 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {QUICK_LOGIN_ACCOUNTS.map((account) => {
                const style = ROLE_STYLE[account.role] || ROLE_STYLE.recruiter;
                const Icon = style.icon;
                const pending = pendingEmail === account.email;
                return (
                  <button
                    key={account.email}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(account)}
                    className="group flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-left transition hover:border-white/25 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-50"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${style.badge}`}>
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{account.label}</span>
                      <span className="block truncate text-[11px] text-slate-400">{pending ? 'Signing in…' : account.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
