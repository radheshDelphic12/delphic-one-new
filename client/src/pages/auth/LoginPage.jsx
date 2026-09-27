import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2, Mail, Lock } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { DEFAULT_DEV_PASSWORD, isQuickLoginEnabled } from '../../lib/testAccounts.js';
import { detectWorkspaceSlug, getRecentWorkspaces, rememberWorkspace } from '../../lib/workspace.js';
import FloatingField from '../../components/ui/FloatingField.jsx';
import WorkspaceLogo from '../../components/ui/WorkspaceLogo.jsx';
import DevQuickLogin from './DevQuickLogin.jsx';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const formRef = useRef(null);
  const mounted = useRef(true);
  // Set before login()'s network call, so it is committed before setUser.
  const [signedInHere, setSignedInHere] = useState(false);

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
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = 'Enter a valid work email address.';
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
        setErrors({ org: err.response?.data?.message || 'Could not open that workspace. Please try again.' });
        setPendingOrg('');
      }
    }
  }

  const showDevBar = isQuickLoginEnabled();
  const lastUsedSlug = getRecentWorkspaces()[0]?.slug;

  return (
    <div className={`flex min-h-screen flex-col bg-white px-4 pt-16 ${showDevBar ? 'pb-28' : 'pb-8'}`}>
      <main className="mx-auto w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center">
          <img src="/Delphic_D-logo_transparent.png" alt="" className="h-12 w-12 object-contain" />
          <p className="mt-3 font-login text-lg font-bold tracking-tight text-primary-700">Delphic One</p>
        </div>

        {!choosingOrg ? (
          <div className="mt-8">
            <h1 className="text-center font-login text-2xl font-bold tracking-tight text-tertiary-900">Sign in</h1>
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
              <button type="submit" disabled={submitting} className="btn-primary w-full py-3 text-sm">
                {submitting && !pendingQuick ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {submitting && !pendingQuick ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-8">
            <h1 className="text-center font-login text-2xl font-bold tracking-tight text-tertiary-900">Choose a workspace</h1>
            <div className="mt-6 flex flex-wrap justify-center gap-2" role="list">
              {user.memberships.map((membership) => {
                const lastUsed = membership.org.slug === lastUsedSlug;
                return (
                  <button
                    key={membership.org_id}
                    type="button"
                    role="listitem"
                    onClick={() => chooseOrg(membership)}
                    disabled={Boolean(pendingOrg)}
                    className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 text-sm font-medium text-tertiary-900 transition hover:border-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 disabled:opacity-60 ${
                      lastUsed ? 'border-primary-600' : 'border-tertiary-200'
                    }`}
                  >
                    {pendingOrg === membership.org_id ? (
                      <Loader2 className="m-1.5 h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
                    ) : (
                      <WorkspaceLogo name={membership.org.name} logoUrl={membership.org.logo_url} size="sm" className="rounded-full" />
                    )}
                    {membership.org.name}
                  </button>
                );
              })}
            </div>
            {errors.org ? <p className="mt-4 text-center text-sm text-red-600">{errors.org}</p> : null}
          </div>
        )}
      </main>

      <footer className="mt-auto pt-10 text-center text-xs text-tertiary-400">Need help signing in? Contact your admin.</footer>

      {showDevBar && <DevQuickLogin onPick={handleQuickLogin} pendingEmail={pendingQuick} disabled={submitting} />}
    </div>
  );
}
