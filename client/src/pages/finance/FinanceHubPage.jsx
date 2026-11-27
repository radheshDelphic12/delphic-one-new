import HubTabs from '../../components/layout/HubTabs.jsx';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Banknote, CalendarRange, CheckCircle2, ClipboardCheck, FileCheck, FileText, FolderKanban, Percent, Receipt, SlidersHorizontal, Tags, Truck, Users2, Wallet } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import ExpensesTab from './ExpensesTab.jsx';
import ProjectsTab from './ProjectsTab.jsx';
import GroupChargesTab from './GroupChargesTab.jsx';
import MonthProjectsTab from './MonthProjectsTab.jsx';
import BillingSetupTab from './BillingSetupTab.jsx';
import VendorInvoicesTab from './VendorInvoicesTab.jsx';
import PaymentTrackerTab from './PaymentTrackerTab.jsx';
import InvoicingSection from './InvoicingSection.jsx';
import TaxInvoicesTab from './TaxInvoicesTab.jsx';
// Project P&L is hidden for now (client brief 2026-10-01: its cost rules —
// partial-month salary on a last working day, actual project cost — are not
// settled). ProjectPnlTab.jsx and its API stay; to bring it back, re-import it
// and add { key: 'project-pnl', label: 'Project P&L', icon: TrendingUp }.
import FinanceCategoriesTab from './FinanceCategoriesTab.jsx';
import { VendorUploadedInvoices } from '../vendorPortal/VendorPortalInternal.jsx';
import CreditNotesPanel from './CreditNotesPanel.jsx';
import SectionHeading from '../../components/ui/SectionHeading.jsx';

// Tabs that already draw their own heading (or, for Expenses, per-view headings) get no extra one from the hub.
const SELF_HEADED = new Set(['expenses', 'projects', 'month-view', 'billing-setup', 'vendor-invoices', 'payment-tracker']);
const TAB_HELP = {expenses:'Submit, approve and reimburse business expense claims.',projects:'Running projects and contracts: billing terms, client agreements, project team and invoicing.','month-view':'Month by month: running projects, timesheets, billing, invoices, payments and financial status.',invoicing:'Every client invoice by month: paid, part-paid and unpaid, with payments and totals.','billing-setup':'Per-resource billing rates and the client billing status rules.','vendor-invoices':'Vendor invoices with TDS and adjustments, sent and paid status, and bank payout.','group-charges':'Charges raised between the companies of the group.',categories:'Expense and group-charge categories used across Finance.','tax-invoices':"GST (INR) and USD export invoices of this company's legal entity."};
const BASE_TABS = [{ key: 'expenses', label: 'Expenses', icon: Receipt, need: ['basic.expenses', 'finance.view'] }];
// GST (INR) and USD export invoices of the company's legal entity: the group admin issues them (their own tab, next to Invoicing).
const TAX_INVOICES_TAB = { key: 'tax-invoices', label: 'GST / USD invoices', icon: FileCheck };
const ADMIN_TABS = [
  { key: 'projects', label: 'Projects', icon: FolderKanban, need: 'billing.view' },
  // Month-wise: running projects -> timesheet -> billing -> invoice -> payment -> financial status, plus the Sales / Salary exports.
  { key: 'month-view', label: 'Month View', icon: CalendarRange, need: ['analytics.view', 'financials.view', 'finance.view'] },
  // Every client invoice, month by month: paid / partly paid / unpaid, filters, totals, payments (the payment popup, wallet yes / no).
  { key: 'invoicing', label: 'Invoicing', icon: FileText, need: 'billing.view' },
  // Per-resource billing rates and the client billing status rules (PL / NPL / comp off / FH / SH ...).
  { key: 'billing-setup', label: 'Billing Setup', icon: SlidersHorizontal, need: 'billing.view' },
  // Vendor invoices: TDS, adjustment, sent / unsent, paid / unpaid, trace, Excel export.
  { key: 'vendor-invoices', label: 'Vendor Invoices', icon: Truck, need: 'billing.view' },
  // Vendor resources of a month: did the client pay us, did we pay the vendor, and both due dates, side by side.
  { key: 'payment-tracker', label: 'Payment Tracker', icon: ArrowLeftRight, need: 'billing.view' },
  { key: 'group-charges', label: 'Group Charges', icon: Users2, need: 'billing.view' },
  // Admin-managed Group Charge + Expense categories (next to Group Charges).
  { key: 'categories', label: 'Categories', icon: Tags, need: 'finance.view' },
];

/**
 * Finance hub: expenses, projects (the hub for running projects and contracts:
 * billing terms, client agreements, project team, invoicing) and intra-group
 * charges. Expense claims are self-serve for every role; the rest is
 * admin-only, matching the backend's own gating.
 *
 * Vendor Payments, External Access, Vendor Ledger and Accounting are switched
 * off for now — their tabs are gone from here and the API refuses them (see
 * server/src/middleware/financeScope.js). The tab components are still in the
 * codebase so turning them back on is a small change.
 */
export default function FinanceHubPage() {
  const { user, isGroupSuperadmin } = useAuth();
  // everyone except the group superadmin gets the refreshed look; the superadmin keeps the original one
  const modern = !isGroupSuperadmin;
  const isAdmin = isAdminUser(user);
  const tabs = [...BASE_TABS.filter((t) => allowed(user, t.need, true)), ...ADMIN_TABS.filter((t) => allowed(user, t.need, isAdmin)), ...(isGroupSuperadmin ? [TAX_INVOICES_TAB] : [])];
  const has = (key) => tabs.some((t) => t.key === key);
  const [params, setParams] = useSearchParams();
  const requested = params.get('section') || 'expenses';
  const section = tabs.some((t) => t.key === requested) ? requested : (tabs[0]?.key || 'expenses');
  const activeTab = tabs.find((t) => t.key === section);
  // Claims waiting for this person's decision: shown as a badge in the Expenses menu, and decides whether a non-admin approver sees Approvals.
  const [approvalCount, setApprovalCount] = useState(0);
  const view = params.get('view');
  useEffect(() => {
    let live = true;
    apiClient.get('/expenses/claims/approvals').then(({ data }) => { if (live) setApprovalCount((data.data || []).length); }).catch(() => { if (live) setApprovalCount(0); });
    return () => { live = false; };
  }, [section, view]);
  // Hover menu on the tabs that have sub-pages. These replace the in-page sub-tab strips, so every sub-page stays reachable.
  const expenseViews = [
    { key: 'mine', label: 'My claims', icon: Receipt, description: 'Expenses you have submitted and where each one stands' },
    ...(isAdmin || approvalCount > 0 ? [{ key: 'approvals', label: 'Approvals', icon: CheckCircle2, badge: approvalCount || null, description: 'Claims waiting for your decision' }] : []),
    ...(isAdmin ? [
      { key: 'team', label: 'Reimbursements', icon: Wallet, description: "Approve and reimburse every employee's claims" },
      { key: 'payout', label: 'Bank payout', icon: Banknote, description: 'Monthly payout sheet per employee, ready for the bank' },
      { key: 'processed', label: 'Processed', icon: ClipboardCheck, description: 'Claims that have already been processed' },
      { key: 'group', label: 'Group expenses', icon: Users2, description: 'Company-wide costs paid by the company, such as office rent' },
    ] : []),
  ];
  const vendorViews = [
    { key: 'invoices', label: 'Invoices', icon: FileText, description: 'Vendor bills with TDS, adjustments, sent and paid status' },
    { key: 'charges', label: 'GST & TDS setup', icon: Percent, description: 'GST and TDS rules applied to each vendor' },
    { key: 'payout', label: 'Bank payout', icon: Banknote, description: 'Unpaid vendor invoices per vendor, ready for the bank' },
    { key: 'uploaded', label: 'Uploaded by vendor', icon: FileText, description: 'Invoice files vendors sent through the vendor portal' },
    { key: 'credit-notes', label: 'Credit notes', icon: FileText, description: 'Credit notes from vendors, which lower what we owe' },
  ];
  const tabsWithMenu = tabs.map((t) => (t.key === 'expenses' ? { ...t, blurb: TAB_HELP.expenses, children: expenseViews } : t.key === 'vendor-invoices' ? { ...t, blurb: TAB_HELP['vendor-invoices'], children: vendorViews } : t));
  const activeChildKey = section === 'expenses' ? (expenseViews.some((c) => c.key === view) ? view : 'mine') : section === 'vendor-invoices' ? (vendorViews.some((c) => c.key === view) ? view : 'invoices') : null;

  return (
    <div className={`space-y-4 ${modern ? 'ta-modern' : ''}`}>
      <HubTabs tabs={tabsWithMenu} value={section} onSelect={(key) => setParams({ section: key })} activeChild={activeChildKey} onSelectChild={(key, child) => setParams({ section: key, view: child })} modern={modern} />
      {tabs.length > 1 && activeTab && TAB_HELP[section] && !SELF_HEADED.has(section) && <SectionHeading icon={activeTab.icon} title={activeTab.label} description={TAB_HELP[section]} />}
      {section === 'expenses' && has('expenses') && <ExpensesTab />}
      {section === 'projects' && has('projects') && <ProjectsTab />}
      {section === 'month-view' && has('month-view') && <MonthProjectsTab />}
      {section === 'invoicing' && has('invoicing') && <InvoicingSection />}
      {section === 'tax-invoices' && has('tax-invoices') && <TaxInvoicesTab />}
      {section === 'billing-setup' && has('billing-setup') && <BillingSetupTab />}
      {section === 'vendor-invoices' && has('vendor-invoices') && (view === 'uploaded' ? <VendorUploadedInvoices /> : view === 'credit-notes' ? <CreditNotesPanel partyType="vendor" /> : <VendorInvoicesTab />)}
      {section === 'payment-tracker' && has('payment-tracker') && <PaymentTrackerTab />}
      {section === 'group-charges' && has('group-charges') && <GroupChargesTab />}
      {section === 'categories' && has('categories') && <FinanceCategoriesTab />}
    </div>
  );
}
