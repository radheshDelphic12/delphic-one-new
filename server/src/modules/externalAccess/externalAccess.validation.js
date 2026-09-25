const { z } = require('zod');

// The only guest-readable resource today is 'accounting' (the HLD's own
// example: "read accounting for Org X, expires in 30 days"). Extend this
// enum, not the shape, as more modules grow a guest-facing surface.
const RESOURCE = z.enum(['accounting']);

const grantAccessSchema = z.object({
  email: z.string().email(),
  resources: z.array(RESOURCE).min(1),
  expires_at: z.coerce.date(),
});

const listGrantsQuerySchema = z.object({
  email: z.string().email().optional(),
  active: z.coerce.boolean().optional(),
});

module.exports = { grantAccessSchema, listGrantsQuerySchema };
