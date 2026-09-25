import { useSearchParams } from 'react-router-dom';
import { Network, Settings2, UserCog, UsersRound } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import PeopleListPage from './PeopleListPage.jsx';
import OrgChartPage from '../orgChart/OrgChartPage.jsx';
import UsersPage from '../users/UsersPage.jsx';
import HrSettingsPage from './HrSettingsPage.jsx';

const BASE_TABS = [
  { key: 'directory', label: 'Directory', icon: UsersRound },
  { key: 'org-chart', label: 'Org Chart', icon: Network },
];
const ADMIN_TABS = [
  { key: 'users', label: 'Users', icon: UserCog },
  { key: 'hr-settings', label: 'HR Settings', icon: Settings2 },
];

/**
 * People Hub: Directory + Org Chart + Users + HR Settings under one sidebar
 * entry, so a new HR sub-module doesn't mean a new row in the sidebar.
 */
export default function PeopleHubPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'directory';
  const section = tabs.some((t) => t.key === requested) ? requested : 'directory';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
              section === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'
            }`}
            onClick={() => setParams({ section: key })}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {section === 'directory' && <PeopleListPage />}
      {section === 'org-chart' && <OrgChartPage />}
      {section === 'users' && isAdmin && <UsersPage />}
      {section === 'hr-settings' && isAdmin && <HrSettingsPage />}
    </div>
  );
}
