import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from '../lib/authContext.jsx';
import { can } from '../lib/permissions.js';
import AppLayout from '../components/layout/AppLayout.jsx';
import HomePreloaderGate from '../components/HomePreloaderGate.jsx';
import LoginPage from '../pages/auth/LoginPage.jsx';
import DashboardPage from '../pages/dashboard/DashboardPage.jsx';
import ContractorPortalPage from '../pages/contractor/ContractorPortalPage.jsx';
import AccountsListPage from '../pages/accounts/AccountsListPage.jsx';
import AccountDetailPage from '../pages/accounts/AccountDetailPage.jsx';
import PipelineShell from '../pages/pipeline/PipelineShell.jsx';
import AccountPipelineBoardPage from '../pages/accounts/AccountPipelineBoardPage.jsx';
import RequirementsListPage from '../pages/requirements/RequirementsListPage.jsx';
import RequirementDetailPage from '../pages/requirements/RequirementDetailPage.jsx';
import RequirementKanbanPage from '../pages/requirements/RequirementKanbanPage.jsx';
import ProfilesListPage from '../pages/profiles/ProfilesListPage.jsx';
import ProfileDetailPage from '../pages/profiles/ProfileDetailPage.jsx';
import SubmissionsListPage from '../pages/submissions/SubmissionsListPage.jsx';
import SubmissionDetailPage from '../pages/submissions/SubmissionDetailPage.jsx';
import ReportsPage from '../pages/reports/ReportsPage.jsx';
import CalendarPage from '../pages/calendar/CalendarPage.jsx';
import NotificationsPage from '../pages/notifications/NotificationsPage.jsx';
import SettingsPage from '../pages/settings/SettingsPage.jsx';
import PeopleHubPage from '../pages/people/PeopleHubPage.jsx';
import EmployeeProfilePage from '../pages/people/EmployeeProfilePage.jsx';
import TimeAttendanceHubPage from '../pages/time/TimeAttendanceHubPage.jsx';
import FinanceHubPage from '../pages/finance/FinanceHubPage.jsx';
import PayrollHubPage from '../pages/payroll/PayrollHubPage.jsx';
import GroupOverviewPage from '../pages/groupOverview/GroupOverviewPage.jsx';
import GuestPortalPage from '../pages/guest/GuestPortalPage.jsx';
import AnalyticsPage from '../pages/analytics/AnalyticsPage.jsx';
import FinancialsPage from '../pages/financials/FinancialsPage.jsx';
import TradingHubPage from '../pages/trading/TradingHubPage.jsx';
import LeadsPage from '../pages/leads/LeadsPage.jsx';
import ContractsPage from '../pages/contracts/ContractsPage.jsx';
import ProjectsHubPage from '../pages/projects/ProjectsHubPage.jsx';
import ProjectDetailPage from '../pages/projects/ProjectDetailPage.jsx';
import ZephyrHomePage from '../pages/zephyr/ZephyrHomePage.jsx';
import ZephyrSectionPage from '../pages/zephyr/ZephyrSectionPage.jsx';
import ZephyrPartiesPage from '../pages/zephyr/ZephyrPartiesPage.jsx';
import ZephyrLeadsPage from '../pages/zephyr/ZephyrLeadsPage.jsx';
import ZephyrProjectsPage from '../pages/zephyr/ZephyrProjectsPage.jsx';
import ZephyrPeoplePage from '../pages/zephyr/ZephyrPeoplePage.jsx';
import ZephyrOverviewPage from '../pages/zephyr/ZephyrOverviewPage.jsx';
import ZephyrFinancialsPage from '../pages/zephyr/ZephyrFinancialsPage.jsx';
import ZephyrMyWorkPage from '../pages/zephyr/ZephyrMyWorkPage.jsx';
import ZephyrProjectDetailPage from '../pages/zephyr/ZephyrProjectDetailPage.jsx';
import ZephyrSettingsPage from '../pages/zephyr/ZephyrSettingsPage.jsx';
import ZephyrPropertiesPage from '../pages/zephyr/ZephyrPropertiesPage.jsx';
import ZephyrPropertyDetailPage from '../pages/zephyr/ZephyrPropertyDetailPage.jsx';
import ZephyrRentPage from '../pages/zephyr/ZephyrRentPage.jsx';
import ZephyrTasksPage from '../pages/zephyr/ZephyrTasksPage.jsx';
import { isZephyrOrg } from '../lib/zephyr/useZephyr.js';
import GulatiHomePage from '../pages/gulati/GulatiHomePage.jsx';
import GulatiPartiesPage from '../pages/gulati/GulatiPartiesPage.jsx';
import GulatiLeadsPage from '../pages/gulati/GulatiLeadsPage.jsx';
import GulatiDealsPage from '../pages/gulati/GulatiDealsPage.jsx';
import GulatiDealDetailPage from '../pages/gulati/GulatiDealDetailPage.jsx';
import GulatiFinancePage from '../pages/gulati/GulatiFinancePage.jsx';
import GulatiTasksPage from '../pages/gulati/GulatiTasksPage.jsx';
import GulatiPeoplePage from '../pages/gulati/GulatiPeoplePage.jsx';
import GulatiMyWorkPage from '../pages/gulati/GulatiMyWorkPage.jsx';
import GulatiSettingsPage from '../pages/gulati/GulatiSettingsPage.jsx';
import { isGulatiOrg } from '../lib/gulati/useGulati.js';
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
  if (user?.worker_type === 'contractor') return <ContractorPortalPage />;
  if (user?.role === 'admin') return <Navigate to={ADMIN_HOME} replace />;
  return (
    <HomePreloaderGate>
      <DashboardPage />
    </HomePreloaderGate>
  );
}

function RequirePermission({ capability, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!can(user.role, capability)) return <Navigate to="/" replace />;
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/guest-access" element={<GuestPortalPage />} />
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
        <Route path="accounts" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><AccountsListPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/new" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><Navigate to="/accounts?create=1" replace /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/:id/board" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><AccountBoardRedirect /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/:id" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><AccountDetailPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="accounts/:id/edit" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><EditRedirect base="accounts" /></RequirePermission></RequireMasterWorkspace>} />
        <Route
          path="pipeline"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewPipeline">
                <PipelineShell />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route
          path="pipeline/:accountId"
          element={
            <RequireMasterWorkspace>
              <RequirePermission capability="viewPipeline">
                <AccountPipelineBoardPage />
              </RequirePermission>
            </RequireMasterWorkspace>
          }
        />
        <Route path="requirements" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><RequirementsListPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/new" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><Navigate to="/requirements?create=1" replace /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/:id/edit" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><EditRedirect base="requirements" /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/:id/board" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><RequirementKanbanPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="requirements/:id" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><RequirementDetailPage /></RequirePermission></RequireMasterWorkspace>} />
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
        <Route path="submissions" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><SubmissionsListPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="submissions/new" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><Navigate to="/submissions?create=1" replace /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="submissions/:id" element={<RequireMasterWorkspace><RequirePermission capability="viewPipeline"><SubmissionDetailPage /></RequirePermission></RequireMasterWorkspace>} />
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
        <Route path="gulati/tasks" element={<RequireGulati><GulatiTasksPage /></RequireGulati>} />
        <Route path="gulati/people" element={<RequireGulati><GulatiPeoplePage /></RequireGulati>} />
        <Route path="gulati/my-work" element={<RequireGulati><GulatiMyWorkPage /></RequireGulati>} />
        <Route path="gulati/settings" element={<RequireGulati><GulatiSettingsPage /></RequireGulati>} />
        <Route path="gulati/*" element={<Navigate to="/gulati" replace />} />
        <Route path="calendar" element={<RequireMeetingsCalendar><CalendarPage /></RequireMeetingsCalendar>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route
          path="notifications/preferences"
          element={<Navigate to="/settings?tab=notifications" replace />}
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="people" element={<PeopleHubPage />} />
        <Route path="people/:id" element={<EmployeeProfilePage />} />
        {/* Merged into the People / Time & Attendance hubs — keep old links working. */}
        <Route path="people/settings" element={<Navigate to="/people?section=hr-settings" replace />} />
        <Route path="users" element={<Navigate to="/people?section=users" replace />} />
        <Route path="attendance" element={<TimeAttendanceHubPage />} />
        <Route path="leave" element={<Navigate to="/attendance?section=leave" replace />} />
        <Route path="finance" element={<FinanceHubPage />} />
        <Route path="payroll" element={<PayrollHubPage />} />
        <Route path="analytics" element={<RequireMasterWorkspace><RequirePermission capability="viewAnalytics"><AnalyticsPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="financials" element={<RequireMasterWorkspace><RequirePermission capability="viewFinancials"><FinancialsPage /></RequirePermission></RequireMasterWorkspace>} />
        <Route path="trading" element={<RequireModule module="trading" capability="viewTrading"><TradingHubPage /></RequireModule>} />
        <Route path="leads" element={<RequireModule module="leads" capability="viewLeads"><LeadsPage /></RequireModule>} />
        <Route path="contracts" element={<RequireModule module="contracts" capability="viewContracts"><ContractsPage /></RequireModule>} />
        <Route path="projects" element={<RequireModule module="projects" capability="viewProjects"><ProjectsHubPage /></RequireModule>} />
        <Route path="projects/:id" element={<RequireModule module="projects" capability="viewProjects"><ProjectDetailPage /></RequireModule>} />
        <Route
          path="group-overview"
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
