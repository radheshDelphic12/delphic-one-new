const { z } = require('zod');

const monthQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
const calendarQuery = monthQuery.extend({ org_membership_id: z.string().uuid().optional() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const setOfficeSchema = z.object({
  org_membership_id: z.string().uuid(),
  location_id: z.string().uuid(),
  effective_from: day,
});
const requestPlaceSchema = z.object({
  org_membership_id: z.string().uuid().optional(),
  date: day,
  // Optional last day: applies to every working day from `date` to `to_date` (weekends and holidays are skipped).
  to_date: day.optional(),
  work_place: z.enum(['office', 'home']),
  reason: z.string().trim().max(500).optional(),
});
const decidePlaceSchema = z.object({ approve: z.boolean(), reason: z.string().trim().max(500).optional() });

module.exports = { monthQuery, calendarQuery, setOfficeSchema, requestPlaceSchema, decidePlaceSchema };
