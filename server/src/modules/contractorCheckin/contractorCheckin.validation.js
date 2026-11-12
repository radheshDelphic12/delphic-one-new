const { z } = require('zod');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00.000Z`));
const instant = z.string().datetime({ offset: true }).transform((s) => new Date(s));

const rangeQuery = z.object({ from: day, to: day }).refine((q) => q.to >= q.from, { message: 'The end date cannot be before the start date' });

const reportQuery = z
  .object({ from: day, to: day, org_membership_id: z.string().uuid().optional() })
  .refine((q) => q.to >= q.from, { message: 'The end date cannot be before the start date' });

// An admin's correction: new in / out time (out_at null re-opens the session) and a mandatory reason for the audit log.
const sessionEditSchema = z.object({
  in_at: instant.optional(),
  out_at: instant.nullable().optional(),
  reason: z.string().trim().min(3, 'Say why you are changing this').max(500),
});
const removeSchema = z.object({ reason: z.string().trim().min(3, 'Say why you are removing this').max(500) });

module.exports = { rangeQuery, reportQuery, sessionEditSchema, removeSchema };
