const { z } = require('zod');
const { requiredDate, optionalDate } = require('../../lib/zodDate');

const createCalendarSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['internal', 'client', 'custom']).default('internal'),
  is_default: z.boolean().default(false),
  // Ties the calendar's holidays to an office (Ahmedabad, Indore, Gurgaon…);
  // omit for a client calendar that isn't tied to a physical location.
  location_id: z.string().uuid().nullable().optional(),
});

const updateCalendarSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  kind: z.enum(['internal', 'client', 'custom']).optional(),
  is_default: z.boolean().optional(),
  location_id: z.string().uuid().nullable().optional(),
});

const addHolidaySchema = z.object({
  date: requiredDate,
  label: z.string().min(1).max(200),
});

const updateHolidaySchema = z
  .object({
    date: optionalDate,
    label: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.date !== undefined || v.label !== undefined, { message: 'Provide at least one field to update' });

const assignCalendarSchema = z.object({
  org_membership_id: z.string().uuid(),
  // Which client/project this mapping is for — omit for the employee's
  // default calendar. Client brief: multi-project calendar mapping.
  account_id: z.string().uuid().nullable().optional(),
});

// "Add Project" (Calendar section). The calendar is mandatory for a project; when
// the caller doesn't pick one it defaults to the Ahmedabad calendar, so the
// mapping always exists. Recruitment is not an accepted category yet.
const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // A Lead account of this org (validated in the service) — no free-text client.
  client_account_id: z.string().uuid().optional(),
  service_category: z.enum(['managed_services', 'project']),
  calendar_id: z.string().uuid().optional(),
});

const setProjectCalendarSchema = z.object({
  calendar_id: z.string().uuid(),
});

module.exports = {
  createCalendarSchema,
  updateCalendarSchema,
  addHolidaySchema,
  updateHolidaySchema,
  assignCalendarSchema,
  createProjectSchema,
  setProjectCalendarSchema,
};
