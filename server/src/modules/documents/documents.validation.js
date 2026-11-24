const { z } = require('zod');

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.csv'];
const ALLOWED_ENTITIES = ['account', 'requirement', 'profile', 'submission', 'expense_claim', 'project_vendor_invoice', 'vendor_purchase', 'org_membership'];

const createMetaSchema = z.object({
  entity_type: z.enum(ALLOWED_ENTITIES),
  entity_id: z.string().uuid(),
  label: z.string().min(1),
  // what kind of document it is: the name of a Document Centre requirement ("Agreement", "ID proof" ...)
  doc_type: z.string().trim().max(80).optional(),
});

const listQuerySchema = z.object({
  entity_type: z.enum(ALLOWED_ENTITIES).optional(),
  entity_id: z.string().uuid().optional(),
});

module.exports = { ALLOWED_EXT, ALLOWED_ENTITIES, createMetaSchema, listQuerySchema };
