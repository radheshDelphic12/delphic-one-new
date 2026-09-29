const { z } = require('zod');
const { optionalDate, requiredDate } = require('../../lib/zodDate');

const listQuerySchema = z.object({
  from: optionalDate,
  to: optionalDate,
  org_membership_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(31),
});

const regularizeSchema = z.object({
  status: z.enum(['present', 'absent', 'half_day', 'leave', 'holiday', 'wfh']),
  check_in_at: z.string().datetime().optional(),
  check_out_at: z.string().datetime().optional(),
  reason: z.string().min(1).max(500),
});

const createShiftSchema = z.object({
  name: z.string().min(1).max(100),
  start_minutes: z.coerce.number().int().min(0).max(1439),
  end_minutes: z.coerce.number().int().min(0).max(1439),
  grace_minutes: z.coerce.number().int().min(0).max(120).default(15),
});

const STATUS = z.enum(['present', 'absent', 'half_day', 'leave', 'holiday', 'wfh']);
// Wall-clock time in the org's timezone, e.g. "09:30".
const TIME = z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

// Admin: record attendance for a past day (backfill), creating the day's
// record if the employee never checked in, or overwriting it if they did.
const manualEntrySchema = z.object({
  org_membership_id: z.string().uuid(),
  date: requiredDate,
  status: STATUS,
  check_in_time: TIME.nullable().optional(),
  check_out_time: TIME.nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});

// Bulk backfill from an uploaded sheet. Rows are validated one by one in the
// service so a bad row is reported back instead of rejecting the whole file.
const importSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  dry_run: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        employee: z.string().trim().max(200).default(''),
        date: z.string().trim().max(20).default(''),
        status: z.string().trim().max(20).default(''),
        check_in: z.string().trim().max(10).optional().default(''),
        check_out: z.string().trim().max(10).optional().default(''),
      })
    )
    .min(1)
    .max(5000),
});

const templateQuerySchema = z
  .object({
    from: requiredDate,
    to: requiredDate,
    department_id: z.string().uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] })
  .refine((v) => (v.to - v.from) / 86400000 <= 30, { message: 'range cannot exceed 31 days', path: ['to'] });

module.exports = { listQuerySchema, regularizeSchema, createShiftSchema, manualEntrySchema, importSchema, templateQuerySchema, STATUS };
