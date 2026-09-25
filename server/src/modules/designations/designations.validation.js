const { z } = require('zod');

const createSchema = z.object({
  name: z.string().min(1).max(100),
  department_id: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  department_id: z.string().uuid().nullable().optional(),
});

module.exports = { createSchema, updateSchema };
