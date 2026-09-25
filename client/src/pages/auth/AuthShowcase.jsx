import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Receipt, Users } from 'lucide-react';
import WorkspaceLogo from '../../components/ui/WorkspaceLogo.jsx';

/**
 * Sign-in showcase. Everything numeric here is an ILLUSTRATIVE PREVIEW of what
 * the product looks like, not real data (and the panel says so). The motion is
 * decorative only: one slow interval that is skipped entirely for users who
 * prefer reduced motion, and cleared on unmount.
 */

const RECRUITERS = [24, 25, 26, 25, 27, 26];
const BILLING = ['18.4L', '18.6L', '18.9L', '19.1L', '19.4L', '19.6L'];
const SYNC = [96, 97, 98, 98, 99, 98];
const FEED = [
  { icon: CheckCircle2, text: 'Timesheet approved', meta: 'Project Atlas · 8.0h', tone: 'text-emerald-300' },
  { icon: Receipt, text: 'Invoice generated', meta: 'Northwind · Sep 2026', tone: 'text-sky-300' },
  { icon: Users, text: 'New hire onboarded', meta: 'Engineering · Indore', tone: 'text-violet-300' },
  { icon: Clock, text: 'Payroll draft opened', meta: 'Delphic · Aug 2026', tone: 'text-amber-300' },
  { icon: CheckCircle2, text: 'Leave approved', meta: 'Casual · 2 days', tone: 'text-emerald-300' },
  { icon: Receipt, text: 'Vendor payment paid', meta: 'Contractor · INR', tone: 'text-sky-300' },
];

function useTick(intervalMs = 2600) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

function MetricCard({ icon: Icon, label, value, hint, children }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.07] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/55">{label}</span>
        <Icon className="h-3.5 w-3.5 text-white/45" aria-hidden="true" />
      </div>
      <p className="mt-2 font-login text-2xl font-bold tabular-nums tracking-tight text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-white/50">{hint}</p>
      {children}
    </div>
  );
}

function Sparkline() {
  // pathLength=1 lets the CSS draw-on animation work without measuring the path.
  return (
    <svg viewBox="0 0 320 90" className="h-24 w-full" role="img" aria-label="Illustrative revenue and cost trend">
      <defs>
        <linearGradient id="auth-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[20, 45, 70].map((y) => (
        <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="white" strokeOpacity="0.08" />
      ))}
      <path d="M0 70 C40 66 60 50 100 52 S170 30 210 34 S280 14 320 10 L320 90 L0 90 Z" fill="url(#auth-area)" />
      <path
        pathLength="1"
        className="auth-spark"
        d="M0 70 C40 66 60 50 100 52 S170 30 210 34 S280 14 320 10"
        fill="none"
        stroke="#7dd3fc"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        pathLength="1"
        className="auth-spark"
        d="M0 78 C50 76 80 68 120 66 S190 58 230 52 S290 44 320 40"
        fill="none"
        stroke="#fcd34d"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1"
        opacity="0.85"
      />
    </svg>
  );
}

/** Left brand panel (large screens). `workspace` is the resolved tenant, if any. */
export function AuthShowcase({ workspace }) {
  const tick = useTick();
  const feed = [0, 1, 2, 3].map((i) => ({ ...FEED[(tick + i) % FEED.length], key: tick + i }));

  return (
    <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0b2a52] via-primary-800 to-[#061528] p-10 text-white lg:flex lg:w-[54%] xl:p-14">
      <div className="login-page__grain pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 50% at 15% 10%, rgb(56 189 248 / 0.28), transparent 60%), radial-gradient(ellipse 55% 45% at 90% 85%, rgb(99 102 241 / 0.35), transparent 60%)',
        }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, black, transparent)',
        }}
        aria-hidden="true"
      />

      <header className="login-page__enter login-page__enter--1 relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1.5 shadow-soft">
            <img src="/Delphic_D-logo_transparent.png" alt="" className="h-full w-full object-contain" />
          </span>
          <span className="font-login text-xl font-bold tracking-tight">Delphic one</span>
        </div>
        {workspace && (
          <span className="auth-row-in inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 py-1 pl-1 pr-3 text-sm font-medium backdrop-blur">
            <WorkspaceLogo name={workspace.name} logoUrl={workspace.logo_url} size="sm" />
            {workspace.name}
          </span>
        )}
      </header>

      <div className="login-page__enter login-page__enter--2 relative z-10 max-w-xl">
        <h1 className="font-login text-3xl font-extrabold leading-tight tracking-tight xl:text-4xl">
          One platform for every company you run.
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65 xl:text-base">
          Recruitment, people, timesheets, billing and payroll - separated per company, rolled up for the group.
        </p>

        <div className="relative mt-8">
          <div className="auth-float rounded-2xl border border-white/15 bg-white/10 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
              </div>
              <span className="text-xs font-medium text-white/60">Group overview</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                <span className="auth-live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                Live
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <MetricCard icon={Users} label="Active recruiters" value={RECRUITERS[tick % RECRUITERS.length]} hint="across 3 companies" />
              <MetricCard icon={Receipt} label="Multi-project billing" value={`₹${BILLING[tick % BILLING.length]}`} hint="6 projects · 2 currencies" />
              <MetricCard icon={Clock} label="Timesheet sync" value={`${SYNC[tick % SYNC.length]}%`} hint="approved this week">
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-emerald-400 transition-all duration-700" style={{ width: `${SYNC[tick % SYNC.length]}%` }} />
                </div>
              </MetricCard>
            </div>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-[1.35fr_1fr]">
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                <div className="flex items-center justify-between text-[11px] text-white/55">
                  <span className="font-medium uppercase tracking-wider">Revenue vs cost</span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-sky-300" />Revenue</span>
                    <span className="inline-flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-300" />Cost</span>
                  </span>
                </div>
                <Sparkline />
              </div>
              <ul className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.06] p-3" aria-label="Illustrative recent activity">
                <li className="text-[11px] font-medium uppercase tracking-wider text-white/55">Live activity</li>
                {feed.map(({ icon: Icon, text, meta, tone, key }) => (
                  <li key={key} className="auth-row-in flex items-start gap-2">
                    <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden="true" />
                    <span className="min-w-0 text-xs leading-tight">
                      <span className="block truncate font-medium text-white/90">{text}</span>
                      <span className="block truncate text-[10px] text-white/45">{meta}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="auth-float auth-float--slow absolute -bottom-5 -right-3 flex items-center gap-2.5 rounded-xl border border-white/20 bg-[#0b2a52]/80 py-2 pl-2 pr-3.5 shadow-xl backdrop-blur-xl xl:-right-6">
            <span className="flex -space-x-2" aria-hidden="true">
              <WorkspaceLogo name="Delphic" size="sm" className="ring-2 ring-[#0b2a52]" />
              <WorkspaceLogo name="Acconcy" size="sm" className="ring-2 ring-[#0b2a52]" />
              <WorkspaceLogo name="+" size="sm" className="ring-2 ring-[#0b2a52]" />
            </span>
            <span className="text-xs leading-tight">
              <span className="block font-semibold">Multiple companies</span>
              <span className="block text-white/55">Switch workspace in one click</span>
            </span>
          </div>
        </div>
      </div>

      <footer className="login-page__enter login-page__enter--3 relative z-10 flex items-center justify-between text-xs text-white/40">
        <span>© {new Date().getFullYear()} Delphic · Delphic one</span>
        <span>Illustrative preview</span>
      </footer>
    </section>
  );
}

/** Compact version for tablets, shown above the form when the full panel is hidden. */
export function ShowcaseStrip() {
  return (
    <div className="mb-6 hidden grid-cols-3 gap-2 md:grid lg:hidden" aria-hidden="true">
      {[
        { icon: Users, label: 'Recruiters', value: '26' },
        { icon: Receipt, label: 'Billing', value: '₹18.9L' },
        { icon: Clock, label: 'Timesheets', value: '98%' },
      ].map(({ icon: Icon, label, value }) => (
        <div key={label} className="rounded-xl border border-tertiary-100 bg-white p-3 shadow-soft dark:border-white/10 dark:bg-white/5">
          <Icon className="h-4 w-4 text-primary-600 dark:text-primary-300" />
          <p className="mt-1.5 font-login text-lg font-bold tabular-nums text-tertiary-900 dark:text-slate-100">{value}</p>
          <p className="text-[11px] text-tertiary-500 dark:text-slate-400">{label}</p>
        </div>
      ))}
    </div>
  );
}
