import HubTabs from '../../components/layout/HubTabs.jsx';
import { useSearchParams } from 'react-router-dom';
import { FileText, Gauge, Laptop, Network, Settings2, UserCog, UsersRound } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import PeopleListPage from './PeopleListPage.jsx';
import OrgChartPage from '../orgChart/OrgChartPage.jsx';
import UsersPage from '../users/UsersPage.jsx';
import HrSettingsPage from './HrSettingsPage.jsx';
import AssetsPage from './AssetsPage.jsx';
import CapacityPage from './CapacityPage.jsx';
import PoliciesPage from './PoliciesPage.jsx';

const BASE_TABS = [
  { key: 'directory', label: 'Directory', icon: UsersRound, need: 'basic.people_directory' },
  { key: 'org-chart', label: 'Org Chart', icon: Network, need: 'basic.org_chart' },
  { key: 'policies', label: 'Policies', icon: FileText, need: 'basic.policies' },
];
const ADMIN_TABS = [
  { key: 'capacity', label: 'Capacity & Allocation', icon: Gauge, need: 'allocations.view' },
  { key: 'users', label: 'Users', icon: UserCog, need: 'users.view' },
  { key: 'assets', label: 'Assets', icon: Laptop, need: 'assets.view' },
  { key: 'hr-settings', label: 'HR Settings', icon: Settings2, need: 'hr_settings.view' },
];

/**
 * People Hub: Directory + Org Chart + Users + Assets + HR Settings under one sidebar
 * entry, so a new HR sub-module doesn't mean a new row in the sidebar.
 */
export default function PeopleHubPage() {
  const { user, isGroupSuperadmin } = useAuth();
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const isAdmin = isAdminUser(user);
  // A tab shows only when the person has View on it (a company on permissions); elsewhere the admin role decides, as before.
  const tabs = [...BASE_TABS.filter((t) => allowed(user, t.need, true)), ...ADMIN_TABS.filter((t) => allowed(user, t.need, isAdmin))];
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'directory';
  const section = tabs.some((t) => t.key === requested) ? requested : (tabs[0]?.key || 'directory');

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      <HubTabs tabs={tabs} value={section} onSelect={(key) => setParams({ section: key })} modern={modern} />
      {section === 'directory' && <PeopleListPage />}
      {section === 'org-chart' && <OrgChartPage />}
      {section === 'policies' && <PoliciesPage />}
      {section === 'capacity' && tabs.some((t) => t.key === 'capacity') && <CapacityPage />}
      {section === 'users' && tabs.some((t) => t.key === 'users') && <UsersPage />}
      {section === 'assets' && tabs.some((t) => t.key === 'assets') && <AssetsPage />}
      {section === 'hr-settings' && tabs.some((t) => t.key === 'hr-settings') && <HrSettingsPage />}
    </div>
  );
}
