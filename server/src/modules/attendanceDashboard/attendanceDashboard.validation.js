const { z } = require('zod');

const monthQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
// Employee list filter: current = everyone still working (incl. serving notice), or only active / notice_period / exited, or all.
const peopleQuery = monthQuery.extend({ status: z.enum(['current', 'active', 'notice_period', 'exited', 'all']).default('current'),
  // optional: only Remote / Hybrid / On-site people, and only people reporting to one office
  work_mode: z.enum(['remote', 'hybrid', 'onsite']).optional(),
  location_id: z.string().uuid().optional(),
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
const optText = (max) => z.string().trim().max(max).nullish().transform((x) => x || null);
const workLocationSchema = z.object({
  org_membership_id: z.string().uuid(),
  from_date: day,
  to_date: day,
  // exactly one of these: another of our offices, or a client / other site
  location_id: z.string().uuid().optional(),
  work_site_id: z.string().uuid().optional(),
  purpose: z.enum(['project', 'travel', 'other']).default('project'),
  account_id: z.string().uuid().optional(),
  deployment_person_id: z.string().uuid().optional(),
  note: optText(500),
}).transform((d) => ({ ...d, from_date: new Date(`${d.from_date}T00:00:00.000Z`), to_date: new Date(`${d.to_date}T00:00:00.000Z`) }));
const cancelWorkLocationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  // Back at base from this day (the days before stay on record); omit to cancel the whole assignment.
  end_from: day.optional().transform((x) => (x ? new Date(`${x}T00:00:00.000Z`) : undefined)),
});
const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);
const workSiteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  city: optText(100),
  address: optText(500),
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
  radius_m: z.coerce.number().int().min(20).max(5000).default(150),
  client_account_id: z.string().uuid().nullish(),
});
const workSitePatchSchema = workSiteSchema.partial();
const decidePlaceSchema = z.object({ approve: z.boolean(), reason: z.string().trim().max(500).optional() });

module.exports = { monthQuery, peopleQuery, calendarQuery, setOfficeSchema, requestPlaceSchema, decidePlaceSchema, workLocationSchema, cancelWorkLocationSchema, workSiteSchema, workSitePatchSchema };
