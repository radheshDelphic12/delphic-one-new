import { ArrowLeftRight, Banknote, BarChart3, Boxes, CalendarRange, FileBarChart2, FileText, Handshake, Landmark, LayoutDashboard, Pill, ShoppingCart, Store, Receipt, Truck, TrendingUp, Undo2, UserCog, Wallet, Warehouse } from 'lucide-react';

/** The Novarex Pharmaceuticals product. `cap` is the capability (server access.js) needed to see a section. */
export const NOVAREX_SECTIONS = [
  { key: 'operations', to: '/novarex/operations', label: 'Operations', blurb: 'Sales, gross profit, stock value, receivables, franchise fees and logistics with live filters, and the operations reports.', icon: BarChart3, cap: 'opsReports' },
  { key: 'outlets', to: '/novarex/outlets', label: 'Outlets', blurb: 'Every outlet: location, ownership type, format and its own financial picture.', icon: Store, cap: 'outlets' },
  { key: 'products', to: '/novarex/products', label: 'Products', blurb: 'The product master: tax rate, price, regulatory class and handling.', icon: Pill, cap: 'products' },
  { key: 'purchasing', to: '/novarex/purchasing', label: 'Purchasing', blurb: 'Suppliers, purchase orders and goods receipts.', icon: ShoppingCart, cap: 'purchasing' },
  { key: 'stock', to: '/novarex/stock', label: 'Stock', blurb: 'Stock by batch and location, expiry, transfers, adjustments and alerts.', icon: Warehouse, cap: 'stock' },
  { key: 'sales', to: '/novarex/sales', label: 'Sales orders', blurb: 'Customers, outlets and sales orders with batch allocation.', icon: Boxes, cap: 'sales' },
  { key: 'logistics', to: '/novarex/logistics', label: 'Shipments', blurb: 'Dispatch, delivery, freight, partners, rate cards and company vehicles.', icon: Truck, cap: 'logistics' },
  { key: 'invoices', to: '/novarex/invoices', label: 'Invoices', blurb: 'Sales, purchase and franchise invoices, credit notes and payments.', icon: FileText, cap: 'billing' },
  { key: 'returns', to: '/novarex/returns', label: 'Returns and recalls', blurb: 'Customer and supplier returns, inspection and product recalls.', icon: Undo2, cap: 'stock' },
  { key: 'franchise', to: '/novarex/franchise', label: 'Franchise', blurb: 'Agreements, fees, royalties and settlements.', icon: Handshake, cap: 'franchise' },
  { key: 'investments', to: '/novarex/investments', label: 'Investments', blurb: 'Capital placed, principal returned and earnings, investment by investment.', icon: Landmark, cap: 'investments' },
  { key: 'income', to: '/novarex/income', label: 'Revenue & Returns', blurb: 'Sales revenue, investment earnings, principal recovered and other income received.', icon: Banknote, cap: 'entries' },
  { key: 'expenses', to: '/novarex/expenses', label: 'Expenses', blurb: 'Outlet operating costs and company overheads, by category.', icon: Receipt, cap: 'entries' },
  { key: 'salaries', to: '/novarex/salaries', label: 'Salaries', blurb: 'Salary and labour cost paid and payable, by employee and outlet.', icon: Wallet, cap: 'payroll' },
  { key: 'reports', to: '/novarex/reports', label: 'Monthly Reports', blurb: 'The monthly financial report and every other report, with export.', icon: FileBarChart2, cap: 'reports' },
  { key: 'projections', to: '/novarex/projections', label: 'Projections', blurb: 'Plan future months and compare with the actuals.', icon: CalendarRange, cap: 'projections' },
  { key: 'transactions', to: '/novarex/transactions', label: 'Transactions', blurb: 'Every movement of money in one searchable register.', icon: ArrowLeftRight, cap: 'entries' },
  { key: 'financials', to: '/novarex/financials', label: 'Financials', blurb: 'Income, expenses and capital by month, with month close.', icon: TrendingUp, cap: 'financials' },
  { key: 'people', to: '/novarex/people', label: 'Employee / Contractor', blurb: 'People roster, logins and access roles.', icon: UserCog, cap: 'people' },
];

export const NOVAREX_HOME = { to: '/novarex', label: 'Overview', icon: LayoutDashboard, end: true };

const has = (me, cap) => Boolean(me?.caps?.includes(cap));

/** Sidebar entries for a Novarex role. */
export function novarexNavFor(me) {
  if (!me) return [NOVAREX_HOME];
  const sections = NOVAREX_SECTIONS.filter((s) => has(me, s.cap));
  return has(me, 'dashboard') ? [NOVAREX_HOME, ...sections] : sections;
}
