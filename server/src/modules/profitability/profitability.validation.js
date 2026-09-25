const { z } = require('zod');
const { requiredDate, optionalDate } = require('../../lib/zodDate');

// Always a range (a single day is date_from === date_to) — capped at 31 days,
// same posture as billing's daily-revenue compute.
const computeSchema = z
  .object({
    date_from: requiredDate,
    date_to: requiredDate,
  })
  .refine((v) => v.date_to >= v.date_from, { message: 'date_to must be on or after date_from', path: ['date_to'] })
  .refine((v) => (v.date_to - v.date_from) / 86400000 <= 30, { message: 'range cannot exceed 31 days', path: ['date_to'] });

const listQuerySchema = z.object({
  org_membership_id: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(31),
});

const rollupQuerySchema = z.object({
  from: requiredDate,
  to: requiredDate,
  group_by: z.enum(['day', 'month', 'quarter', 'year']).default('month'),
  org_membership_id: z.string().uuid().optional(),
});

module.exports = { computeSchema, listQuerySchema, rollupQuerySchema };
