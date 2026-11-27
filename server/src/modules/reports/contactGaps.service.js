const prisma = require('../../config/db');

// Reports > Missing contact details: clients and vendors whose point of contact (POC) has no phone number or no email, and extra
// contacts on the account with the same gap. A project is not listed (its client is). Most gaps first.

const blank = (v) => !String(v || '').trim();

async function contactGaps(orgId, { type, stage } = {}) {
  const accounts = await prisma.account.findMany({
    where: { org_id: orgId, is_project: false, type: type ? type : { in: ['client', 'vendor'] }, ...(stage === 'active' ? { stage: 'active' } : {}) },
    select: { id: true, name: true, type: true, stage: true, poc_name: true, poc_email: true, poc_phone: true, additional_contacts: true, owner: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  const rows = [];
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
    rows.push({
      id: a.id, name: a.name, type: a.type, stage: a.stage, owner: a.owner ? { id: a.owner.id, name: a.owner.name } : null,
      poc: { name: a.poc_name || null, phone: a.poc_phone || null, email: a.poc_email || null },
      missing, other_contacts_missing: extraGaps, gap_count: missing.length + extraGaps.length,
    });
  }
  rows.sort((x, y) => y.gap_count - x.gap_count || x.name.localeCompare(y.name));
  const count = (t) => accounts.filter((a) => a.type === t).length;
  return {
    rows,
    summary: {
      clients: count('client'), vendors: count('vendor'),
      clients_with_gaps: rows.filter((r) => r.type === 'client').length, vendors_with_gaps: rows.filter((r) => r.type === 'vendor').length,
      no_phone: rows.filter((r) => r.missing.includes('POC phone')).length, no_email: rows.filter((r) => r.missing.includes('POC email')).length,
    },
  };
}

module.exports = { contactGaps };
