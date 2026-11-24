import HubTabs from '../../components/layout/HubTabs.jsx';
import HubHeading from '../../components/layout/HubHeading.jsx';
import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { FilePenLine, FileText, FolderCheck, Gauge, Laptop, Megaphone, Network, Settings2, UserCog, UsersRound } from 'lucide-react';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import PeopleListPage from './PeopleListPage.jsx';
import OrgChartPage from '../orgChart/OrgChartPage.jsx';
import UsersPage from '../users/UsersPage.jsx';
import HrSettingsPage from './HrSettingsPage.jsx';
import AssetsPage from './AssetsPage.jsx';
import CapacityPage from './CapacityPage.jsx';
import PoliciesPage from './PoliciesPage.jsx';
import LettersPage from './LettersPage.jsx';
import DocumentsPage from '../documents/DocumentsPage.jsx';
import AnnouncementsCard from '../dashboard/AnnouncementsCard.jsx';

const BASE_TABS = [
  { key: 'directory', label: 'Directory', icon: UsersRound, need: 'basic.people_directory' },
  { key: 'org-chart', label: 'Org Chart', icon: Network, need: 'basic.org_chart' },
  { key: 'policies', label: 'Policies', icon: FileText, need: 'basic.policies' },
];
const ADMIN_TABS = [
  { key: 'capacity', label: 'Capacity & Allocation', icon: Gauge, need: 'allocations.view' },
  { key: 'users', label: 'Users', icon: UserCog, need: 'users.view' },
  { key: 'assets', label: 'Assets', icon: Laptop, need: 'assets.view' },
  { key: 'letters', label: 'Letters', icon: FilePenLine, need: 'letters.view' },
  // What is on file for clients, vendors and employees (a ? where it is missing), documents to sign, storage.
  { key: 'documents', label: 'Documents', icon: FolderCheck, need: ['documents.view', 'documents.sign'] },
  { key: 'hr-settings', label: 'HR Settings', icon: Settings2, need: 'hr_settings.view' },
];

// Birthdays and work anniversaries: for everyone, last tab (next to HR Settings).
// One line under the tab bar for the open tab. Tabs that already draw their own heading are listed in SELF_HEADED.
const TAB_HELP = {
  directory: 'Everyone in the company: search, filter and open a profile.',
  'org-chart': 'Reporting lines and team structure.',
  capacity: 'Who is allocated to which project, and how much capacity is free.',
  users: 'Sign-in accounts, roles and access.',
  assets: 'Laptops and other company assets issued to employees.',
  letters: 'Offer, appointment and other HR letters.',
  documents: 'Agreements and other documents on file for every client, vendor and employee, documents to sign, and storage.',
  'hr-settings': 'Holiday calendars and other HR configuration.',
};
const SELF_HEADED = new Set(['policies', 'announcements']);
const ANNOUNCEMENTS_TAB = { key: 'announcements', label: 'Announcements', icon: Megaphone, need: 'basic.home' };

function AnnouncementsSection() {
  const [days, setDays] = useState(14);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-tertiary-600">
        Show the next
        <select aria-label="Days ahead" className="rounded-lg border border-tertiary-200 px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
      <AnnouncementsCard key={days} days={days} showEmpty />
    </div>
  );
}

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
  const tabs = [...BASE_TABS.filter((t) => allowed(user, t.need, true)), ...ADMIN_TABS.filter((t) => allowed(user, t.need, isAdmin)), ...(allowed(user, ANNOUNCEMENTS_TAB.need, true) ? [ANNOUNCEMENTS_TAB] : [])];
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'directory';
  const section = tabs.some((t) => t.key === requested) ? requested : (tabs[0]?.key || 'directory');

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      <HubTabs tabs={tabs} value={section} onSelect={(key) => setParams({ section: key })} modern={modern} />
      <HubHeading tabs={tabs} section={section} help={TAB_HELP} skip={SELF_HEADED} />
      {section === 'directory' && <PeopleListPage />}
      {section === 'org-chart' && <OrgChartPage />}
      {section === 'policies' && <PoliciesPage />}
      {section === 'announcements' && <AnnouncementsSection />}
      {section === 'capacity' && tabs.some((t) => t.key === 'capacity') && <CapacityPage />}
      {section === 'users' && tabs.some((t) => t.key === 'users') && <UsersPage />}
      {section === 'assets' && tabs.some((t) => t.key === 'assets') && <AssetsPage />}
      {section === 'letters' && tabs.some((t) => t.key === 'letters') && <LettersPage />}
      {section === 'documents' && tabs.some((t) => t.key === 'documents') && <DocumentsPage />}
      {section === 'hr-settings' && tabs.some((t) => t.key === 'hr-settings') && <HrSettingsPage />}
    </div>
  );
}
