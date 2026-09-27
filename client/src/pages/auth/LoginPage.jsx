import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { DEFAULT_DEV_PASSWORD, isQuickLoginEnabled } from '../../lib/testAccounts.js';
import { detectWorkspaceSlug, getRecentWorkspaces, rememberWorkspace } from '../../lib/workspace.js';
import PasswordInput from '../../components/ui/PasswordInput.jsx';
import WorkspaceLogo from '../../components/ui/WorkspaceLogo.jsx';
import DevQuickLogin from './DevQuickLogin.jsx';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INPUT_CLASS =
  'w-full rounded-xl border border-tertiary-200 bg-white px-3.5 py-3 text-sm text-tertiary-900 shadow-soft transition placeholder:text-tertiary-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/15';

export default function LoginPage() {
  const { user, login, switchOrg } = useAuth();
  const navigate = useNavigate();

  // A shared link (?workspace=acme) or tenant subdomain still signs straight
  // into that workspace; otherwise people with 2+ orgs pick one after sign-in.
  const [linkedSlug] = useState(detectWorkspaceSlug);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [pendingQuick, setPendingQuick] = useState('');
  const [pendingOrg, setPendingOrg] = useState('');
  // Set before login()'s network call, so it is committed before setUser.
  const [signedInHere, setSignedInHere] = useState(false);
  const formRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Just signed in with 2+ orgs: pick one here. Anyone else already signed in
  // (including a returning session) goes straight to the app.
  const choosingOrg = Boolean(user) && signedInHere && !linkedSlug && (user.memberships?.length || 0) > 1;
  if (user && !choosingOrg) return <Navigate to="/" replace />;

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
    setSignedInHere(true);
    try {
      const nextUser = await login(nextEmail, nextPassword, slug);
      if ((nextUser?.memberships?.length || 0) > 1 && !slug) return; // org pills render next
      if (nextUser?.active_org) rememberWorkspace(nextUser.active_org);
      navigate('/');
    } catch (err) {
      if (mounted.current) setSignedInHere(false);
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
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      shake();
      return;
    }
    await signIn(email.trim(), password, linkedSlug || undefined);
  }

  async function handleQuickLogin(account) {
    setPendingQuick(account.email);
    setEmail(account.email);
    setPassword(DEFAULT_DEV_PASSWORD);
    await signIn(account.email, DEFAULT_DEV_PASSWORD, undefined);
  }

  async function chooseOrg(membership) {
    setPendingOrg(membership.org_id);
    try {
      await switchOrg(membership.org_id);
      rememberWorkspace(membership.org);
      navigate('/');
    } catch (err) {
      if (mounted.current) {
        setErrors({ org: err.response?.data?.message || 'Could not open that company. Please try again.' });
        setPendingOrg('');
      }
    }
  }

  const showDevBar = isQuickLoginEnabled();
  const lastUsedSlug = getRecentWorkspaces()[0]?.slug;

  return (
    <div className={`flex min-h-screen flex-col lg:flex-row ${showDevBar ? 'pb-28 lg:pb-0' : ''}`}>
      {/* Brand column: owns the illustration */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-800 via-primary-700 to-[#0c2f58] px-6 pb-8 pt-10 text-white sm:px-10 lg:min-h-screen lg:w-[52%] lg:px-14 lg:py-12 xl:px-20">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5 shadow-soft sm:h-12 sm:w-12">
            <img src="/Delphic_D-logo_transparent.png" alt="" className="h-full w-full object-contain" />
          </span>
          <p className="font-login text-[1.65rem] font-semibold leading-none tracking-tight sm:text-3xl">Delphic one</p>
        </div>

        <div className="mt-12 max-w-md space-y-2.5 sm:mt-14 lg:mt-16">
          <span className="inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">
            New · Multi-company
          </span>
          <h1 className="font-login text-base font-medium leading-relaxed text-white/85 sm:text-lg">
            All your companies, one sign-in.
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-white/55">
            Run every Delphic company from one account and switch between them without signing out.
          </p>
        </div>

        <div className="pointer-events-none mt-2 hidden flex-1 items-end justify-center lg:flex" aria-hidden="true">
          <img src="/undraw_dashboard_p93p.svg" alt="" className="w-full max-w-xl object-contain opacity-90" />
        </div>

        <p className="mt-6 hidden text-xs text-white/40 lg:mt-8 lg:block">© {new Date().getFullYear()} Delphic · Delphic one</p>
      </section>

      {/* Sign-in */}
      <main className="flex flex-1 items-center justify-center bg-white px-4 py-10 sm:px-8 lg:px-12 xl:px-16">
        <div className="w-full max-w-[400px]">
          {!choosingOrg ? (
            <>
              <h2 className="font-login text-lg font-semibold tracking-tight text-tertiary-900 sm:text-xl">Sign in</h2>
              <p className="mt-1 text-sm leading-relaxed text-tertiary-500">Use your Delphic email to continue</p>

              <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
                <div>
                  <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-tertiary-700">
                    Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email || errors.form) setErrors({});
                    }}
                    className={INPUT_CLASS}
                    placeholder="you@delphic.in"
                  />
                  {errors.email ? <p className="mt-1.5 text-xs text-red-600">{errors.email}</p> : null}
                </div>

                <div>
                  <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-tertiary-700">
                    Password
                  </label>
                  <PasswordInput
                    id="login-password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password || errors.form) setErrors({});
                    }}
                    className={INPUT_CLASS}
                    placeholder="••••••••"
                  />
                  {errors.password || errors.form ? (
                    <p className="mt-1.5 text-xs text-red-600">{errors.password || errors.form}</p>
                  ) : null}
                </div>

                <button type="submit" disabled={submitting} className="btn-primary mt-1 w-full py-3 text-sm shadow-soft">
                  {submitting && !pendingQuick ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {submitting && !pendingQuick ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="font-login text-lg font-semibold tracking-tight text-tertiary-900 sm:text-xl">Choose a company</h2>
              <p className="mt-1 text-sm leading-relaxed text-tertiary-500">You can switch any time from the sidebar.</p>
              <div className="mt-5 flex flex-wrap gap-2" role="list">
                {user.memberships.map((membership) => (
                  <button
                    key={membership.org_id}
                    type="button"
                    role="listitem"
                    onClick={() => chooseOrg(membership)}
                    disabled={Boolean(pendingOrg)}
                    className={`inline-flex items-center gap-2 rounded-full border bg-white py-1.5 pl-1.5 pr-4 text-sm font-medium text-tertiary-900 transition hover:border-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 disabled:opacity-60 ${
                      membership.org.slug === lastUsedSlug ? 'border-primary-600' : 'border-tertiary-200'
                    }`}
                  >
                    {pendingOrg === membership.org_id ? (
                      <Loader2 className="m-1.5 h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
                    ) : (
                      <WorkspaceLogo name={membership.org.name} logoUrl={membership.org.logo_url} size="sm" className="rounded-full" />
                    )}
                    {membership.org.name}
                  </button>
                ))}
              </div>
              {errors.org ? <p className="mt-4 text-sm text-red-600">{errors.org}</p> : null}
            </>
          )}
        </div>
      </main>

      {showDevBar && <DevQuickLogin onPick={handleQuickLogin} pendingEmail={pendingQuick} disabled={submitting} />}
    </div>
  );
}
