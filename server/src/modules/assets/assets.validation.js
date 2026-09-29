const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

// Blank clears the field (null); absent leaves it untouched on an edit.
const text = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const link = z.string().uuid().nullable().optional();

const fields = {
  serial_number: text(120),
  status: z.enum(['issued', 'returned']).optional(),
  belongs_to: z.enum(['delphic', 'client']).optional(),
  // An org membership of this org — employee or contractor; null = unassigned.
  org_membership_id: link,
  vendor_account_id: link,
  client_account_id: link,
  issue_date: optionalDate.nullable(),
  return_date: optionalDate.nullable(),
  device_details: text(2000),
};

const createSchema = z.object({ asset_type: z.string().trim().min(1).max(60), ...fields });

const updateSchema = z
  .object({ asset_type: z.string().trim().min(1).max(60).optional(), ...fields })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

const listQuerySchema = z.object({
  status: z.enum(['issued', 'returned']).optional(),
});

module.exports = { createSchema, updateSchema, listQuerySchema };
