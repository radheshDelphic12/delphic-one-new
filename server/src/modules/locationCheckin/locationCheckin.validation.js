const { z } = require('zod');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00.000Z`));
const bool = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());

// A point is sent as form fields (the selfie travels in the same request), so numbers arrive as strings. Empty = no location.
const point = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    accuracy_m: z.coerce.number().min(0).max(1000000).optional(),
  })
  .transform((p) => ({ latitude: p.latitude, longitude: p.longitude, accuracy_m: p.accuracy_m == null ? undefined : Math.round(p.accuracy_m) }))
  .refine((p) => (p.latitude == null) === (p.longitude == null), { message: 'Send both latitude and longitude' });

const emptyToUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));

const rangeQuery = z.object({ from: day, to: day }).refine((q) => q.to >= q.from, { message: 'The end date cannot be before the start date' });

const reportQuery = z
  .object({
    from: day,
    to: day,
    org_membership_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    planned_place: z.enum(['office', 'home']).optional(),
    late_only: bool.optional(),
    outside_only: bool.optional(),
    mismatch_only: bool.optional(),
  })
  .refine((q) => q.to >= q.from, { message: 'The end date cannot be before the start date' });

const settingsSchema = z.object({
  selfie_mode: z.enum(['required', 'optional', 'off']).optional(),
  full_time_only: z.boolean().optional(),
  default_cutoff_minutes: z.number().int().min(0).max(1439).optional(),
});

// null clears the admin's time, so the shift's own start + grace applies again.
const shiftRuleSchema = z.object({ late_after_minutes: z.number().int().min(0).max(1439).nullable() });

const geofenceSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_m: z.number().int().min(20).max(5000).optional(),
});

module.exports = { point, emptyToUndefined, rangeQuery, reportQuery, settingsSchema, shiftRuleSchema, geofenceSchema };
