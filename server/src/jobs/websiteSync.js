const cron = require('node-cron');
const prisma = require('../config/db');
const logger = require('../config/logger');
const client = require('../modules/website/appsScriptClient');
const postings = require('../modules/website/postings.service');
const submissions = require('../modules/website/submissions.service');

/**
 * Every 10 minutes: pull new website form submissions into the master
 * workspace, close postings whose requirement closed, retry failed pushes.
 * Does nothing until the WEBSITE_* env vars are set.
 */
async function tick() {
  if (!client.isConfigured()) return null;
  const master = await prisma.org.findFirst({ where: { is_master_workspace: true, status: 'active' }, select: { id: true } });
  if (!master) return null;
  const summary = await submissions.sync(master.id);
  await postings.reconcile();
  return summary;
}

function schedule() {
  let running = false;
  return cron.schedule('*/10 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const summary = await tick();
      if (summary && (summary.imported || summary.errors.length)) logger.info('website_sync_tick', summary);
    } catch (err) {
      logger.error('website_sync_tick_failed', { err });
    } finally {
      running = false;
    }
  });
}

module.exports = { schedule, tick };
