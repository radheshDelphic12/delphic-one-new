const { z } = require('zod');
const { NOTIFICATION_TYPES } = require('../../lib/notifications/eventCatalog');

const listQuerySchema = z.object({
  unread: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().datetime().optional(),
});

const readSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

const preferencesSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        in_app: z.boolean(),
        email: z.boolean().optional().default(false),
      })
    )
    .min(1),
});

module.exports = { listQuerySchema, readSchema, preferencesSchema };
