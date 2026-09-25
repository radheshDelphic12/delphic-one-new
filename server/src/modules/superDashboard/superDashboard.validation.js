const { z } = require('zod');
const { requiredDate } = require('../../lib/zodDate');

const computeSchema = z
  .object({
    date_from: requiredDate,
    date_to: requiredDate,
  })
  .refine((v) => v.date_to >= v.date_from, { message: 'date_to must be on or after date_from', path: ['date_to'] })
  .refine((v) => (v.date_to - v.date_from) / 86400000 <= 30, { message: 'range cannot exceed 31 days', path: ['date_to'] });

const rollupQuerySchema = z.object({
  from: requiredDate,
  to: requiredDate,
  group_by: z.enum(['day', 'month', 'quarter', 'year']).default('month'),
  // Omit for a group-wide total across every org; pass to drill into one company.
  org_id: z.string().uuid().optional(),
});

// Same shape as rollupQuerySchema — shared by /financials-rollup, which adds
// expenses + vendor payments on top of the revenue/cost/margin rollup above.
const financialsRollupQuerySchema = rollupQuerySchema;

module.exports = { computeSchema, rollupQuerySchema, financialsRollupQuerySchema };
