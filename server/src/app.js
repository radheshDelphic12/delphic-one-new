const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const accountsRoutes = require('./modules/accounts/accounts.routes');
const requirementsRoutes = require('./modules/requirements/requirements.routes');
const seatsRoutes = require('./modules/requirements/seats.routes');
const profilesRoutes = require('./modules/profiles/profiles.routes');
const submissionsRoutes = require('./modules/submissions/submissions.routes');
const interviewRoundsRoutes = require('./modules/submissions/interviewRounds.routes');
const documentsRoutes = require('./modules/documents/documents.routes');
const commentsRoutes = require('./modules/comments/comments.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const departmentsRoutes = require('./modules/departments/departments.routes');
const pipelineRoutes = require('./modules/pipeline/pipeline.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const interviewsRoutes = require('./modules/interviews/interviews.routes');
const orgsRoutes = require('./modules/orgs/orgs.routes');
const calendarsRoutes = require('./modules/calendars/calendars.routes');
const attendanceRoutes = require('./modules/attendance/attendance.routes');
const leaveRoutes = require('./modules/leave/leave.routes');
const designationsRoutes = require('./modules/designations/designations.routes');
const assetsRoutes = require('./modules/assets/assets.routes');
const clientErrorsRoutes = require('./modules/clientErrors/clientErrors.routes');
const teamsRoutes = require('./modules/teams/teams.routes');
const allocationsRoutes = require('./modules/allocations/allocations.routes');
const timesheetsRoutes = require('./modules/timesheets/timesheets.routes');
const payrollRoutes = require('./modules/payroll/payroll.routes');
const billingRoutes = require('./modules/billing/billing.routes');
const profitabilityRoutes = require('./modules/profitability/profitability.routes');
const superDashboardRoutes = require('./modules/superDashboard/superDashboard.routes');
const expensesRoutes = require('./modules/expenses/expenses.routes');
const vendorCommissionsRoutes = require('./modules/vendorCommissions/vendorCommissions.routes');
const tasksRoutes = require('./modules/tasks/tasks.routes');
const { requireFinanceModule } = require('./middleware/financeScope');
const accountingRoutes = require('./modules/accounting/accounting.routes');
const externalAccessRoutes = require('./modules/externalAccess/externalAccess.routes');
const orgChartRoutes = require('./modules/orgChart/orgChart.routes');
const tradingRoutes = require('./modules/trading/trading.routes');
const leadsRoutes = require('./modules/leads/leads.routes');
const zephyrRoutes = require('./modules/zephyr/zephyr.routes');
const contractsRoutes = require('./modules/contracts/contracts.routes');
const projectsRoutes = require('./modules/projects/projects.routes');
const financialsRoutes = require('./modules/financials/financials.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const calculationsRoutes = require('./modules/calculations/calculations.routes');
const financeCategoriesRoutes = require('./modules/financeCategories/financeCategories.routes');
const invitesRoutes = require('./modules/invites/invites.routes');
const uploadsRoutes = require('./modules/uploads/uploads.routes');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(requestLogger);
// Stored files are never served statically — each download is authorized
// against the record that owns it. See modules/uploads.
app.use('/uploads', uploadsRoutes);

// Login is stricter than the general API (brute-force); both are per-IP windows.
// The general limit is generous: the dashboard is request-dense (many widgets per
// page) and a whole office often shares one egress IP, so it must not trip in
// normal use. Read-only GETs don't count toward the budget.
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

app.get('/api/v1/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.use('/api/v1/client-errors', clientErrorsRoutes);

// Rate limit login and general API traffic outside the Jest suite.
if (env.nodeEnv !== 'test') {
  app.use('/api/v1/auth/login', loginLimiter);
  // Public + GET (so the general limiter skips it): throttle separately to make
  // enumerating workspace slugs slow.
  app.use('/api/v1/auth/workspace', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/v1', apiLimiter);
}

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/accounts', accountsRoutes);
app.use('/api/v1/requirements', requirementsRoutes);
app.use('/api/v1/seats', seatsRoutes);
app.use('/api/v1/profiles', profilesRoutes);
app.use('/api/v1/submissions', submissionsRoutes);
app.use('/api/v1/interview-rounds', interviewRoundsRoutes);
app.use('/api/v1/documents', documentsRoutes);
app.use('/api/v1/comments', commentsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/departments', departmentsRoutes);
app.use('/api/v1/pipeline', pipelineRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/interviews', interviewsRoutes);
app.use('/api/v1/orgs', orgsRoutes);
app.use('/api/v1/calendars', calendarsRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/leave', leaveRoutes);
app.use('/api/v1/designations', designationsRoutes);
app.use('/api/v1/assets', assetsRoutes);
app.use('/api/v1/teams', teamsRoutes);
app.use('/api/v1/allocations', allocationsRoutes);
app.use('/api/v1/timesheets', timesheetsRoutes);
app.use('/api/v1/payroll', payrollRoutes);
app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/profitability', profitabilityRoutes);
app.use('/api/v1/super-dashboard', superDashboardRoutes);
// Finance scope reduction — see middleware/financeScope.js. Expense claims stay
// on; only the vendor-payment sub-routes of /expenses are switched off.
app.use('/api/v1/expenses/vendor-payments', requireFinanceModule('vendor_payments'));
app.use('/api/v1/expenses', expensesRoutes);
app.use('/api/v1/vendor-commissions', requireFinanceModule('vendor_ledger'), vendorCommissionsRoutes);
app.use('/api/v1/tasks', tasksRoutes);
app.use('/api/v1/accounting', requireFinanceModule('accounting'), accountingRoutes);
app.use('/api/v1/external-access', requireFinanceModule('external_access'), externalAccessRoutes);
app.use('/api/v1/org-chart', orgChartRoutes);
app.use('/api/v1/trading', tradingRoutes);
app.use('/api/v1/leads', leadsRoutes);
app.use('/api/v1/zephyr', zephyrRoutes);
app.use('/api/v1/contracts', contractsRoutes);
app.use('/api/v1/projects', projectsRoutes);
app.use('/api/v1/financials', financialsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/calculations', calculationsRoutes);
app.use('/api/v1/finance-categories', financeCategoriesRoutes);
app.use('/api/v1/invites', invitesRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));
app.use(errorHandler);

module.exports = app;
