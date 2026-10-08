import { Navigate, useLocation } from 'react-router-dom';
import { Hammer } from 'lucide-react';
import { useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { ZEPHYR_MY_WORK, ZEPHYR_SECTIONS } from '../../lib/zephyr/sections.js';

/**
 * Placeholder for a Zephyr section whose build phase has not landed yet.
 * Enforces the role capability so a typed URL cannot reach a section the
 * role may not see.
 */
export default function ZephyrSectionPage() {
  const { pathname } = useLocation();
  const { me, loading } = useZephyr();
  const section = [...ZEPHYR_SECTIONS, ZEPHYR_MY_WORK].find((s) => pathname.startsWith(s.to));

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading…</div>;
  if (!section || !me || !zxCan(me, section.cap)) return <Navigate to="/zephyr" replace />;

  const Icon = section.icon || Hammer;
  return (
    <div className="mt-6 flex flex-col items-center rounded-3xl border bg-white px-6 py-16 text-center shadow-soft">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
        <Icon className="h-7 w-7" />
      </span>
      <h2 className="mt-4 font-heading text-lg font-semibold text-tertiary-900">{section.label}</h2>
      <p className="mt-1 max-w-md text-sm text-tertiary-500">{section.blurb}</p>
      <span className="mt-4 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary-700">
        Coming soon · phase {section.phase}
      </span>
    </div>
  );
}
