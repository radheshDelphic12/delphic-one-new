const { z } = require('zod');

const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .pipe(z.string().uuid().optional());

const boolFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const boardQuerySchema = z.object({
  search: z.string().optional(),
  stuck: z.enum(['all', 'stuck', 'not_stuck']).optional(),
  past_sla_only: boolFlag,
  account_id: optionalUuid,
  account_ids: z.string().optional(),
  profile_source: z.string().optional(),
  req_type: z.string().optional(),
  bda_id: optionalUuid,
  sales_id: optionalUuid,
  admin_id: optionalUuid,
  recruiter_id: optionalUuid,
  recruiter_ids: z.string().optional(),
  submitted_by_ids: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  submission_stage: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

module.exports = { boardQuerySchema };
