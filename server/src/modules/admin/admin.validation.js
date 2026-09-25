const { z } = require('zod');

const ENTITY_TYPES = ['account', 'requirement', 'seat', 'submission'];

const unlockParamsSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

const unlockBodySchema = z.object({
  reason: z.string().min(1),
});

// --- Superadmin soft-delete --------------------------------------------------
const SOFT_DELETE_ENTITY_TYPES = ['account', 'requirement', 'submission', 'profile', 'interview_round'];

const softDeleteParamsSchema = z.object({
  entity_type: z.enum(SOFT_DELETE_ENTITY_TYPES),
  entity_id: z.string().uuid(),
});

const softDeleteBodySchema = z.object({
  password: z.string().min(1),
  reason: z.string().min(1).max(500),
});

const restoreBodySchema = z.object({
  reason: z.string().min(1).max(500),
});

const listDeletedQuerySchema = z.object({
  entity_type: z.enum(SOFT_DELETE_ENTITY_TYPES).optional(),
});

module.exports = {
  ENTITY_TYPES,
  unlockParamsSchema,
  unlockBodySchema,
  SOFT_DELETE_ENTITY_TYPES,
  softDeleteParamsSchema,
  softDeleteBodySchema,
  restoreBodySchema,
  listDeletedQuerySchema,
};
