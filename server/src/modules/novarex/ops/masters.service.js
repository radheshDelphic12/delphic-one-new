const { z, prisma, fail, text, optDate, uuidOrNull, optNum, nextNo, audit, toDate, dayOf, num } = require('./common');

// Master data of the operations layer: products, warehouses / stock locations, suppliers, customers, logistics partners,
// rate cards and vehicles. One generic engine (list / create / edit / archive / restore, audited), one config per resource.
// Nothing is deleted: archiving hides a record from new forms, every historical document keeps pointing at it.

const status = (list) => z.enum(list).optional();
const DATES = { licence_expiry: 1, insurance_expiry: 1, permit_expiry: 1 };

const RESOURCES = {
  products: {
    model: 'nxProduct', entity: 'product', codeKey: 'sku', prefix: 'PRD', search: ['sku', 'name', 'brand', 'generic_name', 'manufacturer', 'barcode', 'hsn'],
    filters: ['status', 'category_id', 'dosage_form', 'regulatory_class'], refs: { category_id: ['nxCategory', 'product_category'] },
    fields: {
      sku: z.string().trim().min(1).max(60).optional(), name: z.string().trim().min(1).max(250), brand: text(120), generic_name: text(200), category_id: uuidOrNull,
      manufacturer: text(200), strength: text(80), dosage_form: text(80), pack_size: text(80), uom: z.string().trim().min(1).max(30).optional(), hsn: text(20),
      gst_rate: optNum(0, 100), mrp: optNum(0), purchase_price: optNum(0), selling_price: optNum(0), barcode: text(60), status: status(['active', 'inactive', 'discontinued']),
      regulatory_class: text(80), requires_prescription: z.boolean().optional(), cold_chain: z.boolean().optional(), reorder_level: optNum(0), shelf_life_days: optNum(0, 20000), notes: text(2000),
    },
  },
  warehouses: {
    model: 'nxWarehouse', entity: 'warehouse', codeKey: 'code', prefix: 'WH', search: ['code', 'name', 'city', 'state', 'manager_name'], filters: ['status', 'type', 'city', 'state', 'outlet_id'],
    refs: { outlet_id: ['nxOutlet'] },
    fields: {
      code: z.string().trim().min(1).max(30).optional(), name: z.string().trim().min(1).max(200), type: z.string().trim().min(1).max(40).optional(), city: text(120), state: text(120),
      address: text(500), manager_name: text(200), outlet_id: uuidOrNull, status: status(['active', 'inactive']), notes: text(2000),
    },
  },
  suppliers: {
    model: 'nxSupplier', entity: 'supplier', codeKey: 'code', prefix: 'SUP', search: ['code', 'name', 'contact_name', 'phone', 'gstin', 'licence_no'], filters: ['status', 'state'],
    fields: {
      code: z.string().trim().min(1).max(30).optional(), name: z.string().trim().min(1).max(250), contact_name: text(200), phone: text(40), email: text(200), gstin: text(20),
      licence_no: text(80), licence_expiry: optDate, state: text(120), address: text(500), credit_days: optNum(0, 3650), status: status(['active', 'inactive']), notes: text(2000),
    },
  },
  customers: {
    model: 'nxCustomer', entity: 'customer', codeKey: 'code', prefix: 'CUS', search: ['code', 'name', 'contact_name', 'phone', 'gstin'], filters: ['status', 'state', 'outlet_id', 'kind'],
    refs: { outlet_id: ['nxOutlet'] },
    fields: {
      code: z.string().trim().min(1).max(30).optional(), name: z.string().trim().min(1).max(250), outlet_id: uuidOrNull, kind: status(['external', 'outlet', 'distributor']), contact_name: text(200),
      phone: text(40), email: text(200), gstin: text(20), state: text(120), address: text(500), credit_days: optNum(0, 3650), status: status(['active', 'inactive']), notes: text(2000),
    },
  },
  'logistics-partners': {
    model: 'nxLogisticsPartner', entity: 'logistics_partner', codeKey: 'code', prefix: 'LP', search: ['code', 'name', 'contact_name', 'phone', 'gstin'], filters: ['status', 'pricing_model'],
    fields: {
      code: z.string().trim().min(1).max(30).optional(), name: z.string().trim().min(1).max(250), contact_name: text(200), phone: text(40), email: text(200), gstin: text(20),
      regions: z.array(z.string().trim().min(1).max(80)).max(50).optional(), pricing_model: status(['fixed', 'per_km', 'per_unit', 'per_weight', 'zone']), payment_terms: text(300),
      status: status(['active', 'inactive']), notes: text(2000),
    },
  },
  'rate-cards': {
    model: 'nxRateCard', entity: 'rate_card', search: ['name', 'zone'], filters: ['partner_id', 'model', 'active'], refs: { partner_id: ['nxLogisticsPartner'] },
    fields: {
      partner_id: z.string().uuid(), name: z.string().trim().min(1).max(200), model: status(['fixed', 'per_km', 'per_unit', 'per_weight', 'zone']), base_amount: optNum(0), rate: optNum(0),
      handling_charge: optNum(0), cold_chain_charge: optNum(0), zone: text(120), active: z.boolean().optional(), notes: text(1000),
    },
  },
  vehicles: {
    model: 'nxVehicle', entity: 'vehicle', search: ['reg_no', 'vehicle_type', 'driver_name'], filters: ['status'], refs: { driver_person_id: ['nxPerson'] },
    fields: {
      reg_no: z.string().trim().min(1).max(30), vehicle_type: text(80), capacity: text(80), driver_name: text(200), driver_person_id: uuidOrNull,
      status: status(['available', 'on_trip', 'maintenance', 'inactive']), insurance_expiry: optDate, permit_expiry: optDate, notes: text(1000),
    },
  },
};

const cleanOut = (row) => {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (DATES[k]) out[k] = dayOf(out[k]);
    else if (out[k] && typeof out[k] === 'object' && typeof out[k].toNumber === 'function') out[k] = out[k].toNumber();
  }
  out.archived = Boolean(row.deleted_at);
  return out;
};

async function checkRefs(orgId, cfg, input) {
  for (const [key, [model, scope]] of Object.entries(cfg.refs || {})) {
    const v = input[key];
    if (!v) continue;
    const where = { id: v, org_id: orgId, ...(scope ? { scope, deleted_at: null } : {}) };
    if (!(await prisma[model].findFirst({ where, select: { id: true } }))) fail('invalid_ref', key);
  }
}

const schemaFor = (cfg, partial) => (partial ? z.object(cfg.fields).partial() : z.object(cfg.fields));
const toData = (input) => {
  const data = { ...input };
  for (const k of Object.keys(DATES)) if (k in data) data[k] = toDate(data[k]);
  return data;
};

async function list(orgId, res, query = {}, extraWhere = {}) {
  const cfg = RESOURCES[res];
  const where = { org_id: orgId, ...extraWhere };
  if (query.archived !== 'true') where.deleted_at = null;
  for (const f of cfg.filters) {
    if (query[f] === undefined || query[f] === '') continue;
    where[f] = f === 'active' ? query[f] === 'true' : query[f];
  }
  if (query.q) where.OR = cfg.search.map((f) => ({ [f]: { contains: String(query.q), mode: 'insensitive' } }));
  const rows = await prisma[cfg.model].findMany({ where, orderBy: [{ created_at: 'desc' }], take: Math.min(Number(query.limit) || 500, 2000) });
  return rows.map(cleanOut);
}

async function get(orgId, res, id) {
  const row = await prisma[RESOURCES[res].model].findFirst({ where: { id, org_id: orgId } });
  if (!row) fail('not_found');
  return cleanOut(row);
}

async function create(orgId, actorId, res, body) {
  const cfg = RESOURCES[res];
  const input = schemaFor(cfg, false).parse(body);
  await checkRefs(orgId, cfg, input);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const data = toData(input);
      if (cfg.codeKey && !data[cfg.codeKey]) data[cfg.codeKey] = await nextNo(tx, orgId, `master_${cfg.entity}`, cfg.prefix, 4);
      const made = await tx[cfg.model].create({ data: { ...data, org_id: orgId, created_by: actorId } });
      await audit(tx, orgId, actorId, cfg.entity, made.id, 'create', null, { name: made.name || made.reg_no });
      return made;
    });
    return cleanOut(row);
  } catch (e) {
    if (e.code === 'P2002') fail('duplicate');
    throw e;
  }
}

async function update(orgId, actorId, res, id, body) {
  const cfg = RESOURCES[res];
  const { reason, ...rest } = body || {};
  const input = schemaFor(cfg, true).parse(rest);
  const before = await prisma[cfg.model].findFirst({ where: { id, org_id: orgId } });
  if (!before) fail('not_found');
  await checkRefs(orgId, cfg, input);
  try {
    const row = await prisma[cfg.model].update({ where: { id }, data: { ...toData(input), updated_by: actorId } });
    await audit(prisma, orgId, actorId, cfg.entity, id, 'update', cleanOut(before), cleanOut(row), reason);
    return cleanOut(row);
  } catch (e) {
    if (e.code === 'P2002') fail('duplicate');
    throw e;
  }
}

async function archive(orgId, actorId, res, id, reason) {
  const cfg = RESOURCES[res];
  const before = await prisma[cfg.model].findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) fail('not_found');
  if (res === 'warehouses') {
    const held = await prisma.nxStockLedger.groupBy({ by: ['product_id', 'batch_id', 'bucket'], where: { org_id: orgId, warehouse_id: id }, _sum: { qty: true } });
    if (held.some((h) => num(h._sum.qty) !== 0 && h.bucket !== 'lost')) fail('has_stock');
  }
  const row = await prisma[cfg.model].update({ where: { id }, data: { deleted_at: new Date(), updated_by: actorId, ...(cfg.fields.status ? { status: res === 'products' ? 'inactive' : 'inactive' } : {}) } });
  await audit(prisma, orgId, actorId, cfg.entity, id, 'archive', { name: before.name || before.reg_no }, null, reason);
  return cleanOut(row);
}

async function restore(orgId, actorId, res, id) {
  const cfg = RESOURCES[res];
  const before = await prisma[cfg.model].findFirst({ where: { id, org_id: orgId, deleted_at: { not: null } } });
  if (!before) fail('not_found');
  const row = await prisma[cfg.model].update({ where: { id }, data: { deleted_at: null, updated_by: actorId, ...(cfg.fields.status ? { status: 'active' } : {}) } });
  await audit(prisma, orgId, actorId, cfg.entity, id, 'restore', null, { name: row.name || row.reg_no });
  return cleanOut(row);
}

module.exports = { RESOURCES, list, get, create, update, archive, restore, cleanOut };
