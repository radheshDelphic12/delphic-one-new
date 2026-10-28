import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Bell, Briefcase, Building2, IdCard, KeyRound, LogOut, Mail, Pencil, Phone, ShieldCheck, Trash2, UserMinus, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import ChangePasswordForm from '../../components/ChangePasswordForm.jsx';
import DeletedRecordsPanel from '../../components/admin/DeletedRecordsPanel.jsx';
import RolesPermissionsPanel from '../../components/admin/RolesPermissionsPanel.jsx';
import PermissionsPanel from '../../components/admin/PermissionsPanel.jsx';
import { isPermissionMode, isAdminUser, LEVEL_LABEL } from '../../lib/access.js';
import { userCan } from '../../lib/permissions.js';
import { isZephyrOrg } from '../../lib/zephyr/useZephyr.js';
import NotificationPreferencesPage from '../notifications/NotificationPreferencesPage.jsx';
import PersonalDetailsSection from '../../components/PersonalDetailsSection.jsx';
import ReportingSection from '../../components/ReportingSection.jsx';
import ResignationCard from '../../components/resignation/ResignationCard.jsx';
import ResignationsTab from './ResignationsTab.jsx';

const BASE_TABS = [
  { key: 'account', label: 'Account', icon: UserRound },
  // The employee's own bank account, emergency contact and documents.
  { key: 'details', label: 'My details', icon: IdCard },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'activity', label: 'Activity', icon: Activity },
];

const RESIGNATIONS_TAB = { key: 'resignations', label: 'Resignations', icon: UserMinus };
const DELETED_TAB = { key: 'deleted', label: 'Deleted records', icon: Trash2 };
const ROLES_TAB = { key: 'roles', label: 'Roles & permissions', icon: KeyRound };
const PERMISSIONS_TAB = { key: 'permissions', label: 'Permissions', icon: KeyRound };

const ENTITY_PATH = {
  account: (id) => `/accounts/${id}`,
  requirement: (id) => `/requirements/${id}`,
  submission: (id) => `/submissions/${id}`,
};

function prettyStage(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ');
}

function Card({ title, description, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
      {(title || description) && (
        <div className="border-b border-tertiary-100 px-5 py-3.5">
          {title && <h2 className="font-heading text-sm font-semibold text-tertiary-900">{title}</h2>}
          {description && <p className="mt-0.5 text-xs text-tertiary-500">{description}</p>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function AccountTab({ user, onLogout }) {
  const { patchSession } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const canEdit = user?.role === 'admin';
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });

  function startEdit() {
    setForm({ name: user?.name || '', email: user?.email || '', phone: user?.phone || '' });
    setEditing(true);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const patch = {};
    if (form.name.trim() && form.name.trim() !== user.name) patch.name = form.name.trim();
    if (form.email.trim() && form.email.trim() !== user.email) patch.email = form.email.trim();
    if (form.phone.trim() !== (user.phone || '')) patch.phone = form.phone.trim() || null;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.patch(`/users/${user.id}`, patch);
      const saved = res.data.data;
      patchSession({ user: { name: saved.name, email: saved.email, phone: saved.phone } });
      pushSuccess('Profile updated');
      setEditing(false);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update profile'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const isPerm = isPermissionMode(user);
  const roleLabel = isPerm ? (user?.designation?.name || user?.custom_role?.name || '') : (user?.role ? (user.role === 'bda' ? 'BDA' : user.role.charAt(0).toUpperCase() + user.role.slice(1)) : '');
  const accessLabel = isPerm ? `${LEVEL_LABEL[user.access.level] || 'Employee'}${user.access.set ? ` · ${user.access.set.name}` : ''}` : (user?.is_superadmin ? 'Superadmin' : 'Standard');
  const groups = [
    {
      title: 'Contact',
      columns: 'sm:grid-cols-2',
      items: [
        [Mail, 'Email (login)', user?.email || '—'],
        [Phone, 'Phone', user?.phone || '—'],
      ],
    },
    {
      title: 'Work',
      columns: 'sm:grid-cols-3',
      items: [
        [Briefcase, isPerm ? 'Job title' : 'Role', roleLabel || '—'],
        [Building2, 'Department', user?.department?.name || '—'],
        [ShieldCheck, 'Access level', accessLabel],
      ],
    },
  ];
  const inputClass = 'mt-1.5 w-full rounded-lg border border-tertiary-200 bg-white px-3 py-2.5 text-sm text-tertiary-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
  const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-tertiary-500';

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="flex items-center justify-between gap-4 border-b border-tertiary-100 px-6 py-4">
          <div>
            <h2 className="font-heading text-sm font-semibold text-tertiary-900">Profile</h2>
            <p className="mt-0.5 text-xs text-tertiary-500">Your personal and work information.</p>
          </div>
          {!editing && canEdit && (
            <button type="button" className="btn-secondary" onClick={startEdit}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit profile
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={saveProfile} className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <label className={labelClass}>Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>Email (login)
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>Phone
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
            </label>
            <div className="flex items-end gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="grid lg:grid-cols-3">
            <div className="flex flex-col items-center border-b border-tertiary-100 bg-tertiary-50/50 px-6 py-8 text-center lg:border-b-0 lg:border-r">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-600 text-3xl font-semibold text-white shadow-sm" aria-hidden>
                {String(user?.name || '?').trim().slice(0, 1).toUpperCase()}
              </span>
              <h3 className="mt-4 font-heading text-lg font-semibold text-tertiary-900">{user?.name}</h3>
              {roleLabel && <p className="mt-0.5 text-sm text-tertiary-500">{roleLabel}</p>}
              {user?.department?.name && (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-tertiary-600 ring-1 ring-tertiary-200">
                  <Building2 className="h-3.5 w-3.5 text-tertiary-400" aria-hidden />
                  {user.department.name}
                </span>
              )}
            </div>

            <div className="space-y-7 px-6 py-6 lg:col-span-2">
              {groups.map((group) => (
                <div key={group.title}>
                  <h3 className="border-b border-tertiary-100 pb-2 text-xs font-semibold uppercase tracking-wide text-tertiary-400">{group.title}</h3>
                  <dl className={`mt-4 grid gap-x-8 gap-y-5 ${group.columns}`}>
                    {group.items.map(([Icon, label, value]) => (
                      <div key={label} className="flex items-start gap-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-tertiary-400" aria-hidden />
                        <div className="min-w-0">
                          <dt className="text-xs text-tertiary-500">{label}</dt>
                          <dd className="mt-0.5 truncate text-sm font-medium text-tertiary-900" title={String(value)}>{value}</dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        )}

        {!editing && !canEdit && (
          <p className="border-t border-tertiary-100 bg-tertiary-50/50 px-6 py-3 text-xs text-tertiary-500">
            Need a name, email or role change? Ask an admin on the{' '}
            <Link to="/users" className="text-primary-700 hover:underline">Users</Link> page.
          </p>
        )}
      </section>

      {!isZephyrOrg(user) && <ResignationCard />}

      <section className="flex flex-col gap-3 rounded-2xl border border-tertiary-100 bg-white px-6 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Session</h2>
          <p className="mt-0.5 text-xs text-tertiary-500">Sign out of this browser. You&apos;ll need your credentials to sign back in.</p>
        </div>
        <button type="button" className="btn-secondary shrink-0" onClick={onLogout}>
          <LogOut className="h-4 w-4" aria-hidden />
          Log out
        </button>
      </section>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="mx-auto max-w-md">
      <Card title="Change password" description="Choose a strong password you don't use anywhere else.">
        <ChangePasswordForm />
      </Card>
    </div>
  );
}

function ActivityTab() {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .get('/users/me/activity', { params: { limit: 100 } })
      .then(({ data }) => alive && setRows(data.data || []))
      .catch((err) => {
        if (!alive) return;
        setRows([]);
        pushError(apiErrorMessage(err, 'Failed to load your activity'));
      });
    return () => {
      alive = false;
    };
  }, [pushError]);

  return (
    <Card
      title="Account history"
      description="Every stage and status change you've made - newest first."
    >
      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary-400">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-tertiary-100">
          {rows.map((row) => {
            const path = ENTITY_PATH[row.entity_type]?.(row.entity_id);
            const label = row.entity_label || row.entity_type;
            return (
              <li key={row.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="text-tertiary-800">
                    <span className="rounded bg-tertiary-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-tertiary-500">
                      {row.entity_type}
                    </span>{' '}
                    {path ? (
                      <Link to={path} className="font-medium text-primary-700 hover:underline">
                        {label}
                      </Link>
                    ) : (
                      <span className="font-medium text-tertiary-900">{label}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-tertiary-500">
                    {prettyStage(row.from_stage)} <span className="text-tertiary-300">→</span>{' '}
                    <span className="font-medium text-tertiary-700">{prettyStage(row.to_stage)}</span>
                    {row.reason ? ` · ${row.reason}` : ''}
                  </div>
                </div>
                <time className="shrink-0 text-xs text-tertiary-400">
                  {row.changed_at ? new Date(row.changed_at).toLocaleString() : '—'}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  // Zephyr is standalone: the Deleted-records panel lists Delphic records, so it stays off there.
  const canSeeDeleted = userCan(user, 'deleteRecords') && !user?.active_org?.enabled_modules?.includes('zephyr') && !user?.active_org?.enabled_modules?.includes('gulati') && !user?.active_org?.enabled_modules?.includes('foundation') && !user?.active_org?.enabled_modules?.includes('zklyrera') && !user?.active_org?.enabled_modules?.includes('valterra') && !user?.active_org?.enabled_modules?.includes('novarex') && !user?.active_org?.enabled_modules?.includes('acconcy');
  // Zephyr has no HR profile (reporting line, bank, emergency contact, documents), so "My details" is hidden there.
  const hideDetails = isZephyrOrg(user);
  // Roles & permissions: the Super Admin (and the Group Super Admin, in the company they have open).
  const onPermissions = isPermissionMode(user);
  const canManageRoles = !onPermissions && user?.role === 'admin' && Boolean(user?.is_superadmin || user?.is_group_superadmin);
  // Permissions: the Super Admin and the company Admin (in a company that moved); the Super Admin also in a company that has not yet (Migration).
  const canManagePermissions = onPermissions ? isAdminUser(user) : Boolean(user?.access?.level === 'super_admin');
  // Resignations: a manager sees their team's requests; HR (People edit) sees everyone's.
  const canHrResign = isAdminUser(user) || userCan(user, 'people.update');
  const [hasTeamResignations, setHasTeamResignations] = useState(false);
  useEffect(() => {
    if (hideDetails) return;
    apiClient.get('/resignations/team').then((res) => setHasTeamResignations(res.data.data.length > 0)).catch(() => {});
  }, [hideDetails]);
  const showResignations = !hideDetails && (canHrResign || hasTeamResignations);
  const TABS = useMemo(() => {
    const base = hideDetails ? BASE_TABS.filter((t) => t.key !== 'details') : showResignations ? [...BASE_TABS, RESIGNATIONS_TAB] : BASE_TABS;
    const withDeleted = canSeeDeleted ? [...base, DELETED_TAB] : base;
    const withRoles = canManageRoles ? [...withDeleted, ROLES_TAB] : withDeleted;
    return canManagePermissions ? [...withRoles, PERMISSIONS_TAB] : withRoles;
  }, [canSeeDeleted, canManageRoles, canManagePermissions, hideDetails, showResignations]
  );
  const active = useMemo(
    () => (TABS.some((t) => t.key === requested) ? requested : 'account'),
    [TABS, requested]
  );

  function selectTab(key) {
    setParams(key === 'account' ? {} : { tab: key }, { replace: true });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 py-2">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-tertiary-100"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(key)}
              className={`-mb-px flex flex-1 items-center justify-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-tertiary-500 hover:border-tertiary-200 hover:text-tertiary-800'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {active === 'account' && <AccountTab user={user} onLogout={logout} />}
      {active === 'details' && <div className="space-y-4"><ReportingSection self /><PersonalDetailsSection self /></div>}
      {active === 'security' && <SecurityTab />}
      {active === 'notifications' && <NotificationPreferencesPage />}
      {active === 'activity' && <ActivityTab />}
      {active === 'resignations' && showResignations && <ResignationsTab showTeam={hasTeamResignations} canHr={canHrResign} isAdmin={isAdminUser(user)} />}
      {active === 'deleted' && canSeeDeleted && <DeletedRecordsPanel />}
      {active === 'roles' && canManageRoles && <RolesPermissionsPanel />}
      {active === 'permissions' && canManagePermissions && <PermissionsPanel />}
    </div>
  );
}
