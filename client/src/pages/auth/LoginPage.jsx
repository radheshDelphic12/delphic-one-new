import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, LifeBuoy, Loader2, Mail, Lock, Monitor, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { DEFAULT_DEV_PASSWORD, isQuickLoginEnabled } from '../../lib/testAccounts.js';
import {
  detectWorkspaceSlug,
  forgetWorkspace,
  getRecentWorkspaces,
  normalizeSlug,
  rememberWorkspace,
  resolveWorkspace,
  workspaceDomainSuffix,
} from '../../lib/workspace.js';
import FloatingField from '../../components/ui/FloatingField.jsx';
import WorkspaceLogo from '../../components/ui/WorkspaceLogo.jsx';
import { AuthShowcase, ShowcaseStrip } from './AuthShowcase.jsx';
import DevQuickLogin from './DevQuickLogin.jsx';
import SsoButtons from './SsoButtons.jsx';
import WorkspaceStep from './WorkspaceStep.jsx';
import { useAuthTheme } from './useAuthTheme.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

function ThemeToggle({ preference, onCycle }) {
  const Icon = THEME_ICON[preference];
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`Theme: ${preference} (click to change)`}
      aria-label={`Theme: ${preference}. Click to change.`}
      className="rounded-xl border border-tertiary-200 bg-white p-2 text-tertiary-500 shadow-soft transition hover:text-tertiary-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:shadow-none dark:hover:text-white"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const { pushInfo } = useAlerts();
  const navigate = useNavigate();
  const theme = useAuthTheme();

  const [stage, setStage] = useState('workspace'); // 'workspace' | 'credentials'
  const [workspace, setWorkspace] = useState(null); // resolved tenant branding, or null when skipped
  const [slugInput, setSlugInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [recents, setRecents] = useState(getRecentWorkspaces);
  const [detecting, setDetecting] = useState(() => Boolean(detectWorkspaceSlug()));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingQuick, setPendingQuick] = useState('');
  const formRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function chooseWorkspace(rawSlug) {
    const slug = normalizeSlug(rawSlug);
    if (!slug) {
      setWorkspaceError('Enter your workspace name, for example "acme".');
      return;
    }
    setChecking(true);
    setWorkspaceError('');
    try {
      const resolved = await resolveWorkspace(slug);
      if (!mounted.current) return;
      rememberWorkspace(resolved);
      setRecents(getRecentWorkspaces());
      setWorkspace(resolved);
      setErrors({});
      setStage('credentials');
    } catch (err) {
      if (!mounted.current) return;
      const status = err.response?.status;
      setWorkspaceError(
        status === 404
          ? `We couldn't find a workspace called "${slug}". Check the spelling or ask your admin.`
          : status === 429
            ? 'Too many attempts. Please wait a minute and try again.'
            : 'Could not reach the server. Check your connection and try again.'
      );
    } finally {
      if (mounted.current) setChecking(false);
    }
  }

  // Workspace from a shared link (?workspace=acme) or a tenant subdomain.
  useEffect(() => {
    const detected = detectWorkspaceSlug();
    if (!detected) return;
    setSlugInput(detected);
    chooseWorkspace(detected).finally(() => {
      if (mounted.current) setDetecting(false);
    });
    // Runs once on mount by design.
  }, []);

  if (user) return <Navigate to="/" replace />;

  function changeWorkspace() {
    setStage('workspace');
    setWorkspace(null);
    setErrors({});
    setPassword('');
  }

  function skipWorkspace() {
    setWorkspace(null);
    setErrors({});
    setStage('credentials');
  }

  // Restart the CSS shake without remounting the form (which would steal focus).
  function shake() {
    const node = formRef.current;
    if (!node) return;
    node.classList.remove('auth-shake');
    void node.offsetWidth; // force reflow so the animation can replay
    node.classList.add('auth-shake');
  }

  function failForm(message) {
    setErrors({ form: message });
    shake();
  }

  async function signIn(nextEmail, nextPassword, slug) {
    setSubmitting(true);
    try {
      const nextUser = await login(nextEmail, nextPassword, slug);
      if (nextUser?.active_org) rememberWorkspace(nextUser.active_org);
      navigate('/');
    } catch (err) {
      const status = err.response?.status;
      failForm(
        status === 401
          ? 'Incorrect email or password.'
          : status === 403
            ? err.response?.data?.message || 'Your account does not have access to that workspace.'
            : status === 429
              ? 'Too many sign-in attempts. Please wait a minute and try again.'
              : err.response?.data?.message || 'Sign-in failed. Please try again.'
      );
    } finally {
      if (mounted.current) {
        setSubmitting(false);
        setPendingQuick('');
      }
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = 'Enter a valid work email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      shake();
      return;
    }
    await signIn(email.trim(), password, workspace?.slug);
  }

  async function handleQuickLogin(account) {
    setPendingQuick(account.email);
    setEmail(account.email);
    setPassword(DEFAULT_DEV_PASSWORD);
    await signIn(account.email, DEFAULT_DEV_PASSWORD, undefined);
  }

  const showDevBar = isQuickLoginEnabled();

  return (
    <div className={theme.dark ? 'auth-dark' : ''}>
      <div className="login-page flex min-h-screen bg-white dark:bg-[#0a0f1a]">
        <AuthShowcase workspace={stage === 'credentials' ? workspace : null} />

        <main className={`relative flex min-w-0 flex-1 flex-col px-5 pt-5 sm:px-10 lg:px-12 xl:px-20 ${showDevBar ? 'pb-28' : 'pb-8'}`}>
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 lg:invisible">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white p-1.5 shadow-soft ring-1 ring-tertiary-100 dark:ring-white/10">
                <img src="/Delphic_D-logo_transparent.png" alt="" className="h-full w-full object-contain" />
              </span>
              <span className="font-login text-lg font-bold tracking-tight text-tertiary-900 dark:text-white">Delphic one</span>
            </div>
            <ThemeToggle preference={theme.preference} onCycle={theme.cycle} />
          </header>

          <div className="flex flex-1 items-center justify-center py-8">
            <div className="w-full max-w-[420px]">
              <ShowcaseStrip />

              {detecting ? (
                <div className="flex flex-col items-center gap-3 py-16 text-sm text-tertiary-500 dark:text-slate-400" role="status">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" aria-hidden="true" />
                  Finding your workspace…
                </div>
              ) : stage === 'workspace' ? (
                <div key="workspace" className="login-page__enter">
                  <WorkspaceStep
                    value={slugInput}
                    onChange={(value) => {
                      setSlugInput(value);
                      if (workspaceError) setWorkspaceError('');
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      chooseWorkspace(slugInput);
                    }}
                    checking={checking}
                    error={workspaceError}
                    recents={recents}
                    onPickRecent={(slug) => {
                      setSlugInput(slug);
                      chooseWorkspace(slug);
                    }}
                    onForgetRecent={(slug) => {
                      forgetWorkspace(slug);
                      setRecents(getRecentWorkspaces());
                    }}
                    onSkip={skipWorkspace}
                  />
                </div>
              ) : (
                <div key="credentials" className="login-page__enter">
                  {workspace ? (
                    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-tertiary-200 bg-tertiary-50/60 p-3 dark:border-white/10 dark:bg-white/5">
                      <WorkspaceLogo name={workspace.name} logoUrl={workspace.logo_url} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary-400 dark:text-slate-500">Signing in to</p>
                        <p className="truncate font-login text-lg font-bold leading-tight text-tertiary-900 dark:text-white">{workspace.name}</p>
                        <p className="truncate text-xs text-tertiary-500 dark:text-slate-400">
                          {workspace.slug}
                          {workspaceDomainSuffix}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={changeWorkspace}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 dark:text-primary-300 dark:hover:bg-white/10"
                      >
                        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Switch
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={changeWorkspace}
                      className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      Use a workspace name instead
                    </button>
                  )}

                  <h2 className="font-login text-2xl font-bold tracking-tight text-tertiary-900 dark:text-white">Welcome back</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-tertiary-500 dark:text-slate-400">
                    {workspace ? `Sign in to continue to ${workspace.name}.` : 'Sign in with your work email to continue.'}
                  </p>

                  <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                    <FloatingField
                      label="Work email"
                      icon={Mail}
                      type="email"
                      autoComplete="username"
                      autoFocus
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email || errors.form) setErrors({});
                      }}
                      error={errors.email}
                    />
                    <FloatingField
                      label="Password"
                      icon={Lock}
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password || errors.form) setErrors({});
                      }}
                      error={errors.password || errors.form}
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-primary w-full py-3 text-sm shadow-soft transition hover:shadow-card active:scale-[0.99]"
                    >
                      {submitting && !pendingQuick ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      {submitting && !pendingQuick ? 'Signing in…' : 'Sign in'}
                    </button>
                  </form>

                  <SsoButtons
                    disabled={submitting}
                    onUnavailable={(provider) =>
                      pushInfo(`${provider} sign-in isn't enabled for ${workspace?.name || 'this workspace'} yet. Ask your workspace admin to set it up, or sign in with your email and password.`)
                    }
                  />

                  <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-tertiary-500 dark:text-slate-400">
                    <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary-400 dark:text-slate-500" aria-hidden="true" />
                    <span>Part of more than one company? You can switch workspaces any time after signing in.</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          <footer className="flex items-center justify-center gap-1.5 text-xs text-tertiary-400 dark:text-slate-500">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            Need help signing in? Contact your workspace admin.
          </footer>
        </main>
      </div>

      {showDevBar && <DevQuickLogin onPick={handleQuickLogin} pendingEmail={pendingQuick} disabled={submitting} />}
    </div>
  );
}
