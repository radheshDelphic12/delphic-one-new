const { z } = require('zod');

const roundSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  conducted_by: z.enum(['delphic', 'client']).default('delphic'),
  kind: z.enum(['interview', 'screening_test']).default('interview'),
  is_mandatory: z.boolean().default(true),
  rating_required: z.boolean().default(false),
  assessment_test_id: z.string().uuid().nullable().optional(),
});

const baseFields = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  service_types: z.array(z.enum(['managed_services', 'recruitment', 'project', 'internal_hiring'])).min(1),
  hiring_track: z.enum(['technical', 'non_technical']).nullable().optional(),
  pass_percentage: z.number().int().min(1).max(100).default(60),
  is_active: z.boolean().optional(),
  rounds: z.array(roundSchema).min(1),
};

const createSchema = z.object(baseFields);
const updateSchema = z.object(baseFields).partial();

module.exports = { createSchema, updateSchema };
