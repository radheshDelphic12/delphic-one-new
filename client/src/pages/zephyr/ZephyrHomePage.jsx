import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { ZEPHYR_MY_WORK, ZEPHYR_SECTIONS } from '../../lib/zephyr/sections.js';

function SectionCard({ section }) {
  const Icon = section.icon;
  return (
    <Link
      to={section.to}
      className="group flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-card"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 group-hover:bg-primary-100">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold text-tertiary-900">{section.label}</span>
          {!section.built && (
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700">
              Soon
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-sm text-tertiary-500">{section.blurb}</span>
      </span>
    </Link>
  );
}

export default function ZephyrHomePage() {
  const { user } = useAuth();
  const { me, loading, error } = useZephyr();

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (error || !me) {
    return (
      <div className="mt-6 rounded-2xl border bg-white p-6 text-sm text-tertiary-600">
        {error?.response?.data?.message || 'Your account has no Zephyr access yet. Ask an administrator to link your login.'}
      </div>
    );
  }

  const sections = me.role === 'staff' ? [ZEPHYR_MY_WORK] : ZEPHYR_SECTIONS.filter((s) => zxCan(me, s.cap));

  return (
    <div className="mt-4 space-y-6">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-base font-semibold text-tertiary-900">
            Welcome, {user?.name?.split(' ')[0] || 'there'}
            <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium capitalize text-primary-700">{me.role}</span>
          </h3>
          {zxCan(me, 'settings') && (
            <Link to="/zephyr/settings" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline">
              <Settings2 className="h-4 w-4" /> Zephyr setup
            </Link>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <SectionCard key={section.key} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
}
