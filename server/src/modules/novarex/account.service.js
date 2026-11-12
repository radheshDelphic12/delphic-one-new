const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

// The logo is stored inline as a small image data URL (the client downsizes it), so it can be shown
// on the public sign-in page without serving uploaded files.
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
// express.json() caps a request body at 100 kB, so the logo has to fit well inside that.
const MAX_LOGO_CHARS = 90 * 1000;

const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  logo_url: z.string().max(MAX_LOGO_CHARS).regex(LOGO_RE, 'Logo must be a PNG, JPEG or WebP image').nullable(),
  timezone: z.string().trim().min(1).max(64).refine((tz) => {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
  }, 'Unknown timezone'),
}).partial();

const ORG_SELECT = { id: true, name: true, slug: true, logo_url: true, timezone: true };

const getCompany = (orgId) => prisma.org.findUnique({ where: { id: orgId }, select: ORG_SELECT });

async function updateCompany(orgId, actorId, input) {
  const before = await getCompany(orgId);
  const org = await prisma.org.update({ where: { id: orgId }, data: input, select: ORG_SELECT });
  // Never write the (large) logo data into the audit trail.
  const brief = (o) => ({ name: o.name, timezone: o.timezone, has_logo: Boolean(o.logo_url) });
  await writeAudit(null, { orgId, actorId, entity: 'company', entityId: orgId, action: 'update', before: brief(before), after: brief(org) });
  return { org };
}

module.exports = { companySchema, getCompany, updateCompany };
