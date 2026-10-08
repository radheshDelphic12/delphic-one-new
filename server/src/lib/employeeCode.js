// Default employee codes: "E0001", "E0002", … per company. A new employee
// gets one past the highest E-number already in use in that org, so codes HR
// has entered by hand (e.g. E0174) are continued rather than collided with.
// org_memberships has a unique (org_id, employee_code) index as the backstop.

const CODE_PATTERN = /^E(\d+)$/;

async function nextEmployeeCode(db, orgId) {
  const rows = await db.orgMembership.findMany({
    where: { org_id: orgId, employee_code: { startsWith: 'E' } },
    select: { employee_code: true },
  });
  const max = rows.reduce((highest, { employee_code: code }) => {
    const match = CODE_PATTERN.exec(code || '');
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `E${String(max + 1).padStart(4, '0')}`;
}

// Two employees created at the same moment can draw the same number; the
// unique index rejects the second, so retry a couple of times.
function isEmployeeCodeClash(err) {
  return err?.code === 'P2002' && String(err?.meta?.target || '').includes('employee_code');
}

async function withEmployeeCodeRetry(fn, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isEmployeeCodeClash(err)) throw err;
    }
  }
}

module.exports = { nextEmployeeCode, withEmployeeCodeRetry, isEmployeeCodeClash };
