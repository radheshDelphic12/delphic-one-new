import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Menu, MoreVertical, Network, Settings, X } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import WorkspaceLogo from '../ui/WorkspaceLogo.jsx';
import { orgLogo } from '../../lib/orgLogo.js';
import { useNotifications } from '../../lib/notifications/notificationsContext.jsx';
import { usePermissions } from '../../lib/permissions.js';
import Avatar from '../ui/Avatar.jsx';
import NotificationBell from '../notifications/NotificationBell.jsx';
import { headerSubtitleForPath, headerTitleForPath } from './headerTitle.js';
import { NAV_ITEMS } from './navItems.js';
import Drawer from '../ui/Drawer.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';

import { canSeeMeetingsCalendar } from '../../lib/departments.js';
import { isZephyrOrg, useZephyr, zxCan } from '../../lib/zephyr/useZephyr.js';
import { zephyrNavFor } from '../../lib/zephyr/sections.js';
import { gulatiNavFor } from '../../lib/gulati/sections.js';
import { isGulatiOrg, useGulati, gxCan } from '../../lib/gulati/useGulati.js';
import { acconcyNavFor } from '../../lib/acconcy/sections.js';
import { isAcconcyOrg, useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';

const SIDEBAR_KEY = 'delphic_sidebar_collapsed';

function OrgCreateDrawer({ open, onClose }) {
  const { createOrganization } = useAuth();
  const { pushError, pushInfo } = useAlerts();
  const [fields, setFields] = useState({ name: '', slug: '', logo_url: '' });
  const [saving, setSaving] = useState(false);

  function updateField(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await createOrganization({
        name: fields.name.trim(),
        slug: fields.slug.trim(),
        logo_url: fields.logo_url.trim() || null,
      });
      setFields({ name: '', slug: '', logo_url: '' });
      onClose();
      pushInfo('Organization created and selected');
    } catch (error) {
      pushError(error.response?.data?.message || 'Failed to create organization', 'Organization onboarding failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} title="Create organization" onClose={onClose} size="md" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="create-organization-form" className="btn-primary" disabled={saving || !fields.name.trim() || !fields.slug.trim()}>
          {saving ? 'Creating...' : 'Create organization'}
        </button>
      </>
    )}>
      <form id="create-organization-form" onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-medium text-tertiary-600">Organization name<input required value={fields.name} onChange={(event) => updateField('name', event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Workspace slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={fields.slug} onChange={(event) => updateField('slug', event.target.value.toLowerCase())} placeholder="acme-consulting" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Logo URL <span className="font-normal text-tertiary-400">(optional)</span><input type="url" value={fields.logo_url} onChange={(event) => updateField('logo_url', event.target.value)} placeholder="https://..." className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
      </form>
    </Drawer>
  );
}

/**
 * App shell: collapsible icon sidebar with profile actions, canvas header title, and main outlet.
 */
// A contractor's whole app: the portal (projects, holiday calendar,
// timesheet) plus notifications and their own settings.
const CONTRACTOR_NAV = [{ to: '/', label: 'My Portal', end: true, icon: LayoutDashboard }];
const CONTRACTOR_PATHS = ['/', '/notifications', '/settings'];

// Zephyr Infrastructure is a standalone workspace: its users see only the
// Zephyr sections plus their own notifications and personal settings.
const ZEPHYR_EXTRA_NAV = [{ to: '/settings', label: 'Settings', icon: Settings }];
const isZephyrPath = (pathname) => pathname.startsWith('/zephyr') || ['/settings', '/notifications'].includes(pathname);
// Gulati Industries is standalone in the same way.
const isGulatiPath = (pathname) => pathname.startsWith('/gulati') || ['/settings', '/notifications'].includes(pathname);
// Acconcy Finance as well.
const isAcconcyPath = (pathname) => pathname.startsWith('/acconcy') || ['/settings', '/notifications'].includes(pathname);

const GROUP_NAV_ITEM = { to: '/group-overview', label: 'Group Dashboard', icon: Network, end: true };

export default function AppLayout() {
  const { user, logout, isGroupSuperadmin, memberships, switchOrg } = useAuth();
  const { pushInfo } = useAlerts();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { can } = usePermissions(user);
  const { interviewUnread } = useNotifications();
  const isContractor = user?.worker_type === 'contractor';
  const isZephyr = isZephyrOrg(user);
  const { me: zxMe } = useZephyr();
  const isGulati = isGulatiOrg(user);
  // The group superadmin's Group Dashboard is reachable from inside any company workspace.
  const isGroupPath = isGroupSuperadmin && pathname.startsWith('/group-overview');
  const { me: gxMe } = useGulati();
  const isAcconcy = isAcconcyOrg(user);
  const { me: axMe } = useAcconcy();
  const navBase = useMemo(
    () => {
      if (isAcconcy) {
        const setup = axCan(axMe, 'settings') ? [{ to: '/acconcy/settings', label: 'Acconcy setup', icon: Settings }] : [];
        return [...acconcyNavFor(axMe), ...setup, ...ZEPHYR_EXTRA_NAV];
      }
      if (isGulati) {
        const setup = gxCan(gxMe, 'settings') ? [{ to: '/gulati/settings', label: 'Gulati setup', icon: Settings }] : [];
        return [...gulatiNavFor(gxMe), ...setup, ...ZEPHYR_EXTRA_NAV];
      }
      if (isZephyr) {
        const setup = zxCan(zxMe, 'settings') ? [{ to: '/zephyr/settings', label: 'Zephyr setup', icon: Settings }] : [];
        return [...zephyrNavFor(zxMe), ...setup, ...ZEPHYR_EXTRA_NAV];
      }
      return isContractor ? CONTRACTOR_NAV : NAV_ITEMS.filter((item) => {
        if (item.hiddenForAdmin && user?.role === 'admin') return false;
        if (item.groupSuperadminOnly) return isGroupSuperadmin;
        if (item.meetingsCalendar && !canSeeMeetingsCalendar(user)) return false;
        if (item.masterOnly && !user?.active_org?.is_master_workspace) return false;
        if (item.module && !user?.active_org?.enabled_modules?.includes(item.module)) return false;
        return !item.capability || can(item.capability);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- can is derived from user.role
    [user?.role, user?.department?.name, user?.active_org?.enabled_modules, user?.active_org?.is_master_workspace, isGroupSuperadmin, isContractor, isZephyr, zxMe, isGulati, gxMe, isAcconcy, axMe]
  );

  // The group superadmin always has the Group Dashboard pinned at the top, inside every company workspace.
  const navItems = useMemo(
    () => {
      if (!isGroupSuperadmin || isContractor) return navBase;
      // In group view the sidebar is the group's, not whichever company happens to be active underneath.
      if (isGroupPath) return [GROUP_NAV_ITEM, { to: '/group-overview/settings', label: 'Settings', icon: Settings }];
      return [GROUP_NAV_ITEM, ...navBase.filter((item) => item.to !== '/group-overview')];
    },
    [navBase, isGroupSuperadmin, isContractor, isGroupPath]
  );

  // Re-skin the whole app (drawers and modals included) with the Zephyr palette.
  useEffect(() => {
    if (!isZephyr || isGroupPath) return undefined;
    document.documentElement.classList.add('theme-zephyr');
    return () => document.documentElement.classList.remove('theme-zephyr');
  }, [isZephyr, isGroupPath]);

  // Group view gets the light green of the Gulati Industries logo, not the company's palette underneath.
  useEffect(() => {
    if (!isGroupPath) return undefined;
    document.documentElement.classList.add('theme-group');
    return () => document.documentElement.classList.remove('theme-group');
  }, [isGroupPath]);

  // Acconcy gets the plum palette of its logo.
  useEffect(() => {
    if (!isAcconcy || isGroupPath) return undefined;
    document.documentElement.classList.add('theme-acconcy');
    return () => document.documentElement.classList.remove('theme-acconcy');
  }, [isAcconcy, isGroupPath]);

  // Gulati gets its own calm green palette from the logo.
  useEffect(() => {
    if (!isGulati || isGroupPath) return undefined;
    document.documentElement.classList.add('theme-gulati');
    return () => document.documentElement.classList.remove('theme-gulati');
  }, [isGulati, isGroupPath]);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
  const [orgCreateOpen, setOrgCreateOpen] = useState(false);
  const sidebarMenuRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    function onDocClick(event) {
      if (!sidebarMenuRef.current?.contains(event.target)) setSidebarMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => !v);
  }

  const sidebarWidth = collapsed ? 64 : 224;
  const headerTitle = headerTitleForPath(pathname, user);
  const headerSubtitle = headerSubtitleForPath(pathname, user);
  const role = user?.role;
  const needsExtraSubtitleGap =
    (role === 'bda' &&
      (pathname === '/' || pathname.startsWith('/requirements') || pathname.startsWith('/submissions'))) ||
    (role === 'sales' &&
      (pathname.startsWith('/accounts') ||
        pathname.startsWith('/profiles') ||
        pathname.startsWith('/submissions'))) ||
    (role === 'recruiter' &&
      (pathname === '/' || pathname.startsWith('/accounts') || pathname.startsWith('/requirements')));

  const navContent = (
    <>
      <div className="px-2 py-3">
        <WorkspaceSwitcher collapsed={collapsed} onCreate={() => setOrgCreateOpen(true)} />
      </div>
      {isZephyr && !isGroupPath && !collapsed && (
        <Link
          to="/zephyr"
          onClick={() => setMobileOpen(false)}
          aria-label="Zephyr Infrastructure home"
          className="group mx-3 mb-2 block overflow-hidden rounded-xl border border-primary-200 bg-gradient-to-b from-white to-primary-50 shadow-soft transition hover:shadow-card"
        >
          <div className="flex justify-center px-3 pb-1 pt-2.5">
            <img src={user?.active_org?.logo_url || '/zephyr-logo.png'} alt={user?.active_org?.name || 'Zephyr Infrastructure'} className="h-14 w-auto max-w-full object-contain transition group-hover:scale-105" />
          </div>
          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="h-px flex-1 bg-primary-200" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary-500">Infrastructure</span>
            <span className="h-px flex-1 bg-primary-200" />
          </div>
          <div className="h-0.5 bg-[rgb(var(--zx-earth))]" />
        </Link>
      )}
      {isAcconcy && !isGroupPath && !collapsed && (
        <Link
          to="/acconcy"
          onClick={() => setMobileOpen(false)}
          aria-label="Acconcy Finance home"
          className="group mx-3 mb-2 block overflow-hidden rounded-xl border border-primary-200 bg-gradient-to-b from-white to-primary-50 shadow-soft transition hover:shadow-card"
        >
          <div className="flex justify-center px-3 py-3">
            <img src={user?.active_org?.logo_url || '/acconcy-logo.png'} alt={user?.active_org?.name || 'Acconcy Finance'} className="h-9 w-auto max-w-full object-contain transition group-hover:scale-105" />
          </div>
          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="h-px flex-1 bg-primary-200" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary-600">Finance</span>
            <span className="h-px flex-1 bg-primary-200" />
          </div>
          <div className="h-0.5 bg-[rgb(var(--ax-gold))]" />
        </Link>
      )}
      {isGulati && !isGroupPath && !collapsed && (
        <Link
          to="/gulati"
          onClick={() => setMobileOpen(false)}
          aria-label="Gulati Industries home"
          className="group mx-3 mb-2 block overflow-hidden rounded-xl border border-primary-200 bg-gradient-to-b from-white to-primary-50 shadow-soft transition hover:shadow-card"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <img src={user?.active_org?.logo_url || '/gulati-logo.svg'} alt={user?.active_org?.name || 'Gulati Industries'} className="h-11 w-11 shrink-0 object-contain transition group-hover:rotate-12" />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-heading text-[13px] font-semibold uppercase tracking-wide text-primary-900">Gulati</div>
              <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-primary-600">Industries</div>
            </div>
          </div>
          <div className="h-0.5 bg-[rgb(var(--gx-copper))]" />
        </Link>
      )}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const showInterviewDot = item.to === '/calendar' && interviewUnread > 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-tertiary-600 hover:bg-tertiary-50 hover:text-tertiary-900'
                } ${collapsed ? 'justify-center px-2' : ''}`
              }
            >
              <span className="relative shrink-0">
                <Icon className="h-4 w-4" />
                {showInterviewDot && collapsed && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger-600 ring-2 ring-canvas-sidebar" />
                )}
              </span>
              {!collapsed && (
                <span className="flex flex-1 items-center justify-between gap-2">
                  <span>{item.label}</span>
                  {showInterviewDot && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
                      {interviewUnread > 9 ? '9+' : interviewUnread}
                    </span>
                  )}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      {isGroupSuperadmin && isGroupPath && !collapsed && memberships?.length > 0 && (
        <div className="border-t border-tertiary-100 px-2 pb-1 pt-3">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-tertiary-400">Open a company</p>
          <ul className="space-y-0.5">
            {memberships.map((m) => (
              <li key={m.org.id}>
                <button
                  type="button"
                  onClick={async () => {
                    if (m.org.enabled_modules?.includes('coming_soon')) {
                      pushInfo(`${m.org.name} is coming soon. It will appear here once it is ready.`);
                      return;
                    }
                    setMobileOpen(false);
                    await switchOrg(m.org.id);
                    navigate('/');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-tertiary-700 transition-colors hover:bg-tertiary-50 hover:text-tertiary-900"
                >
                  <WorkspaceLogo name={m.org.name} logoUrl={orgLogo(m.org)} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{m.org.name}</span>
                  {m.org.enabled_modules?.includes('coming_soon') && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Soon</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto space-y-2 border-t border-tertiary-100 p-2">
        <button
          type="button"
          className="btn-ghost hidden w-full items-center justify-center gap-2 px-3 py-2 md:flex"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
        {user && !collapsed && (
          <div className="relative" ref={sidebarMenuRef}>
            <div className="flex items-center gap-2 rounded-xl border border-tertiary-100 bg-white/70 px-2.5 py-2 shadow-soft">
              <Avatar name={user.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-tertiary-900">{user.name}</div>
                <div className="truncate text-xs text-tertiary-500">{user.email}</div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-tertiary-400 transition-colors hover:bg-tertiary-50 hover:text-tertiary-700"
                aria-label="Account options"
                aria-expanded={sidebarMenuOpen}
                aria-haspopup="menu"
                onClick={() => setSidebarMenuOpen((open) => !open)}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
            <AnimatePresence>
              {sidebarMenuOpen && (
                <motion.div
                  role="menu"
                  className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-xl border border-tertiary-200 bg-white py-1 shadow-card"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                >
                  <Link
                    to="/settings"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-tertiary-700 transition-colors hover:bg-tertiary-50"
                    onClick={() => setSidebarMenuOpen(false)}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-tertiary-700 transition-colors hover:bg-tertiary-50"
                    onClick={() => {
                      setSidebarMenuOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Logout
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      <motion.aside
        className="relative z-20 hidden shrink-0 flex-col border-r border-tertiary-100 bg-canvas-sidebar md:flex"
        animate={{ width: sidebarWidth }}
        transition={{ type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        initial={false}
      >
        {navContent}
      </motion.aside>

      {/* Mobile overlay sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="relative z-10 flex h-full w-56 flex-col border-r border-tertiary-100 bg-canvas-sidebar shadow-drawer"
              initial={{ x: -224 }}
              animate={{ x: 0 }}
              exit={{ x: -224 }}
              transition={{ type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                className="absolute right-2 top-3 rounded-lg p-1.5 text-tertiary-400 hover:bg-tertiary-100"
                aria-label="Close"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
              {navContent}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="dashboard-canvas-glow flex-1 overflow-auto bg-canvas">
          <header className={`px-4 pt-4 md:px-6 md:pt-5 ${needsExtraSubtitleGap ? 'pb-3' : 'pb-0'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <button
                  type="button"
                  className="mt-0.5 rounded-lg p-2 text-tertiary-600 hover:bg-tertiary-50 md:hidden"
                  aria-label="Open menu"
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate font-heading text-lg font-bold tracking-tight text-tertiary-900 md:text-xl">
                    {headerTitle}
                  </h1>
                  {headerSubtitle && (
                    <p className="mt-0.5 text-sm text-tertiary-500">{headerSubtitle}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <NotificationBell />
              </div>
            </div>
          </header>

          <div className="px-4 pb-6 pt-0 md:px-6">
            {isGroupSuperadmin && !isGroupPath && user?.active_org && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2 text-sm text-primary-900">
                <span>
                  Group admin view - you are working in <b>{user.active_org.name}</b>. Changes here affect only this company.
                </span>
                <Link to="/group-overview" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 shadow-soft hover:bg-primary-100">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back to Group Dashboard
                </Link>
              </div>
            )}
            {/* A crash in one page shows an error card here instead of blanking the app; a new route resets it. */}
            <ErrorBoundary resetKey={`${pathname}${search}`}>
              {isContractor && !CONTRACTOR_PATHS.includes(pathname) ? <Navigate to="/" replace /> : isZephyr && !isZephyrPath(pathname) && !isGroupPath ? <Navigate to="/zephyr" replace /> : isGulati && !isGulatiPath(pathname) && !isGroupPath ? <Navigate to="/gulati" replace /> : isAcconcy && !isAcconcyPath(pathname) && !isGroupPath ? <Navigate to="/acconcy" replace /> : <Outlet />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <OrgCreateDrawer open={orgCreateOpen} onClose={() => setOrgCreateOpen(false)} />
    </div>
  );
}
