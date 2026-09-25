const { z } = require('zod');

const orgChartQuerySchema = z.object({
  include_terminated: z.coerce.boolean().default(false),
});

const groupOrgChartQuerySchema = orgChartQuerySchema.extend({
  org_group_id: z.string().uuid().optional(),
});

module.exports = { orgChartQuerySchema, groupOrgChartQuerySchema };
