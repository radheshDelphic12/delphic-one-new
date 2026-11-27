const prisma = require('../../config/db');

// Reports > Missing contact details: clients and vendors whose point of contact (POC) has no phone number or no email, and extra
// contacts on the account with the same gap. A project is not listed (its client is). Most gaps first.
// Each row carries the account's status (lead, meeting scheduled, active, rescheduled, dropped), which the list can be filtered by.
// An account can be skipped for now: it leaves the "To fix" list and waits in the Skipped list until someone brings it back.

const STAGES = ['lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped'];
const blank = (v) => !String(v || '').trim();

async function contactGaps(orgId, { type, stage, view } = {}) {
  const stages = String(stage || '').split(',').map((s) => s.trim()).filter((s) => STAGES.includes(s));
  const accounts = await prisma.account.findMany({
    where: { org_id: orgId, is_project: false, type: type ? type : { in: ['client', 'vendor'] }, ...(stages.length ? { stage: { in: stages } } : {}) },
    select: { id: true, name: true, type: true, stage: true, poc_name: true, poc_email: true, poc_phone: true, additional_contacts: true, owner: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  const skips = await prisma.contactGapSkip.findMany({ where: { org_id: orgId, account_id: { in: accounts.map((a) => a.id) } } });
  const skipBy = new Map(skips.map((s) => [s.account_id, s]));
  const skippers = skips.length
    ? new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(skips.map((s) => s.skipped_by).filter(Boolean))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]))
    : new Map();
  const all = [];
  for (const a of accounts) {
    const missing = [];
    if (blank(a.poc_name)) missing.push('POC name');
    if (blank(a.poc_phone)) missing.push('POC phone');
    if (blank(a.poc_email)) missing.push('POC email');
    const extra = Array.isArray(a.additional_contacts) ? a.additional_contacts : [];
    const extraGaps = extra
      .map((c) => ({ name: c?.name || c?.contact_name || 'Contact', phone: c?.phone || c?.contact_phone, email: c?.email || c?.contact_email }))
      .filter((c) => blank(c.phone) || blank(c.email))
      .map((c) => ({ name: c.name, missing: [blank(c.phone) ? 'phone' : null, blank(c.email) ? 'email' : null].filter(Boolean) }));
    if (!missing.length && !extraGaps.length) continue;
    const skip = skipBy.get(a.id);
    all.push({
      id: a.id, name: a.name, type: a.type, stage: a.stage, owner: a.owner ? { id: a.owner.id, name: a.owner.name } : null,
      poc: { name: a.poc_name || null, phone: a.poc_phone || null, email: a.poc_email || null },
      missing, other_contacts_missing: extraGaps, gap_count: missing.length + extraGaps.length,
      skipped: skip ? { at: skip.skipped_at, reason: skip.reason || null, by: skip.skipped_by ? { id: skip.skipped_by, name: skippers.get(skip.skipped_by) || null } : null } : null,
    });
  }
  all.sort((x, y) => y.gap_count - x.gap_count || x.name.localeCompare(y.name));
  const open = all.filter((r) => !r.skipped);
  const skipped = all.filter((r) => r.skipped);
  const count = (t) => accounts.filter((a) => a.type === t).length;
  return {
    rows: view === 'skipped' ? skipped : open,
    summary: {
      clients: count('client'), vendors: count('vendor'),
      clients_with_gaps: open.filter((r) => r.type === 'client').length, vendors_with_gaps: open.filter((r) => r.type === 'vendor').length,
      no_phone: open.filter((r) => r.missing.includes('POC phone')).length, no_email: open.filter((r) => r.missing.includes('POC email')).length,
      skipped: skipped.length,
    },
  };
}

const accountOf = (orgId, accountId) => prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: { in: ['client', 'vendor'] } }, select: { id: true } });

/** Set an account aside for now (optional reason). Skipping again just updates the reason. */
async function skip(orgId, userId, accountId, { reason } = {}) {
  if (!(await accountOf(orgId, accountId))) return { error: 'not_found' };
  const text = String(reason || '').trim().slice(0, 500) || null;
  return prisma.contactGapSkip.upsert({
    where: { org_id_account_id: { org_id: orgId, account_id: accountId } },
    create: { org_id: orgId, account_id: accountId, reason: text, skipped_by: userId || null },
    update: { reason: text, skipped_by: userId || null, skipped_at: new Date() },
  });
}

/** Bring a skipped account back into the list. */
async function unskip(orgId, accountId) {
  if (!(await accountOf(orgId, accountId))) return { error: 'not_found' };
  await prisma.contactGapSkip.deleteMany({ where: { org_id: orgId, account_id: accountId } });
  return { account_id: accountId, skipped: false };
}

module.exports = { contactGaps, skip, unskip, STAGES };
