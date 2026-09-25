const { z } = require('zod');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);

const createCommissionSchema = z.object({
  submission_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  currency: CURRENCY.default('INR'),
});

const decideCommissionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});

const listCommissionsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'paid', 'rejected']).optional(),
  vendor_account_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

module.exports = { createCommissionSchema, decideCommissionSchema, listCommissionsQuerySchema };
