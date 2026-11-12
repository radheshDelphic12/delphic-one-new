const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

// Blank clears the field (null); absent leaves it untouched on an edit.
const text = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const link = z.string().uuid().nullable().optional();
const STATUSES = ['issued', 'returned', 'dispatched'];

const fields = {
  serial_number: text(120),
  status: z.enum(STATUSES).optional(),
  // Owner of the device. 'vendor' needs vendor_account_id (the vendor's name).
  belongs_to: z.enum(['delphic', 'client', 'vendor']).optional(),
  // An org membership of this org — employee or contractor; null = unassigned.
  org_membership_id: link,
  vendor_account_id: link,
  client_account_id: link,
  // The people who use it (several; any employee of this company, active or exited) and the office it is at.
  used_by_ids: z.array(z.string().uuid()).max(50).optional().transform((v) => (v ? [...new Set(v)] : v)),
  location_id: link,
  issue_date: optionalDate.nullable(),
  return_date: optionalDate.nullable(),
  device_details: text(2000),
};

const createSchema = z.object({ asset_type: z.string().trim().min(1).max(60), ...fields });

const updateSchema = z
  .object({ asset_type: z.string().trim().min(1).max(60).optional(), ...fields })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  location_id: z.string().uuid().optional(),
  used_by: z.string().uuid().optional(), // an employee: assets that person uses
});

module.exports = { createSchema, updateSchema, listQuerySchema };
