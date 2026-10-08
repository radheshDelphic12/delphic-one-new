const { z } = require('zod');

// One Project entity with a service-specific section. Every field is optional (deals differ), unknown
// keys are dropped, and the section is validated per service so a civil project cannot carry
// consulting fields. Commission is always computed on the server from value x percent.
const blank = (v) => (v === '' ? null : v);
const str = (max) => z.preprocess(blank, z.string().trim().max(max).nullable().optional());
const amount = z.preprocess(blank, z.coerce.number().min(0).max(1e13).nullable().optional());
const count = z.preprocess(blank, z.coerce.number().int().min(0).max(100000).nullable().optional());
const day = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional());

const PHASE_STATUSES = ['pending', 'in_progress', 'done'];
const phases = z
  .array(z.object({ name: z.string().trim().min(1).max(120), start: day, end: day, status: z.enum(PHASE_STATUSES).default('pending'), notes: str(500) }))
  .max(30)
  .nullable()
  .optional();

const SCHEMAS = {
  civil_construction: z.object({
    site: str(200),
    units_count: count,
    scope: str(2000),
    phases,
  }),
  interior_design: z.object({
    property: str(200),
    design_scope: str(2000),
    renovation_scope: str(2000),
    material_cost: amount,
    labour_cost: amount,
    vendor_cost: amount,
    other_expenses: amount,
  }),
  property_management: z.object({
    scope: str(2000),
    management_fee_pct: z.preprocess(blank, z.coerce.number().min(0).max(100).nullable().optional()),
  }),
  property_trading: z.object({
    scope: str(2000),
  }),
  real_estate_consulting: z.object({
    desired_property_type: str(120),
    required_location: str(200),
    client_budget: amount,
    property_value: amount,
    commission_pct: z.preprocess(blank, z.coerce.number().min(0).max(100).nullable().optional()),
    deal_date: day,
    closing_date: day,
  }),
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Returns { details } (cleaned, with derived figures) or { error: 'invalid', message }.
function cleanDetails(serviceType, raw) {
  if (raw === null || raw === undefined) return { details: null };
  const schema = SCHEMAS[serviceType];
  if (!schema) return { details: null };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: 'invalid', message: `${issue.path.join('.') || 'details'}: ${issue.message}` };
  }
  const details = { ...parsed.data };
  // facts carried over from the lead at conversion stay with the project
  if (Array.isArray(raw.lead_details)) details.lead_details = raw.lead_details.slice(0, 40);
  if (serviceType === 'real_estate_consulting') {
    details.commission_amount =
      details.property_value != null && details.commission_pct != null ? round2((details.property_value * details.commission_pct) / 100) : null;
    if (details.deal_date && details.closing_date && details.closing_date < details.deal_date) {
      return { error: 'invalid', message: 'Closing date cannot be before the deal date' };
    }
  }
  return { details };
}

const detailsInput = z.record(z.any()).nullable().optional();

module.exports = { SCHEMAS, cleanDetails, detailsInput };
