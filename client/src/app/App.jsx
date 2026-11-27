import { Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { lazyPage } from '../lib/lazyPage.js';
import { useAuth } from '../lib/authContext.jsx';
import { can, userCan } from '../lib/permissions.js';
import { hasNeed, isAdminUser, isPermissionMode } from '../lib/access.js';
import NoAccess from '../components/NoAccess.jsx';
import AppLayout from '../components/layout/AppLayout.jsx';
import HomePreloaderGate from '../components/HomePreloaderGate.jsx';
import LoginPage from '../pages/auth/LoginPage.jsx';
import DashboardPage from '../pages/dashboard/DashboardPage.jsx';
const ContractorPortalPage = lazyPage(() => import('../pages/contractor/ContractorPortalPage.jsx'));
const AccountsListPage = lazyPage(() => import('../pages/accounts/AccountsListPage.jsx'));
const AiClientSuggestionsPage = lazyPage(() => import('../pages/accounts/AiClientSuggestionsPage.jsx'));
const AccountDetailPage = lazyPage(() => import('../pages/accounts/AccountDetailPage.jsx'));
const PipelineShell = lazyPage(() => import('../pages/pipeline/PipelineShell.jsx'));
const AccountPipelineBoardPage = lazyPage(() => import('../pages/accounts/AccountPipelineBoardPage.jsx'));
const RequirementsListPage = lazyPage(() => import('../pages/requirements/RequirementsListPage.jsx'));
const RequirementDetailPage = lazyPage(() => import('../pages/requirements/RequirementDetailPage.jsx'));
const RequirementKanbanPage = lazyPage(() => import('../pages/requirements/RequirementKanbanPage.jsx'));
const ProfilesListPage = lazyPage(() => import('../pages/profiles/ProfilesListPage.jsx'));
const ProfileDetailPage = lazyPage(() => import('../pages/profiles/ProfileDetailPage.jsx'));
const SubmissionsListPage = lazyPage(() => import('../pages/submissions/SubmissionsListPage.jsx'));
const RejectedCandidatesPage = lazyPage(() => import('../pages/submissions/RejectedCandidatesPage.jsx'));
const SubmissionDetailPage = lazyPage(() => import('../pages/submissions/SubmissionDetailPage.jsx'));
const ReportsPage = lazyPage(() => import('../pages/reports/ReportsPage.jsx'));
const WebsitePage = lazyPage(() => import('../pages/website/WebsitePage.jsx'));
const CalendarPage = lazyPage(() => import('../pages/calendar/CalendarPage.jsx'));
const NotificationsPage = lazyPage(() => import('../pages/notifications/NotificationsPage.jsx'));
const SettingsPage = lazyPage(() => import('../pages/settings/SettingsPage.jsx'));
const HiringPage = lazyPage(() => import('../pages/hiring/HiringPage.jsx'));
const PeopleHubPage = lazyPage(() => import('../pages/people/PeopleHubPage.jsx'));
const EmployeeProfilePage = lazyPage(() => import('../pages/people/EmployeeProfilePage.jsx'));
const TimeAttendanceHubPage = lazyPage(() => import('../pages/time/TimeAttendanceHubPage.jsx'));
const FinanceHubPage = lazyPage(() => import('../pages/finance/FinanceHubPage.jsx'));
const PayrollHubPage = lazyPage(() => import('../pages/payroll/PayrollHubPage.jsx'));
const GroupOverviewPage = lazyPage(() => import('../pages/groupOverview/GroupOverviewPage.jsx'));
const GuestPortalPage = lazyPage(() => import('../pages/guest/GuestPortalPage.jsx'));
const GuestProjectPage = lazyPage(() => import('../pages/guest/GuestProjectPage.jsx'));
const OfficesPage = lazyPage(() => import('../pages/offices/OfficesPage.jsx'));
const InternalJobsPage = lazyPage(() => import('../pages/internalJobs/InternalJobsPage.jsx'));
const SpeakUpPage = lazyPage(() => import('../pages/speakup/SpeakUpPage.jsx'));
const EmployeeFeedbackPage = lazyPage(() => import('../pages/employeeFeedback/EmployeeFeedbackPage.jsx'));
const InterviewFeedbackPage = lazyPage(() => import('../pages/interviewFeedback/InterviewFeedbackPage.jsx'));
const CareerRedirect = lazyPage(() => import('../pages/public/CareerRedirect.jsx'));
const AssessmentTakePage = lazyPage(() => import('../pages/public/AssessmentTakePage.jsx'));
const AiInterviewPage = lazyPage(() => import('../pages/public/AiInterviewPage.jsx'));
const VendorPortalPage = lazyPage(() => import('../pages/vendorPortal/VendorPortalPage.jsx'));
const LeadFormPage = lazyPage(() => import('../pages/public/LeadFormPage.jsx'));
const HiringSetupPage = lazyPage(() => import('../pages/hiringSetup/HiringSetupPage.jsx'));
const AnalyticsPage = lazyPage(() => import('../pages/analytics/AnalyticsPage.jsx'));
const FinancialsPage = lazyPage(() => import('../pages/financials/FinancialsPage.jsx'));
const TradingHubPage = lazyPage(() => import('../pages/trading/TradingHubPage.jsx'));
const LeadsPage = lazyPage(() => import('../pages/leads/LeadsPage.jsx'));
const ContractsPage = lazyPage(() => import('../pages/contracts/ContractsPage.jsx'));
const ProjectsHubPage = lazyPage(() => import('../pages/projects/ProjectsHubPage.jsx'));
const ProjectDetailPage = lazyPage(() => import('../pages/projects/ProjectDetailPage.jsx'));
const PmProjectsPage = lazyPage(() => import('../pages/pm/PmProjectsPage.jsx'));
const PmProjectDetailPage = lazyPage(() => import('../pages/pm/PmProjectDetailPage.jsx'));
const ZephyrHomePage = lazyPage(() => import('../pages/zephyr/ZephyrHomePage.jsx'));
const ZephyrSectionPage = lazyPage(() => import('../pages/zephyr/ZephyrSectionPage.jsx'));
const ZephyrPartiesPage = lazyPage(() => import('../pages/zephyr/ZephyrPartiesPage.jsx'));
const ZephyrLeadsPage = lazyPage(() => import('../pages/zephyr/ZephyrLeadsPage.jsx'));
const ZephyrProjectsPage = lazyPage(() => import('../pages/zephyr/ZephyrProjectsPage.jsx'));
const ZephyrPeoplePage = lazyPage(() => import('../pages/zephyr/ZephyrPeoplePage.jsx'));
const ZephyrOverviewPage = lazyPage(() => import('../pages/zephyr/ZephyrOverviewPage.jsx'));
const ZephyrFinancialsPage = lazyPage(() => import('../pages/zephyr/ZephyrFinancialsPage.jsx'));
const ZephyrMyWorkPage = lazyPage(() => import('../pages/zephyr/ZephyrMyWorkPage.jsx'));
const ZephyrProjectDetailPage = lazyPage(() => import('../pages/zephyr/ZephyrProjectDetailPage.jsx'));
const ZephyrSettingsPage = lazyPage(() => import('../pages/zephyr/ZephyrSettingsPage.jsx'));
const ZephyrPropertiesPage = lazyPage(() => import('../pages/zephyr/ZephyrPropertiesPage.jsx'));
const ZephyrPropertyDetailPage = lazyPage(() => import('../pages/zephyr/ZephyrPropertyDetailPage.jsx'));
const ZephyrRentPage = lazyPage(() => import('../pages/zephyr/ZephyrRentPage.jsx'));
const ZephyrWagesPage = lazyPage(() => import('../pages/zephyr/ZephyrWagesPage.jsx'));
const ZephyrTasksPage = lazyPage(() => import('../pages/zephyr/ZephyrTasksPage.jsx'));
import { isZephyrOrg } from '../lib/zephyr/useZephyr.js';
const GulatiHomePage = lazyPage(() => import('../pages/gulati/GulatiHomePage.jsx'));
const GulatiPartiesPage = lazyPage(() => import('../pages/gulati/GulatiPartiesPage.jsx'));
const GulatiLeadsPage = lazyPage(() => import('../pages/gulati/GulatiLeadsPage.jsx'));
const GulatiDealsPage = lazyPage(() => import('../pages/gulati/GulatiDealsPage.jsx'));
const GulatiDealDetailPage = lazyPage(() => import('../pages/gulati/GulatiDealDetailPage.jsx'));
const GulatiFinancePage = lazyPage(() => import('../pages/gulati/GulatiFinancePage.jsx'));
const GulatiFinancialsPage = lazyPage(() => import('../pages/gulati/GulatiFinancialsPage.jsx'));
const GulatiTasksPage = lazyPage(() => import('../pages/gulati/GulatiTasksPage.jsx'));
const GulatiPeoplePage = lazyPage(() => import('../pages/gulati/GulatiPeoplePage.jsx'));
const GulatiMyWorkPage = lazyPage(() => import('../pages/gulati/GulatiMyWorkPage.jsx'));
const GulatiSettingsPage = lazyPage(() => import('../pages/gulati/GulatiSettingsPage.jsx'));
import { isGulatiOrg } from '../lib/gulati/useGulati.js';
const AcconcyHomePage = lazyPage(() => import('../pages/acconcy/AcconcyHomePage.jsx'));
const AcconcyPartiesPage = lazyPage(() => import('../pages/acconcy/AcconcyPartiesPage.jsx'));
const AcconcyLeadsPage = lazyPage(() => import('../pages/acconcy/AcconcyLeadsPage.jsx'));
const AcconcyDealsPage = lazyPage(() => import('../pages/acconcy/AcconcyDealsPage.jsx'));
const AcconcyDealDetailPage = lazyPage(() => import('../pages/acconcy/AcconcyDealDetailPage.jsx'));
const AcconcyFinancePage = lazyPage(() => import('../pages/acconcy/AcconcyFinancePage.jsx'));
const AcconcyFinancialsPage = lazyPage(() => import('../pages/acconcy/AcconcyFinancialsPage.jsx'));
const AcconcyInvestmentsPage = lazyPage(() => import('../pages/acconcy/AcconcyInvestmentsPage.jsx'));
const AcconcySalariesPage = lazyPage(() => import('../pages/acconcy/AcconcySalariesPage.jsx'));
const AcconcyReportsPage = lazyPage(() => import('../pages/acconcy/AcconcyReportsPage.jsx'));
const AcconcyTasksPage = lazyPage(() => import('../pages/acconcy/AcconcyTasksPage.jsx'));
const AcconcyPeoplePage = lazyPage(() => import('../pages/acconcy/AcconcyPeoplePage.jsx'));
const AcconcyMyWorkPage = lazyPage(() => import('../pages/acconcy/AcconcyMyWorkPage.jsx'));
const AcconcySettingsPage = lazyPage(() => import('../pages/acconcy/AcconcySettingsPage.jsx'));
const FoundationHomePage = lazyPage(() => import('../pages/foundation/FoundationHomePage.jsx'));
const FoundationCampaignsPage = lazyPage(() => import('../pages/foundation/FoundationCampaignsPage.jsx'));
const FoundationCampaignDetailPage = lazyPage(() => import('../pages/foundation/FoundationCampaignDetailPage.jsx'));
const FoundationFundsPage = lazyPage(() => import('../pages/foundation/FoundationFundsPage.jsx'));
const FoundationInitiativesPage = lazyPage(() => import('../pages/foundation/FoundationInitiativesPage.jsx'));
const FoundationFinancialsPage = lazyPage(() => import('../pages/foundation/FoundationFinancialsPage.jsx'));
const FoundationReportsPage = lazyPage(() => import('../pages/foundation/FoundationReportsPage.jsx'));
const FoundationPeoplePage = lazyPage(() => import('../pages/foundation/FoundationPeoplePage.jsx'));
const FoundationSettingsPage = lazyPage(() => import('../pages/foundation/FoundationSettingsPage.jsx'));
const ZklyreraHomePage = lazyPage(() => import('../pages/zklyrera/ZklyreraHomePage.jsx'));
const ZklyreraInvestmentsPage = lazyPage(() => import('../pages/zklyrera/ZklyreraInvestmentsPage.jsx'));
const ZklyreraEntriesPage = lazyPage(() => import('../pages/zklyrera/ZklyreraEntriesPage.jsx'));
const ZklyreraTransactionsPage = lazyPage(() => import('../pages/zklyrera/ZklyreraTransactionsPage.jsx'));
const ZklyreraReportsPage = lazyPage(() => import('../pages/zklyrera/ZklyreraReportsPage.jsx'));
const ZklyreraProjectionsPage = lazyPage(() => import('../pages/zklyrera/ZklyreraProjectionsPage.jsx'));
const ZklyreraFinancialsPage = lazyPage(() => import('../pages/zklyrera/ZklyreraFinancialsPage.jsx'));
const ZklyreraPeoplePage = lazyPage(() => import('../pages/zklyrera/ZklyreraPeoplePage.jsx'));
const ZklyreraSettingsPage = lazyPage(() => import('../pages/zklyrera/ZklyreraSettingsPage.jsx'));
import { isZklyreraOrg } from '../lib/zklyrera/useZklyrera.js';
const ValterraHomePage = lazyPage(() => import('../pages/valterra/ValterraHomePage.jsx'));
const NovarexHomePage = lazyPage(() => import('../pages/novarex/NovarexHomePage.jsx'));
const NovarexOperationsPage = lazyPage(() => import('../pages/novarex/NovarexOperationsPage.jsx'));
const NovarexProductsPage = lazyPage(() => import('../pages/novarex/NovarexProductsPage.jsx'));
const NovarexPurchasingPage = lazyPage(() => import('../pages/novarex/NovarexPurchasingPage.jsx'));
const NovarexStockPage = lazyPage(() => import('../pages/novarex/NovarexStockPage.jsx'));
const NovarexSalesPage = lazyPage(() => import('../pages/novarex/NovarexSalesPage.jsx'));
const NovarexLogisticsPage = lazyPage(() => import('../pages/novarex/NovarexLogisticsPage.jsx'));
const NovarexInvoicesPage = lazyPage(() => import('../pages/novarex/NovarexInvoicesPage.jsx'));
const NovarexReturnsPage = lazyPage(() => import('../pages/novarex/NovarexReturnsPage.jsx'));
const NovarexFranchisePage = lazyPage(() => import('../pages/novarex/NovarexFranchisePage.jsx'));
const ValterraSitesPage = lazyPage(() => import('../pages/valterra/ValterraSitesPage.jsx'));
const NovarexOutletsPage = lazyPage(() => import('../pages/novarex/NovarexOutletsPage.jsx'));
const ValterraSiteDetailPage = lazyPage(() => import('../pages/valterra/ValterraSiteDetailPage.jsx'));
const NovarexOutletDetailPage = lazyPage(() => import('../pages/novarex/NovarexOutletDetailPage.jsx'));
const ValterraInvestmentsPage = lazyPage(() => import('../pages/valterra/ValterraInvestmentsPage.jsx'));
const NovarexInvestmentsPage = lazyPage(() => import('../pages/novarex/NovarexInvestmentsPage.jsx'));
const ValterraEntriesPage = lazyPage(() => import('../pages/valterra/ValterraEntriesPage.jsx'));
const NovarexEntriesPage = lazyPage(() => import('../pages/novarex/NovarexEntriesPage.jsx'));
const ValterraTransactionsPage = lazyPage(() => import('../pages/valterra/ValterraTransactionsPage.jsx'));
const NovarexTransactionsPage = lazyPage(() => import('../pages/novarex/NovarexTransactionsPage.jsx'));
const ValterraReportsPage = lazyPage(() => import('../pages/valterra/ValterraReportsPage.jsx'));
const NovarexReportsPage = lazyPage(() => import('../pages/novarex/NovarexReportsPage.jsx'));
const ValterraProjectionsPage = lazyPage(() => import('../pages/valterra/ValterraProjectionsPage.jsx'));
const NovarexProjectionsPage = lazyPage(() => import('../pages/novarex/NovarexProjectionsPage.jsx'));
const ValterraFinancialsPage = lazyPage(() => import('../pages/valterra/ValterraFinancialsPage.jsx'));
const NovarexFinancialsPage = lazyPage(() => import('../pages/novarex/NovarexFinancialsPage.jsx'));
const ValterraPeoplePage = lazyPage(() => import('../pages/valterra/ValterraPeoplePage.jsx'));
const NovarexPeoplePage = lazyPage(() => import('../pages/novarex/NovarexPeoplePage.jsx'));
const ValterraSettingsPage = lazyPage(() => import('../pages/valterra/ValterraSettingsPage.jsx'));
const NovarexSettingsPage = lazyPage(() => import('../pages/novarex/NovarexSettingsPage.jsx'));
import { isValterraOrg } from '../lib/valterra/useValterra.js';
import { isDelphicOneOrg } from '../lib/delphicone/useDelphicOne.js';
const DelphicOneHomePage = lazyPage(() => import('../pages/delphicone/DelphicOneHomePage.jsx'));
const DelphicOneCustomersPage = lazyPage(() => import('../pages/delphicone/DelphicOneCustomersPage.jsx'));
const DelphicOneLeadsPage = lazyPage(() => import('../pages/delphicone/DelphicOneLeadsPage.jsx'));
const DelphicOneInvoicesPage = lazyPage(() => import('../pages/delphicone/DelphicOneInvoicesPage.jsx'));
const DelphicOneTeamPage = lazyPage(() => import('../pages/delphicone/DelphicOneTeamPage.jsx'));
const PlatformPage = lazyPage(() => import('../pages/platform/PlatformPage.jsx'));
import { isNovarexOrg } from '../lib/novarex/useNovarex.js';
import { isAcconcyOrg } from '../lib/acconcy/useAcconcy.js';
import { isFoundationOrg } from '../lib/foundation/useFoundation.js';
import { canSeeMeetingsCalendar } from '../lib/departments.js';

function LoadingScreen() {
  return <div className="flex h-screen items-center justify-center text-tertiary-500">Loading…</div>;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/**
 * Legacy `/:base/:id/edit` deep-links now open the edit Drawer on the
 * detail page instead of a dedicated full page — redirect there.
 */
function EditRedirect({ base }) {
  const { id } = useParams();
  return <Navigate to={`/${base}/${id}?edit=1`} replace />;
}

/** Keep old /accounts/:id/board links working → /pipeline/:accountId */
function AccountBoardRedirect() {
  const { id } = useParams();
  return <Navigate to={`/pipeline/${id}`} replace />;
}

/**
 * Redirect when the current user lacks the required capability.
 */
// Where an admin lands instead of the (temporarily hidden) dashboard.
const ADMIN_HOME = '/finance';

/**
 * Home: contractors get their portal instead of the dashboard. Admins are sent
 * to Finance while the admin dashboard is hidden (its numbers are not correct
 * yet) — DashboardPage itself is untouched and still renders for other roles.
 */
function HomePage() {
  const { user } = useAuth();
  // Zephyr is a standalone workspace with its own home.
  if (isZephyrOrg(user)) return <Navigate to="/zephyr" replace />;
  // Gulati Industries is a standalone workspace with its own home.
  if (isGulatiOrg(user)) return <Navigate to="/gulati" replace />;
  // Acconcy Finance is a standalone workspace with its own home.
  if (isAcconcyOrg(user)) return <Navigate to="/acconcy" replace />;
  // Gulati Foundation is a standalone workspace with its own home.
  if (isFoundationOrg(user)) return <Navigate to="/foundation" replace />;
  // Zklyrera Spirits is a standalone workspace with its own home.
  if (isZklyreraOrg(user)) return <Navigate to="/zklyrera" replace />;
  // Valterra Resources is a standalone workspace with its own home.
  // Novarex Pharmaceuticals is a standalone workspace with its own home.
  if (isValterraOrg(user)) return <Navigate to="/valterra" replace />;
  if (isNovarexOrg(user)) return <Navigate to="/novarex" replace />;
  // Delphic One (the company that sells the product) is a standalone workspace with its own home.
  if (isDelphicOneOrg(user)) return <Navigate to="/delphic-one" replace />;
  if (user?.worker_type === 'contractor') return <ContractorPortalPage />;
  if (isAdminUser(user)) return <Navigate to={ADMIN_HOME} replace />;
  return (
    <HomePreloaderGate>
      <DashboardPage />
    </HomePreloaderGate>
  );
}

function RequirePermission({ capability, need, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  // A company on permissions: a short "no access" page, never an empty one. `need` names the exact permission for the page.
  if (isPermissionMode(user)) return (need ? hasNeed(user, need) : userCan(user, capability)) ? children : <NoAccess />;
  if (!can(user.role, capability)) return <Navigate to="/" replace />;
  return children;
}

/**
 * /submissions/:id (an old or a new link): the full candidate page for people who can open submissions; everyone else - an interviewer who was
 * sent the link, for example - lands on the Interview feedback page of that candidate, where they can give the feedback of the round they took.
 */
function SubmissionOrFeedback() {
  const { user, loading } = useAuth();
  const { id } = useParams();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  const allowed = isPermissionMode(user) ? hasNeed(user, 'submissions.view') : can(user.role, 'viewPipeline');
  return allowed ? <SubmissionDetailPage /> : <Navigate to={`/interview-feedback/${id}`} replace />;
}

/** Only acts in a company on permissions: the page needs one of these permissions (a basic item or a grant). */
function RequireAccess({ need, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (isPermissionMode(user) && !hasNeed(user, need)) return <NoAccess />;
  return children;
}

/** The meetings / interviews calendar — Sales, HR and Management departments (and admins). */
function RequireMeetingsCalendar({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canSeeMeetingsCalendar(user)) return <Navigate to="/" replace />;
  return children;
}

/**
 * Vertical modules (trading, leads, contracts, projects) need both the role capability
 * and the module switched on for the ACTIVE company; otherwise redirect home.
 */
function RequireModule({ module, capability, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.active_org?.enabled_modules?.includes(module) || !can(user.role, capability)) return <Navigate to="/" replace />;
  return children;
}

/**
 * The recruitment pipeline (accounts/requirements/profiles/submissions/pipeline),
 * Reports, Analytics, and Financials are Delphic-Global-only — every other
 * company in the group runs a different line of business and doesn't recruit.
 * Mirrors requireMasterWorkspace on the backend (server/src/middleware).
 */
function RequireMasterWorkspace({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.active_org?.is_master_workspace) return <Navigate to="/" replace />;
  return children;
}

/** The Zephyr workspace needs the `zephyr` module on the ACTIVE company. */
function RequireZephyr({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isZephyrOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Gulati workspace needs the `gulati` module on the ACTIVE company. */
function RequireGulati({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isGulatiOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Acconcy workspace needs the `acconcy` module on the ACTIVE company. */
function RequireAcconcy({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAcconcyOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Valterra Resources workspace needs the `valterra` module on the ACTIVE company. */
function RequireValterra({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isValterraOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Delphic One workspace needs the `delphic_one` module on the ACTIVE company. */
function RequireDelphicOne({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isDelphicOneOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Novarex Pharmaceuticals workspace needs the `novarex` module on the ACTIVE company. */
function RequireNovarex({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isNovarexOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Zklyrera Spirits workspace needs the `zklyrera` module on the ACTIVE company. */
function RequireZklyrera({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isZklyreraOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** The Gulati Foundation workspace needs the `foundation` module on the ACTIVE company. */
function RequireFoundation({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isFoundationOrg(user)) return <Navigate to="/" replace />;
  return children;
}

/** Group Overview is gated on the per-user is_group_superadmin flag, not a role capability. */
function RequireGroupSuperadmin({ children }) {
  const { user, loading, isGroupSuperadmin } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isGroupSuperadmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/vendor-portal" element={<VendorPortalPage />} />
      <Route path="/lead-form/:token" element={<LeadFormPage />} />
      <Route path="/guest-access" element={<GuestPortalPage />} />
      <Route path="/guest-project" element={<GuestProjectPage />} />
      <Route path="/assessment/:token" element={<AssessmentTakePage />} />
      <Route path="/ai-interview/:token" element={<AiInterviewPage />} />
      <Route path="/careers" element={<CareerRedirect />} />
      <Route path="/careers/:slug" element={<CareerRedirect />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<HomePage />}
        />
        {/* Recruitment pipeline — Delphic Global only (see RequireMasterWorkspace), and only
            for roles with pipeline access (RequirePermission) — keeps a self-service-only
            role (e.g. employee/IT) off these pages even via a typed URL, not just the sidebar. */}
        <Route path="accounts" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="accounts.view"><AccountsListPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/suggestions" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="accounts.view"><AiClientSuggestionsPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/new" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="accounts.view"><Navigate to="/accounts?create=1" replace /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/:id/board" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="accounts.view"><AccountBoardRedirect /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/:id" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="accounts.view"><AccountDetailPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/:id/edit" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="accounts.view"><EditRedirect base="accounts" /></RequirePermission></RequireMasterWorkspace>} />
        <Route
          path="pipeline"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewPipeline" need="pipeline.view">
                <PipelineShell />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route
          path="pipeline/:accountId"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewPipeline" need="pipeline.view">
                <AccountPipelineBoardPage />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route path="requirements" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="requirements.view"><RequirementsListPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="hiring-setup" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="requirements.update"><HiringSetupPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/new" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="requirements.view"><Navigate to="/requirements?create=1" replace /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/:id/edit" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="requirements.view"><EditRedirect base="requirements" /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/:id/board" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="requirements.view"><RequirementKanbanPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/:id" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="requirements.view"><RequirementDetailPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route
          path="profiles"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewProfiles">
                <ProfilesListPage />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route path="profiles/new" element={<RequireMasterWorkspace><Navigate to="/profiles?create=1" replace /></RequireMasterWorkspace>} />
        <Route
          path="profiles/:id"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewProfiles">
                <ProfileDetailPage />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route path="profiles/:id/edit" element={<RequireMasterWorkspace><EditRedirect base="profiles" /></RequireMasterWorkspace>} />
        <Route path="submissions" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="submissions.view"><SubmissionsListPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="rejected-candidates" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="rejected.view"><RejectedCandidatesPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="submissions/new" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline" need="submissions.view"><Navigate to="/submissions?create=1" replace /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="submissions/:id" element={<RequireMasterWorkspace><SubmissionOrFeedback /></RequireMasterWorkspace>} />
        <Route path="interview-feedback" element={<RequireMasterWorkspace><RequireAccess need="basic.interview_feedback"><InterviewFeedbackPage /></RequireAccess></RequireMasterWorkspace>} />
        <Route path="interview-feedback/:submissionId" element={<RequireMasterWorkspace><RequireAccess need="basic.interview_feedback"><InterviewFeedbackPage /></RequireAccess></RequireMasterWorkspace>} />
        {/* Zephyr Infrastructure: standalone workspace. Module + role gating is enforced
            by the server; AppLayout keeps Zephyr users off every Delphic page. */}
        <Route path="zephyr" element={<RequireZephyr><ZephyrHomePage /></RequireZephyr>} />
        <Route path="zephyr/settings" element={<RequireZephyr><ZephyrSettingsPage /></RequireZephyr>} />
        <Route path="zephyr/overview" element={<RequireZephyr><ZephyrOverviewPage /></RequireZephyr>} />
        <Route path="zephyr/financials" element={<RequireZephyr><ZephyrFinancialsPage /></RequireZephyr>} />
        <Route path="zephyr/people" element={<RequireZephyr><ZephyrPeoplePage /></RequireZephyr>} />
        <Route path="zephyr/my-work" element={<RequireZephyr><ZephyrMyWorkPage /></RequireZephyr>} />
        <Route path="zephyr/projects" element={<RequireZephyr><ZephyrProjectsPage /></RequireZephyr>} />
        <Route path="zephyr/projects/:id" element={<RequireZephyr><ZephyrProjectDetailPage /></RequireZephyr>} />
        <Route path="zephyr/properties" element={<RequireZephyr><ZephyrPropertiesPage /></RequireZephyr>} />
        <Route path="zephyr/properties/:id" element={<RequireZephyr><ZephyrPropertyDetailPage /></RequireZephyr>} />
        <Route path="zephyr/rent" element={<RequireZephyr><ZephyrRentPage /></RequireZephyr>} />
        <Route path="zephyr/wages" element={<RequireZephyr><ZephyrWagesPage /></RequireZephyr>} />
        <Route path="zephyr/tasks" element={<RequireZephyr><ZephyrTasksPage /></RequireZephyr>} />
        <Route path="zephyr/leads" element={<RequireZephyr><ZephyrLeadsPage /></RequireZephyr>} />
        <Route path="zephyr/parties" element={<RequireZephyr><ZephyrPartiesPage /></RequireZephyr>} />
        <Route path="zephyr/:section" element={<RequireZephyr><ZephyrSectionPage /></RequireZephyr>} />

        {/* Gulati Industries: standalone trading workspace. Module + role gating is enforced by the server. */}
        <Route path="gulati" element={<RequireGulati><GulatiHomePage /></RequireGulati>} />
        <Route path="gulati/parties" element={<RequireGulati><GulatiPartiesPage /></RequireGulati>} />
        <Route path="gulati/leads" element={<RequireGulati><GulatiLeadsPage /></RequireGulati>} />
        <Route path="gulati/deals" element={<RequireGulati><GulatiDealsPage /></RequireGulati>} />
        <Route path="gulati/deals/:id" element={<RequireGulati><GulatiDealDetailPage /></RequireGulati>} />
        <Route path="gulati/finance" element={<RequireGulati><GulatiFinancePage /></RequireGulati>} />
        <Route path="gulati/financials" element={<RequireGulati><GulatiFinancialsPage /></RequireGulati>} />
        <Route path="gulati/tasks" element={<RequireGulati><GulatiTasksPage /></RequireGulati>} />
        <Route path="gulati/people" element={<RequireGulati><GulatiPeoplePage /></RequireGulati>} />
        <Route path="gulati/my-work" element={<RequireGulati><GulatiMyWorkPage /></RequireGulati>} />
        <Route path="gulati/settings" element={<RequireGulati><GulatiSettingsPage /></RequireGulati>} />
        <Route path="gulati/*" element={<Navigate to="/gulati" replace />} />
        <Route path="acconcy" element={<RequireAcconcy><AcconcyHomePage /></RequireAcconcy>} />
        <Route path="acconcy/parties" element={<RequireAcconcy><AcconcyPartiesPage /></RequireAcconcy>} />
        <Route path="acconcy/leads" element={<RequireAcconcy><AcconcyLeadsPage /></RequireAcconcy>} />
        <Route path="acconcy/deals" element={<RequireAcconcy><AcconcyDealsPage /></RequireAcconcy>} />
        <Route path="acconcy/deals/:id" element={<RequireAcconcy><AcconcyDealDetailPage /></RequireAcconcy>} />
        <Route path="acconcy/finance" element={<RequireAcconcy><AcconcyFinancePage /></RequireAcconcy>} />
        <Route path="acconcy/financials" element={<RequireAcconcy><AcconcyFinancialsPage /></RequireAcconcy>} />
        <Route path="acconcy/investments" element={<RequireAcconcy><AcconcyInvestmentsPage /></RequireAcconcy>} />
        <Route path="acconcy/salaries" element={<RequireAcconcy><AcconcySalariesPage /></RequireAcconcy>} />
        <Route path="acconcy/reports" element={<RequireAcconcy><AcconcyReportsPage /></RequireAcconcy>} />
        <Route path="acconcy/tasks" element={<RequireAcconcy><AcconcyTasksPage /></RequireAcconcy>} />
        <Route path="acconcy/people" element={<RequireAcconcy><AcconcyPeoplePage /></RequireAcconcy>} />
        <Route path="acconcy/my-work" element={<RequireAcconcy><AcconcyMyWorkPage /></RequireAcconcy>} />
        <Route path="acconcy/settings" element={<RequireAcconcy><AcconcySettingsPage /></RequireAcconcy>} />
        <Route path="acconcy/*" element={<Navigate to="/acconcy" replace />} />
        <Route path="foundation" element={<RequireFoundation><FoundationHomePage /></RequireFoundation>} />
        <Route path="foundation/campaigns" element={<RequireFoundation><FoundationCampaignsPage /></RequireFoundation>} />
        <Route path="foundation/campaigns/:id" element={<RequireFoundation><FoundationCampaignDetailPage /></RequireFoundation>} />
        <Route path="foundation/funds" element={<RequireFoundation><FoundationFundsPage /></RequireFoundation>} />
        <Route path="foundation/initiatives" element={<RequireFoundation><FoundationInitiativesPage /></RequireFoundation>} />
        <Route path="foundation/financials" element={<RequireFoundation><FoundationFinancialsPage /></RequireFoundation>} />
        <Route path="foundation/reports" element={<RequireFoundation><FoundationReportsPage /></RequireFoundation>} />
        <Route path="foundation/people" element={<RequireFoundation><FoundationPeoplePage /></RequireFoundation>} />
        <Route path="foundation/settings" element={<RequireFoundation><FoundationSettingsPage /></RequireFoundation>} />
        <Route path="foundation/*" element={<Navigate to="/foundation" replace />} />
        <Route path="zklyrera" element={<RequireZklyrera><ZklyreraHomePage /></RequireZklyrera>} />
        <Route path="zklyrera/investments" element={<RequireZklyrera><ZklyreraInvestmentsPage /></RequireZklyrera>} />
        <Route path="zklyrera/income" element={<RequireZklyrera><ZklyreraEntriesPage type="income" /></RequireZklyrera>} />
        <Route path="zklyrera/expenses" element={<RequireZklyrera><ZklyreraEntriesPage type="expense" /></RequireZklyrera>} />
        <Route path="zklyrera/salaries" element={<RequireZklyrera><ZklyreraEntriesPage type="salary" /></RequireZklyrera>} />
        <Route path="zklyrera/transactions" element={<RequireZklyrera><ZklyreraTransactionsPage /></RequireZklyrera>} />
        <Route path="zklyrera/reports" element={<RequireZklyrera><ZklyreraReportsPage /></RequireZklyrera>} />
        <Route path="zklyrera/projections" element={<RequireZklyrera><ZklyreraProjectionsPage /></RequireZklyrera>} />
        <Route path="zklyrera/financials" element={<RequireZklyrera><ZklyreraFinancialsPage /></RequireZklyrera>} />
        <Route path="zklyrera/people" element={<RequireZklyrera><ZklyreraPeoplePage /></RequireZklyrera>} />
        <Route path="zklyrera/settings" element={<RequireZklyrera><ZklyreraSettingsPage /></RequireZklyrera>} />
        <Route path="zklyrera/*" element={<Navigate to="/zklyrera" replace />} />
        <Route path="delphic-one" element={<RequireDelphicOne><DelphicOneHomePage /></RequireDelphicOne>} />
        <Route path="delphic-one/customers" element={<RequireDelphicOne><DelphicOneCustomersPage /></RequireDelphicOne>} />
        <Route path="delphic-one/leads" element={<RequireDelphicOne><DelphicOneLeadsPage /></RequireDelphicOne>} />
        <Route path="delphic-one/invoices" element={<RequireDelphicOne><DelphicOneInvoicesPage /></RequireDelphicOne>} />
        <Route path="delphic-one/team" element={<RequireDelphicOne><DelphicOneTeamPage /></RequireDelphicOne>} />
        {/* SaaS platform administration: reached by address only; the page checks the platform-admin list itself */}
        <Route path="platform" element={<PlatformPage />} />
        <Route path="valterra" element={<RequireValterra><ValterraHomePage /></RequireValterra>} />
        <Route path="novarex" element={<RequireNovarex><NovarexHomePage /></RequireNovarex>} />
        <Route path="valterra/sites" element={<RequireValterra><ValterraSitesPage /></RequireValterra>} />
        <Route path="novarex/operations" element={<RequireNovarex><NovarexOperationsPage /></RequireNovarex>} />
        <Route path="novarex/products" element={<RequireNovarex><NovarexProductsPage /></RequireNovarex>} />
        <Route path="novarex/purchasing" element={<RequireNovarex><NovarexPurchasingPage /></RequireNovarex>} />
        <Route path="novarex/stock" element={<RequireNovarex><NovarexStockPage /></RequireNovarex>} />
        <Route path="novarex/sales" element={<RequireNovarex><NovarexSalesPage /></RequireNovarex>} />
        <Route path="novarex/logistics" element={<RequireNovarex><NovarexLogisticsPage /></RequireNovarex>} />
        <Route path="novarex/invoices" element={<RequireNovarex><NovarexInvoicesPage /></RequireNovarex>} />
        <Route path="novarex/returns" element={<RequireNovarex><NovarexReturnsPage /></RequireNovarex>} />
        <Route path="novarex/franchise" element={<RequireNovarex><NovarexFranchisePage /></RequireNovarex>} />
        <Route path="novarex/outlets" element={<RequireNovarex><NovarexOutletsPage /></RequireNovarex>} />
        <Route path="valterra/sites/:id" element={<RequireValterra><ValterraSiteDetailPage /></RequireValterra>} />
        <Route path="novarex/outlets/:id" element={<RequireNovarex><NovarexOutletDetailPage /></RequireNovarex>} />
        <Route path="valterra/investments" element={<RequireValterra><ValterraInvestmentsPage /></RequireValterra>} />
        <Route path="novarex/investments" element={<RequireNovarex><NovarexInvestmentsPage /></RequireNovarex>} />
        <Route path="valterra/income" element={<RequireValterra><ValterraEntriesPage type="income" /></RequireValterra>} />
        <Route path="novarex/income" element={<RequireNovarex><NovarexEntriesPage type="income" /></RequireNovarex>} />
        <Route path="valterra/expenses" element={<RequireValterra><ValterraEntriesPage type="expense" /></RequireValterra>} />
        <Route path="novarex/expenses" element={<RequireNovarex><NovarexEntriesPage type="expense" /></RequireNovarex>} />
        <Route path="valterra/salaries" element={<RequireValterra><ValterraEntriesPage type="salary" /></RequireValterra>} />
        <Route path="novarex/salaries" element={<RequireNovarex><NovarexEntriesPage type="salary" /></RequireNovarex>} />
        <Route path="valterra/transactions" element={<RequireValterra><ValterraTransactionsPage /></RequireValterra>} />
        <Route path="novarex/transactions" element={<RequireNovarex><NovarexTransactionsPage /></RequireNovarex>} />
        <Route path="valterra/reports" element={<RequireValterra><ValterraReportsPage /></RequireValterra>} />
        <Route path="novarex/reports" element={<RequireNovarex><NovarexReportsPage /></RequireNovarex>} />
        <Route path="valterra/projections" element={<RequireValterra><ValterraProjectionsPage /></RequireValterra>} />
        <Route path="novarex/projections" element={<RequireNovarex><NovarexProjectionsPage /></RequireNovarex>} />
        <Route path="valterra/financials" element={<RequireValterra><ValterraFinancialsPage /></RequireValterra>} />
        <Route path="novarex/financials" element={<RequireNovarex><NovarexFinancialsPage /></RequireNovarex>} />
        <Route path="valterra/people" element={<RequireValterra><ValterraPeoplePage /></RequireValterra>} />
        <Route path="novarex/people" element={<RequireNovarex><NovarexPeoplePage /></RequireNovarex>} />
        <Route path="valterra/settings" element={<RequireValterra><ValterraSettingsPage /></RequireValterra>} />
        <Route path="novarex/settings" element={<RequireNovarex><NovarexSettingsPage /></RequireNovarex>} />
        <Route path="valterra/*" element={<Navigate to="/valterra" replace />} />
        <Route path="novarex/*" element={<Navigate to="/novarex" replace />} />
        <Route path="calendar" element={<RequireMeetingsCalendar><RequireAccess need="basic.calendar"><CalendarPage /></RequireAccess></RequireMeetingsCalendar>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route
          path="notifications/preferences"
          element={<Navigate to="/settings?tab=notifications" replace />}
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="hiring" element={<HiringPage />} />
        <Route path="people" element={<RequireAccess need={['basic.people_directory', 'basic.org_chart', 'basic.policies', 'people.view', 'users.view', 'allocations.view', 'assets.view', 'hr_settings.view']}><PeopleHubPage /></RequireAccess>} />
        <Route path="offices" element={<RequireGroupSuperadmin><OfficesPage /></RequireGroupSuperadmin>} />
        <Route path="internal-jobs" element={<RequireMasterWorkspace><RequireAccess need="basic.internal_jobs"><InternalJobsPage /></RequireAccess></RequireMasterWorkspace>} />
        <Route path="speak-up" element={<RequireMasterWorkspace><RequireAccess need="basic.whistleblower"><SpeakUpPage /></RequireAccess></RequireMasterWorkspace>} />
        <Route path="employee-feedback" element={<RequireMasterWorkspace><RequireAccess need="basic.employee_feedback"><EmployeeFeedbackPage /></RequireAccess></RequireMasterWorkspace>} />
        <Route path="people/:id" element={<RequireAccess need="basic.people_directory"><EmployeeProfilePage /></RequireAccess>} />
        {/* Merged into the People / Time & Attendance hubs — keep old links working. */}
        <Route path="people/settings" element={<Navigate to="/people?section=hr-settings" replace />} />
        <Route path="users" element={<Navigate to="/people?section=users" replace />} />
        <Route path="attendance" element={<RequireAccess need={['basic.attendance', 'basic.leave', 'basic.timesheet']}><TimeAttendanceHubPage /></RequireAccess>} />
        <Route path="leave" element={<Navigate to="/attendance?section=leave" replace />} />
        <Route path="finance" element={<RequireAccess need={['basic.expenses', 'finance.view', 'billing.view', 'analytics.view']}><FinanceHubPage /></RequireAccess>} />
        <Route path="payroll" element={<RequireAccess need={['basic.payslips', 'payroll.view']}><PayrollHubPage /></RequireAccess>} />
        <Route path="analytics" element={<RequireMasterWorkspace><RequirePermission capability="viewAnalytics"><AnalyticsPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="financials" element={<RequireMasterWorkspace><RequirePermission capability="viewFinancials"><FinancialsPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="trading" element={<RequireModule module="trading" capability="viewTrading"><TradingHubPage /></RequireModule>} />
        <Route path="leads" element={<RequireModule module="leads" capability="viewLeads"><LeadsPage /></RequireModule>} />
        <Route path="contracts" element={<RequireModule module="contracts" capability="viewContracts"><ContractsPage /></RequireModule>} />
        <Route path="projects" element={<RequireModule module="projects" capability="viewProjects"><ProjectsHubPage /></RequireModule>} />
        <Route path="projects/:id" element={<RequireModule module="projects" capability="viewProjects"><ProjectDetailPage /></RequireModule>} />
        <Route path="pm" element={<RequireMasterWorkspace><PmProjectsPage /></RequireMasterWorkspace>} />
        <Route path="pm/projects/:id" element={<RequireMasterWorkspace><PmProjectDetailPage /></RequireMasterWorkspace>} />
        <Route
          path="group-overview"
          element={
            <RequireGroupSuperadmin>
              <GroupOverviewPage />
            </RequireGroupSuperadmin>
          }
        />
        <Route
          path="group-overview/settings"
          element={
            <RequireGroupSuperadmin>
              <GroupOverviewPage />
            </RequireGroupSuperadmin>
          }
        />
        <Route
          path="reports"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewReports">
                <ReportsPage />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route path="website" element={<RequireMasterWorkspace><RequirePermission capability="manageWebsite"><WebsitePage /></RequirePermission></RequireMasterWorkspace>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
