const logger = require('../config/logger');
const interviewReminders = require('./interviewReminders');
const profitabilityCompute = require('./profitabilityCompute');
const payrollDraft = require('./payrollDraft');
const emailOutbox = require('./emailOutbox');
const timesheetWeeklyLock = require('./timesheetWeeklyLock');

/**
 * Start in-process background jobs. Called once from src/index.js after app.listen,
 * guarded by env.jobs.enabled (off in tests; opt out with ENABLE_JOBS=false).
 *
 * Single-instance caveat: the deploy is one server container, so a plain in-process
 * cron is safe. If the API is scaled horizontally, move this to a single-runner.
 */
function startJobs() {
  const tasks = [];
  tasks.push(interviewReminders.schedule());
  tasks.push(profitabilityCompute.schedule());
  tasks.push(payrollDraft.schedule());
  tasks.push(emailOutbox.schedule());
  tasks.push(timesheetWeeklyLock.schedule());
  logger.info('jobs_started', { count: tasks.length, jobs: ['interviewReminders', 'profitabilityCompute', 'payrollDraft', 'emailOutbox', 'timesheetWeeklyLock'] });
  return tasks;
}

module.exports = { startJobs };
