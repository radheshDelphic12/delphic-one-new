const { z } = require('zod');

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.csv'];
const ALLOWED_ENTITIES = ['account', 'requirement', 'profile', 'submission', 'expense_claim', 'project_vendor_invoice'];

const createMetaSchema = z.object({
  entity_type: z.enum(ALLOWED_ENTITIES),
  entity_id: z.string().uuid(),
  label: z.string().min(1),
});

const listQuerySchema = z.object({
  entity_type: z.enum(ALLOWED_ENTITIES).optional(),
  entity_id: z.string().uuid().optional(),
});

module.exports = { ALLOWED_EXT, ALLOWED_ENTITIES, createMetaSchema, listQuerySchema };
