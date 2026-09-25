import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Bell, LogOut, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Avatar from '../../components/ui/Avatar.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import ChangePasswordForm from '../../components/ChangePasswordForm.jsx';
import DeletedRecordsPanel from '../../components/admin/DeletedRecordsPanel.jsx';
import { userCan } from '../../lib/permissions.js';
import NotificationPreferencesPage from '../notifications/NotificationPreferencesPage.jsx';

const BASE_TABS = [
  { key: 'account', label: 'Account', icon: UserRound },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'activity', label: 'Activity', icon: Activity },
];

const DELETED_TAB = { key: 'deleted', label: 'Deleted records', icon: Trash2 };

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
  const rows = [
    ['Name', user?.name || '—'],
    ['Email', user?.email || '—'],
    ['Phone', user?.phone || '—'],
    ['Role', user?.role ? user.role.toUpperCase() : '—'],
    ['Department', user?.department?.name || '—'],
    ['Access', user?.is_superadmin ? 'Superadmin' : 'Standard'],
  ];

  return (
    <div className="space-y-4">
      <Card title="Profile">
        <div className="flex items-center gap-3">
          <Avatar name={user?.name} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-tertiary-900">{user?.name}</div>
            <div className="truncate text-xs text-tertiary-500">{user?.email}</div>
          </div>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-tertiary-400">{label}</dt>
              <dd className="mt-0.5 text-sm text-tertiary-800">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-tertiary-400">
          Need a name, email or role change? Ask an admin on the{' '}
          <Link to="/users" className="text-primary-700 hover:underline">Users</Link> page.
        </p>
      </Card>

      <Card title="Session" description="Sign out of this browser. You'll need your credentials to sign back in.">
        <button type="button" className="btn-danger" onClick={onLogout}>
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </Card>
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
  const canSeeDeleted = userCan(user, 'deleteRecords');
  const TABS = useMemo(
    () => (canSeeDeleted ? [...BASE_TABS, DELETED_TAB] : BASE_TABS),
    [canSeeDeleted]
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
      {active === 'security' && <SecurityTab />}
      {active === 'notifications' && <NotificationPreferencesPage />}
      {active === 'activity' && <ActivityTab />}
      {active === 'deleted' && canSeeDeleted && <DeletedRecordsPanel />}
    </div>
  );
}
