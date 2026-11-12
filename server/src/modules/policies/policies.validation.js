const { z } = require('zod');

// Blank clears the category (null); absent leaves it untouched on an edit.
const category = z.string().trim().max(80).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category,
  content: z.string().max(200000).default(''),
  is_published: z.boolean().optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    category,
    content: z.string().max(200000).optional(),
    is_published: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

module.exports = { createSchema, updateSchema };
