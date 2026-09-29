import { useSearchParams } from 'react-router-dom';
import { CalendarDays, FolderKanban, ListChecks } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import MyHolidaysTab from '../time/MyHolidaysTab.jsx';
import ItTimesheetPage from '../time/ItTimesheetPage.jsx';

const TABS = [
  { key: 'projects', label: 'My Projects', icon: FolderKanban },
  { key: 'holidays', label: 'Holiday Calendar', icon: CalendarDays },
  { key: 'timesheet', label: 'Timesheet', icon: ListChecks },
];

const CATEGORY_LABEL = { managed_services: 'Managed Services', project: 'Project' };

function MyProjects() {
  const year = new Date().getFullYear();
  const { data, loading } = useLiveData(() => apiClient.get('/calendars/me', { params: { year } }).then((r) => r.data.data));
  const projects = data?.projects || [];
  const columns = [
    { key: 'name', header: 'Project', render: (r) => <span className="font-medium text-tertiary-900">{r.name}</span> },
    { key: 'client', header: 'Client', render: (r) => r.client_name || '-' },
    { key: 'category', header: 'Type', render: (r) => CATEGORY_LABEL[r.service_category] || '-' },
    { key: 'start', header: 'Started', render: (r) => (r.agreement_start_date ? new Date(r.agreement_start_date).toLocaleDateString('en-IN', { timeZone: 'UTC' }) : '-') },
    { key: 'calendar', header: 'Holiday calendar', render: (r) => r.calendar?.name || 'Standard' },
  ];
  if (!loading && projects.length === 0) {
    return <EmptyState icon={FolderKanban} title="No projects assigned yet" description="Your projects appear here once you're allocated to one." />;
  }
  return <DataTable columns={columns} rows={projects} loading={loading} emptyLabel="No projects assigned yet" />;
}

/**
 * The whole app for a contractor (People → user type "Contractor"): their
 * assigned projects, the holiday calendar(s) that apply to them, and their
 * monthly timesheet. The server enforces the same boundary
 * (server/src/middleware/contractorScope.js).
 */
export default function ContractorPortalPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'projects';
  const section = TABS.some((t) => t.key === requested) ? requested : 'projects';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
        {TABS.map(({ key, label, icon: Icon }) => (
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
      {section === 'projects' && <MyProjects />}
      {section === 'holidays' && <MyHolidaysTab />}
      {section === 'timesheet' && <ItTimesheetPage />}
    </div>
  );
}
