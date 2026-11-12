const prisma = require('../../config/db');

// Who referred an application. Two ways in: an employee's "Refer someone" (the referrer is the logged-in employee) and the
// employee's personal job link (<job link>?ref=<employee id or code>) opened on the public careers page. A candidate may also
// type "Referred by" (name or email); an email that belongs to an employee is attributed, anything else is kept as typed.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (s) => String(s || '').trim().toLowerCase();

async function snapshot(user, orgId) {
  const m = orgId ? await prisma.orgMembership.findFirst({ where: { person_id: user.id, org_id: orgId }, select: { employee_code: true } }) : null;
  return { referrer_id: user.id, referrer_name: user.name || user.email, referrer_code: m?.employee_code || null, referrer_text: null };
}

/** The employee behind a ref value (user id or employee code) and a typed "Referred by"; null fields = direct application. */
async function resolve({ ref, referredBy, orgId, applicantEmail }) {
  const none = { referrer_id: null, referrer_name: null, referrer_code: null, referrer_text: null };
  const key = String(ref || '').trim().slice(0, 80);
  let user = null;
  if (key) {
    if (UUID.test(key)) user = await prisma.user.findFirst({ where: { id: key, active: true }, select: { id: true, name: true, email: true } });
    else if (orgId) {
      const m = await prisma.orgMembership.findFirst({ where: { org_id: orgId, employee_code: { equals: key, mode: 'insensitive' } }, select: { person: { select: { id: true, name: true, email: true, active: true } } } });
      if (m?.person?.active) user = m.person;
    }
  }
  const typed = String(referredBy || '').trim().slice(0, 200);
  if (!user && typed.includes('@')) user = await prisma.user.findFirst({ where: { email: { equals: typed, mode: 'insensitive' }, active: true }, select: { id: true, name: true, email: true } });
  // nobody refers themselves
  if (user && norm(user.email) === norm(applicantEmail)) user = null;
  if (user) return snapshot(user, orgId);
  return typed ? { ...none, referrer_text: typed } : none;
}

const ORIGIN_LABEL = { referral: 'Referral', direct: 'Direct', internal: 'Internal', manual: 'Added by recruiter' };

/** "Referral" when somebody referred the person, "Direct" for a plain website application. */
function originOf(a) {
  if (a.source === 'internal') return 'internal';
  if (a.referrer_id || a.referrer_text || a.source === 'referral') return 'referral';
  return a.source === 'manual' ? 'manual' : 'direct';
}

/** What a referrer may see about the progress of the person they referred (never the recruiters' notes or reasons). */
function referralStatus(a) {
  if (a.status === 'rejected') return 'Not shortlisted';
  if (a.status === 'unlinked') return 'Closed';
  if (a.status === 'assigned') return a.profile_id ? 'In process' : 'With a recruiter';
  return 'Received';
}

module.exports = { snapshot, resolve, originOf, referralStatus, ORIGIN_LABEL };
