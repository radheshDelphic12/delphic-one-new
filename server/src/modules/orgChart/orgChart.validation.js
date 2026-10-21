const { z } = require('zod');

// A query string is text: z.coerce.boolean() turns the text "false" into true (any non-empty string is truthy), which
// made the chart's own `include_terminated=false` request show exited employees. Only "true" / "1" mean yes.
const queryFlag = z.preprocess((value) => value === true || value === 'true' || value === '1', z.boolean());

const orgChartQuerySchema = z.object({
  include_terminated: queryFlag.default(false),
});

const groupOrgChartQuerySchema = orgChartQuerySchema.extend({
  org_group_id: z.string().uuid().optional(),
});

module.exports = { orgChartQuerySchema, groupOrgChartQuerySchema };
