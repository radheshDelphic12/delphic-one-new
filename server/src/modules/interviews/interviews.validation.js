const { z } = require('zod');

const listQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  mine: z.enum(['0', '1']).optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
  result: z.enum(['pending', 'pass', 'fail', 'no_show', 'rescheduled']).optional(),
  audience: z.enum(['all', 'internal', 'external']).optional(),
  sort: z.enum(['time', 'audience']).optional(),
});

const feedbackSchema = z.object({
  result: z.enum(['pending', 'pass', 'fail', 'no_show']).optional(),
  feedback: z.string().max(5000).optional(),
  rating: z.number().int().min(1).max(10).nullable().optional(),
  completed_at: z.string().datetime().optional(),
});

const cancelSchema = z.object({
  reason: z.string().min(1).max(2000),
});

module.exports = { listQuerySchema, feedbackSchema, cancelSchema };
