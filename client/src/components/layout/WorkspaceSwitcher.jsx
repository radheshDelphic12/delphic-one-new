import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, Loader2, Network, Plus, Search } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import WorkspaceLogo from '../ui/WorkspaceLogo.jsx';

const SEARCH_THRESHOLD = 6;

/**
 * Slack/Linear-style workspace (tenant) switcher for the top of the sidebar.
 *
 * - One membership: a static brand block (nothing to switch to).
 * - Several: a dropdown listing every company the user belongs to, with logo,
 *   role and a check on the active one; searchable once the list is long.
 * - Switching re-issues the token for that org (`switchOrg`) and then returns
 *   to the dashboard — an org-scoped record page from the old workspace would
 *   otherwise stay on screen showing (or 404-ing on) the previous company's data.
 * - Group superadmins also get a Group overview shortcut; admins can create an org.
 */
export default function WorkspaceSwitcher({ collapsed = false, onCreate }) {
  const { user, switchOrg, memberships, activeOrg, isGroupSuperadmin } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // On the Group Dashboard the switcher says so, instead of showing whichever company happens to be active underneath.
  const groupMode = isGroupSuperadmin && pathname.startsWith('/group-overview');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [switchingId, setSwitchingId] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? memberships.filter((m) => m.org.name.toLowerCase().includes(needle)) : memberships;
  }, [memberships, query]);

  if (!activeOrg) return null;
  const canSwitch = memberships.length > 1;
  const isAdmin = user?.role === 'admin';
  const hasActions = isGroupSuperadmin || (isAdmin && Boolean(onCreate));

  async function choose(orgId) {
    if (orgId === activeOrg.id) {
      setOpen(false);
      if (groupMode) navigate('/');
      return;
    }
    setSwitchingId(orgId);
    try {
      await switchOrg(orgId);
      setOpen(false);
      setQuery('');
      navigate('/');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to switch workspace'), 'Something went wrong');
    } finally {
      setSwitchingId(null);
    }
  }

  const brand = (
    <>
      <WorkspaceLogo name={groupMode ? 'All Companies' : activeOrg.name} logoUrl={groupMode ? '/group-logo.svg' : activeOrg.logo_url} size="md" />
      {!collapsed && (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-heading text-sm font-bold tracking-tight text-tertiary-900">{groupMode ? 'All Companies' : activeOrg.name}</span>
          <span className="block truncate text-[11px] text-tertiary-500">
            {groupMode ? `Group view - ${memberships.length} companies` : canSwitch ? `${memberships.length} workspaces` : 'Workspace'}
          </span>
        </span>
      )}
    </>
  );

  if (!canSwitch && !hasActions) {
    return <div className={`flex items-center gap-2.5 px-1 py-1 ${collapsed ? 'justify-center' : ''}`}>{brand}</div>;
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? activeOrg.name : undefined}
        className={`flex w-full items-center gap-2.5 rounded-xl border border-transparent px-1.5 py-1.5 transition hover:border-tertiary-200 hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-500/20 ${
          open ? 'border-tertiary-200 bg-white shadow-soft' : ''
        } ${collapsed ? 'justify-center' : ''}`}
      >
        {brand}
        {!collapsed && <ChevronsUpDown className="h-4 w-4 shrink-0 text-tertiary-400" aria-hidden="true" />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch workspace"
          className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-tertiary-200 bg-white shadow-drawer"
        >
          {isGroupSuperadmin && (
            <div className="px-1.5 pt-1.5">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  navigate('/group-overview');
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm font-semibold text-tertiary-900 transition hover:bg-tertiary-50 ${groupMode ? 'bg-primary-50/60' : ''}`}
              >
                <Network className="h-4 w-4 text-primary-600" aria-hidden="true" />
                <span className="flex-1">All Companies - Group dashboard</span>
                {groupMode && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />}
              </button>
            </div>
          )}
          <p className="px-3.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-tertiary-400">Companies</p>

          {memberships.length > SEARCH_THRESHOLD && (
            <div className="relative px-2.5 pb-1.5">
              <Search className="pointer-events-none absolute left-5 top-2 h-3.5 w-3.5 text-tertiary-400" aria-hidden="true" />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workspaces"
                aria-label="Search workspaces"
                className="w-full rounded-lg border border-tertiary-200 py-1.5 pl-8 pr-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/15"
              />
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto px-1.5 pb-1.5">
            {filtered.length === 0 && <li className="px-2 py-3 text-xs text-tertiary-400">No matching workspace</li>}
            {filtered.map((membership) => {
              const active = !groupMode && membership.org.id === activeOrg.id;
              return (
                <li key={membership.org.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    disabled={switchingId !== null}
                    onClick={() => {
                      if (membership.org.enabled_modules?.includes('coming_soon')) {
                        setOpen(false);
                        pushInfo(`${membership.org.name} is coming soon. It will appear here once it is ready.`);
                        return;
                      }
                      choose(membership.org.id);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-tertiary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 disabled:opacity-60 ${
                      active ? 'bg-primary-50/60' : ''
                    }`}
                  >
                    <WorkspaceLogo name={membership.org.name} logoUrl={membership.org.logo_url} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-tertiary-900">{membership.org.name}</span>
                      <span className="block truncate text-[11px] capitalize text-tertiary-500">{membership.org.enabled_modules?.includes('coming_soon') ? 'Coming soon' : membership.role}</span>
                    </span>
                    {switchingId === membership.org.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
                    ) : (
                      active && <Check className="h-4 w-4 text-primary-600" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {hasActions && (
            <div className="space-y-0.5 border-t border-tertiary-100 p-1.5">
              {isAdmin && onCreate && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onCreate();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-medium text-tertiary-700 transition hover:bg-tertiary-50"
                >
                  <Plus className="h-4 w-4 text-tertiary-400" aria-hidden="true" />
                  Create organization
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
