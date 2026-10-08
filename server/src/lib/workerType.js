/**
 * People → user type (full-time employee vs contractor).
 *
 * A contractor is supplied and paid by a vendor company — an Account with
 * type 'vendor' in the same org — at a monthly vendor rate. Contractors
 * never go through payroll and only see the simplified portal (see
 * middleware/contractorScope.js), so their role is always 'employee'.
 */

const prisma = require('../config/db');

const WORKER_FIELDS = ['worker_type', 'vendor_account_id', 'vendor_rate', 'vendor_rate_currency'];

async function findVendorAccount(orgId, id) {
  return prisma.account.findFirst({ where: { id, org_id: orgId, type: 'vendor' }, select: { id: true, name: true } });
}

/**
 * Merge a worker-type patch onto the current membership values and validate
 * the result. Returns { data } (fields to write) or { error }.
 *   vendor_required      — a contractor needs a vendor account
 *   vendor_rate_required — ...and a vendor rate
 *   vendor_not_found     — the vendor is not a vendor account of this org
 * Switching back to full-time clears the vendor fields.
 */
async function resolveWorkerFields(orgId, current, patch) {
  if (!WORKER_FIELDS.some((key) => patch[key] !== undefined)) return { data: {} };
  const next = { ...current };
  for (const key of WORKER_FIELDS) if (patch[key] !== undefined) next[key] = patch[key];
  const workerType = next.worker_type || 'full_time_employee';

  if (workerType === 'full_time_employee') {
    return { data: { worker_type: workerType, vendor_account_id: null, vendor_rate: null, vendor_rate_currency: null } };
  }
  if (!next.vendor_account_id) return { error: 'vendor_required' };
  if (next.vendor_rate === null || next.vendor_rate === undefined) return { error: 'vendor_rate_required' };
  if (patch.vendor_account_id && !(await findVendorAccount(orgId, patch.vendor_account_id))) return { error: 'vendor_not_found' };
  return {
    data: {
      worker_type: 'contractor',
      vendor_account_id: next.vendor_account_id,
      vendor_rate: next.vendor_rate,
      vendor_rate_currency: next.vendor_rate_currency || 'INR',
      role: 'employee',
    },
  };
}

const WORKER_ERRORS = {
  vendor_required: [422, 'A contractor must be linked to a vendor'],
  vendor_rate_required: [422, 'A contractor needs a vendor rate'],
  vendor_not_found: [404, 'Vendor account not found in this organization'],
};

module.exports = { WORKER_FIELDS, WORKER_ERRORS, findVendorAccount, resolveWorkerFields };
