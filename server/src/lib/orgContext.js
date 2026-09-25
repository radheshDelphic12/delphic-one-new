// Multi-company ERP — request-scoped org context (HLD §5, layer 1).
// Populated by middleware/auth.js's `authenticate` for the lifetime of one
// request; config/db.js's Prisma middleware reads it to auto-stamp org_id
// on writes that didn't set one explicitly. Empty outside a request (cron
// jobs, scripts) — every reader here treats "no context" as "do nothing",
// never as an error.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function run(context, fn) {
  return storage.run(context, fn);
}

function getOrgId() {
  return storage.getStore()?.org_id;
}

module.exports = { run, getOrgId };
