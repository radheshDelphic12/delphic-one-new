const { z } = require('zod');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);
const ISO_DATE = z.coerce.date();
const optStr = (max = 300) => z.string().trim().max(max).optional().nullable();

const CHECKLIST_KEYS = ['kyc_done', 'agreement_signed', 'rate_card_agreed', 'bank_details_received'];
const checklistSchema = z.object(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, z.boolean().optional()]))).strict();

const partnerBase = {
  kind: z.enum(['supplier', 'consumer']),
  name: z.string().trim().min(1).max(200),
  contact_name: optStr(200),
  email: z.string().email().optional().nullable(),
  phone: optStr(40),
  city: optStr(120),
  gst_or_tax_id: optStr(60),
  owner_id: z.string().uuid().optional().nullable(),
  notes: optStr(2000),
};

const createPartnerSchema = z.object(partnerBase);
const updatePartnerSchema = z
  .object({
    ...partnerBase,
    status: z.enum(['lead', 'onboarding', 'active', 'inactive']),
    trading_status: z.enum(['not_trading', 'trading', 'paused']),
    onboarding_checklist: checklistSchema,
  })
  .partial();

const listPartnersQuerySchema = z.object({
  kind: z.enum(['supplier', 'consumer']).optional(),
  status: z.enum(['lead', 'onboarding', 'active', 'inactive']).optional(),
  trading_status: z.enum(['not_trading', 'trading', 'paused']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: optStr(80),
  unit: z.string().trim().min(1).max(30).default('unit'),
  category: optStr(100),
  hsn_code: optStr(20),
});
const updateItemSchema = createItemSchema.extend({ is_active: z.boolean() }).partial();

const createRateSchema = z
  .object({
    partner_id: z.string().uuid(),
    item_id: z.string().uuid(),
    rate: z.coerce.number().positive(),
    currency: CURRENCY.default('INR'),
    effective_from: ISO_DATE,
    effective_to: ISO_DATE.optional().nullable(),
  })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, {
    message: 'effective_to must not be before effective_from',
    path: ['effective_to'],
  });

const listRatesQuerySchema = z.object({
  partner_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  as_of: ISO_DATE.optional(),
});

const createTxnSchema = z.object({
  partner_id: z.string().uuid(),
  item_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  // Omit `rate` to use the partner's rate card for the transaction date.
  rate: z.coerce.number().positive().optional(),
  currency: CURRENCY.optional(),
  txn_date: ISO_DATE,
  status: z.enum(['open', 'completed']).default('open'),
  reference: optStr(120),
});

const updateTxnSchema = z.object({ status: z.enum(['open', 'completed', 'cancelled']) });

const listTxnQuerySchema = z.object({
  partner_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  txn_type: z.enum(['purchase', 'sale']).optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
  from: ISO_DATE.optional(),
  to: ISO_DATE.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

module.exports = {
  CHECKLIST_KEYS,
  createPartnerSchema,
  updatePartnerSchema,
  listPartnersQuerySchema,
  createItemSchema,
  updateItemSchema,
  createRateSchema,
  listRatesQuerySchema,
  createTxnSchema,
  updateTxnSchema,
  listTxnQuerySchema,
};
