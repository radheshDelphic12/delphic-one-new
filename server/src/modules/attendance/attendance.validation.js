const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

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

module.exports = { listQuerySchema, regularizeSchema, createShiftSchema };
