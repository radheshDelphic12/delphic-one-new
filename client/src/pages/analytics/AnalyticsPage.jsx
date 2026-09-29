import { useSearchParams } from 'react-router-dom';
import { Banknote, LineChart, Receipt, Truck, Users2 } from 'lucide-react';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import BillingSalesTab from './BillingSalesTab.jsx';
import ResourceRevenueTab from './ResourceRevenueTab.jsx';
import AttendanceSalaryTab from './AttendanceSalaryTab.jsx';
import VendorPaymentsTab from './VendorPaymentsTab.jsx';
import { ExpensesTab } from './CostTabs.jsx';
// Previous Live Analytics reports — replaced by the attendance / timesheet
// based tabs above. Kept in the codebase (not deleted) and their APIs still
// work; to bring one back, re-import it and add it to TABS.
//   import LiveSalesTab from './LiveSalesTab.jsx';            // old Billing & sales (DailyProjectRevenue)
//   import ResourcesTab from './ResourcesTab.jsx';            // old Resource revenue (nightly profitability + face mapping)
//   import { SalaryTab, VendorsTab } from './CostTabs.jsx';   // old Salary (CTC accrual) / Vendors (manual payments)

const TABS = [
  { key: 'sales', label: 'Billing & sales', icon: LineChart },
  { key: 'resources', label: 'Resource revenue', icon: Users2 },
  { key: 'salary', label: 'Salary', icon: Banknote },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'vendors', label: 'Vendors', icon: Truck },
];

/**
 * Live Analytics (admin): the company's CURRENT operational picture — always
 * computed from the latest attendance, timesheets and approvals while a month
 * is open. Reviewing and locking a month here freezes it (the locked version
 * is then what Payroll, invoices and Financials use); later changes to a
 * locked month are flagged, never applied silently.
 */
export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'sales';
  const section = TABS.some((t) => t.key === requested) ? requested : 'sales';

  return (
    <div className="space-y-4">
      <SectionTabs tabs={TABS} value={section} onChange={(key) => setParams({ section: key })} />
      {section === 'sales' && <BillingSalesTab />}
      {section === 'resources' && <ResourceRevenueTab />}
      {section === 'salary' && <AttendanceSalaryTab />}
      {section === 'expenses' && <ExpensesTab />}
      {section === 'vendors' && <VendorPaymentsTab />}
    </div>
  );
}
