const { z } = require('zod');

const createSchema = z.object({
  entity_type: z.enum(['account', 'requirement', 'submission', 'profile']),
  entity_id: z.string().uuid(),
  body: z.string().min(1),
});

const listQuerySchema = z.object({
  entity_type: z.enum(['account', 'requirement', 'submission', 'profile']),
  entity_id: z.string().uuid(),
});

module.exports = { createSchema, listQuerySchema };
