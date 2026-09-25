import { useSearchParams } from 'react-router-dom';
import { Banknote, LineChart, Receipt, Truck, Users2 } from 'lucide-react';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import LiveSalesTab from './LiveSalesTab.jsx';
import ResourcesTab from './ResourcesTab.jsx';
import { ExpensesTab, SalaryTab, VendorsTab } from './CostTabs.jsx';

const TABS = [
  { key: 'sales', label: 'Billing & sales', icon: LineChart },
  { key: 'resources', label: 'Resource revenue', icon: Users2 },
  { key: 'salary', label: 'Salary', icon: Banknote },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'vendors', label: 'Vendors', icon: Truck },
];

/** Real-time operating analytics for the company (admin). Every table row links to its source record. */
export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'sales';
  const section = TABS.some((t) => t.key === requested) ? requested : 'sales';

  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} value={section} onChange={(key) => setParams({ section: key })} />
      {section === 'sales' && <LiveSalesTab />}
      {section === 'resources' && <ResourcesTab />}
      {section === 'salary' && <SalaryTab />}
      {section === 'expenses' && <ExpensesTab />}
      {section === 'vendors' && <VendorsTab />}
    </div>
  );
}
