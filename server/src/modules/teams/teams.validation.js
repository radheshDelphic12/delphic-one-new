const { z } = require('zod');

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  department_id: z.string().uuid().nullable().optional(),
  lead_membership_id: z.string().uuid().nullable().optional(),
  // Org chart: who the team hangs off when it has no lead (else the lead's
  // manager), seats still open (drawn as vacant circles), sibling order.
  manager_membership_id: z.string().uuid().nullable().optional(),
  open_positions: z.coerce.number().int().min(0).max(50).optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
});

const updateSchema = createSchema.partial();

module.exports = { createSchema, updateSchema };
