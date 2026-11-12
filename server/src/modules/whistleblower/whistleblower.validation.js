const { z } = require('zod');
const { STATUSES } = require('./whistleblower.constants');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
// A real calendar day that is not in the future (a day of slack covers time zones).
const incidentDay = day
  .refine((s) => { const d = new Date(`${s}T00:00:00.000Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'That is not a real date')
  .refine((s) => new Date(`${s}T00:00:00.000Z`).getTime() <= Date.now() + 86400000, 'The incident date cannot be in the future');
const bool = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());
const blankToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
// A concern is sent as a form (files travel with it), so a list of people arrives as a JSON string.
const idList = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v;
  try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch { return String(v).split(',').map((s) => s.trim()).filter(Boolean); }
}, z.array(z.string().uuid()).max(20));

const createCaseBody = z.object({
  category_id: z.string().uuid(),
  subject: z.string().trim().min(3, 'Give the complaint a short title').max(200),
  description: z.string().trim().min(10, 'Describe what happened (at least a sentence)').max(6000),
  incident_date: z.preprocess(blankToUndefined, incidentDay.optional()),
  location_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  department_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  people_involved: optionalText(500),
  involved_membership_ids: idList,
  mode: z.enum(['confidential', 'anonymous']).default('confidential'),
});

const messageBody = z.object({
  body: z.string().trim().min(1, 'Write a message').max(4000),
  internal: bool.optional(),
});

const anonymousTrackBody = z.object({
  case_no: z.string().trim().min(3).max(40).transform((s) => s.toUpperCase()),
  code: z.string().trim().min(8).max(40),
});
const anonymousReplyBody = anonymousTrackBody.extend({ body: z.string().trim().min(1).max(4000) });

const patchCaseBody = z
  .object({
    status: z.enum(STATUSES).optional(),
    assigned_membership_id: z.string().uuid().nullable().optional(),
    resolution: z.string().trim().max(4000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

const listQuery = z.object({
  status: z.enum([...STATUSES, 'open']).optional(), // open = everything not closed
  category_id: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  overdue: bool.optional(),
  assigned_to_me: bool.optional(),
});

const settingsBody = z
  .object({ enabled: z.boolean(), allow_anonymous: z.boolean(), sla_days: z.coerce.number().int().min(1).max(90) })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });

const categoryFields = {
  name: z.string().trim().min(2).max(120),
  examples: z.string().trim().max(500),
  restricted: z.boolean(),
  active: z.boolean(),
  handler_membership_ids: z.array(z.string().uuid()).max(15),
};
const categoryUpdate = z.object(categoryFields).partial().refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });
const categoryCreate = z.object({ ...categoryFields, examples: categoryFields.examples.default(''), restricted: categoryFields.restricted.default(false), active: categoryFields.active.default(true), handler_membership_ids: categoryFields.handler_membership_ids.default([]) });

module.exports = { createCaseBody, messageBody, anonymousTrackBody, anonymousReplyBody, patchCaseBody, listQuery, settingsBody, categoryUpdate, categoryCreate };
