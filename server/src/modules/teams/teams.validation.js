const { z } = require('zod');

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  department_id: z.string().uuid().nullable().optional(),
  lead_membership_id: z.string().uuid().nullable().optional(),
});

const updateSchema = createSchema.partial();

module.exports = { createSchema, updateSchema };
