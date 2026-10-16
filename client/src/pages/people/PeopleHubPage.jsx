import HubTabs from '../../components/layout/HubTabs.jsx';
import { useSearchParams } from 'react-router-dom';
import { FileText, Gauge, Laptop, Network, Settings2, UserCog, UsersRound } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import PeopleListPage from './PeopleListPage.jsx';
import OrgChartPage from '../orgChart/OrgChartPage.jsx';
import UsersPage from '../users/UsersPage.jsx';
import HrSettingsPage from './HrSettingsPage.jsx';
import AssetsPage from './AssetsPage.jsx';
import CapacityPage from './CapacityPage.jsx';
import PoliciesPage from './PoliciesPage.jsx';

const BASE_TABS = [
  { key: 'directory', label: 'Directory', icon: UsersRound },
  { key: 'org-chart', label: 'Org Chart', icon: Network },
  { key: 'policies', label: 'Policies', icon: FileText },
];
const ADMIN_TABS = [
  { key: 'capacity', label: 'Capacity & Allocation', icon: Gauge },
  { key: 'users', label: 'Users', icon: UserCog },
  { key: 'assets', label: 'Assets', icon: Laptop },
  { key: 'hr-settings', label: 'HR Settings', icon: Settings2 },
];

/**
 * People Hub: Directory + Org Chart + Users + Assets + HR Settings under one sidebar
 * entry, so a new HR sub-module doesn't mean a new row in the sidebar.
 */
export default function PeopleHubPage() {
  const { user, isGroupSuperadmin } = useAuth();
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'directory';
  const section = tabs.some((t) => t.key === requested) ? requested : 'directory';

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      <HubTabs tabs={tabs} value={section} onSelect={(key) => setParams({ section: key })} modern={modern} />
      {section === 'directory' && <PeopleListPage />}
      {section === 'org-chart' && <OrgChartPage />}
      {section === 'policies' && <PoliciesPage />}
      {section === 'capacity' && isAdmin && <CapacityPage />}
      {section === 'users' && isAdmin && <UsersPage />}
      {section === 'assets' && isAdmin && <AssetsPage />}
      {section === 'hr-settings' && isAdmin && <HrSettingsPage />}
    </div>
  );
}
