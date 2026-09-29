import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Menu, MoreVertical, Settings, X } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { useNotifications } from '../../lib/notifications/notificationsContext.jsx';
import { usePermissions } from '../../lib/permissions.js';
import Avatar from '../ui/Avatar.jsx';
import NotificationBell from '../notifications/NotificationBell.jsx';
import { headerSubtitleForPath, headerTitleForPath } from './headerTitle.js';
import { NAV_ITEMS } from './navItems.js';
import Drawer from '../ui/Drawer.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';
import HeaderAttendance from './HeaderAttendance.jsx';

// The header's Check in / Check out button is switched off for now (check-in
// still works from Time & Attendance → Attendance). Set true to bring it back.
const SHOW_HEADER_ATTENDANCE = false;
import { canSeeMeetingsCalendar } from '../../lib/departments.js';

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

export default function AppLayout() {
  const { user, logout, isGroupSuperadmin } = useAuth();
  const { pathname } = useLocation();
  const { can } = usePermissions(user);
  const { interviewUnread } = useNotifications();
  const isContractor = user?.worker_type === 'contractor';
  const navItems = useMemo(
    () =>
      isContractor ? CONTRACTOR_NAV : NAV_ITEMS.filter((item) => {
        if (item.hiddenForAdmin && user?.role === 'admin') return false;
        if (item.groupSuperadminOnly) return isGroupSuperadmin;
        if (item.meetingsCalendar && !canSeeMeetingsCalendar(user)) return false;
        if (item.masterOnly && !user?.active_org?.is_master_workspace) return false;
        if (item.module && !user?.active_org?.enabled_modules?.includes(item.module)) return false;
        return !item.capability || can(item.capability);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- can is derived from user.role
    [user?.role, user?.department?.name, user?.active_org?.enabled_modules, user?.active_org?.is_master_workspace, isGroupSuperadmin, isContractor]
  );

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
                    ? 'bg-[#105AA9] text-white shadow-sm'
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
                {SHOW_HEADER_ATTENDANCE && user?.active_org && !isContractor && can('viewAttendance') && <HeaderAttendance key={user.active_org.id} user={user} />}
                <NotificationBell />
              </div>
            </div>
          </header>

          <div className="px-4 pb-6 pt-0 md:px-6">
            {isContractor && !CONTRACTOR_PATHS.includes(pathname) ? <Navigate to="/" replace /> : <Outlet />}
          </div>
        </main>
      </div>
      <OrgCreateDrawer open={orgCreateOpen} onClose={() => setOrgCreateOpen(false)} />
    </div>
  );
}
