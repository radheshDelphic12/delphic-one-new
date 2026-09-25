const { z } = require('zod');

// Accepts a date-only string ("2026-09-02"), a datetime-local string
// ("2026-09-02T13:30") or a full ISO-8601 string, and yields a JS Date that
// Prisma accepts for DateTime / @db.Date columns. Empty/undefined -> undefined.
// Prisma rejects bare "YYYY-MM-DD" with "Expected ISO-8601 DateTime", so any
// string date that flows into a Prisma write must go through this.
const optionalDate = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
      return z.NEVER;
    }
    return d;
  });

// Same coercion, but required — missing/invalid fails validation instead of
// silently becoming undefined.
const requiredDate = z.string().min(1).transform((v, ctx) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
    return z.NEVER;
  }
  return d;
});

module.exports = { optionalDate, requiredDate };
