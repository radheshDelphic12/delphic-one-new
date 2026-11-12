// Full and final settlement records. One per exited employee, created Pending (idempotent).
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Makes sure an exited employee has an FnF record. `startDate` defaults to the last working day.
 * Safe to call again: an existing record (and whatever an admin filled in) is left untouched.
 */
async function ensureFnf(client, orgId, orgMembershipId, startDate = null) {
  const existing = await client.fnfRecord.findUnique({ where: { org_membership_id: orgMembershipId } });
  if (existing) return { record: existing, created: false };
  const record = await client.fnfRecord.create({
    data: { org_id: orgId, org_membership_id: orgMembershipId, status: 'pending', start_date: startDate ? new Date(`${ymd(startDate)}T00:00:00.000Z`) : null },
  });
  return { record, created: true };
}

module.exports = { ensureFnf };
