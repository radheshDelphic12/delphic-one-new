const { Prisma } = require('@prisma/client');
const orgContext = require('../lib/orgContext');

// Tenant read guard for the SaaS product (SaaS launch plan section 13, "tenant isolation audit").
//
// Finding that led to this file: most services read their tables WITHOUT filtering by org_id (only writes are stamped, see db.js). With a single
// company that was fine; once customers share the database a customer could see our rows and we could see theirs. This guard fixes that at the one
// place every query passes through, and only for the SaaS case:
//   - while no company is a SaaS customer (saas_customers is empty, today's situation) it does NOTHING: the query is passed on untouched;
//   - a request made inside a CUSTOMER company only sees rows of that company (models that have an org_id column);
//   - a request made inside any other company does not see rows that belong to a customer company.
// A query that already names org_id in its filter is left alone (the service scoped it on purpose, for example switching company).
// Limits: nested reads (include / select of a relation) are not rewritten, and background jobs (no company context) see everything, as today.

const TTL_MS = 15000;
let customerOrgs = new Set();
let loadedAt = 0;
let loading = null;

const clearCache = () => { loadedAt = 0; };

async function refresh(prisma) {
  if (loading) return loading;
  loading = prisma.$queryRawUnsafe('SELECT org_id::text AS org_id FROM saas_customers')
    .then((rows) => { customerOrgs = new Set(rows.map((r) => r.org_id)); loadedAt = Date.now(); })
    .catch(() => { loadedAt = Date.now(); }) // a missing table or a failed read means "no customers": never break a query
    .finally(() => { loading = null; });
  return loading;
}

// OrgMembership is identity-level (who belongs where): the company switcher and sign-in read it across companies on purpose, so it is not filtered.
const NEVER = new Set(['OrgMembership']);
const scopedModels = Prisma.dmmf.datamodel.models.filter((m) => !NEVER.has(m.name) && m.fields.some((f) => f.name === 'org_id'));
const scoped = new Set(scopedModels.map((m) => m.name));
// Most tables have a required org_id: Prisma rejects `org_id: null` on those ("Argument org_id is missing"), so only tables where org_id can be empty get that branch.
const nullableOrg = new Set(scopedModels.filter((m) => !m.fields.find((f) => f.name === 'org_id').isRequired).map((m) => m.name));
const READS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const UNIQUE_READS = new Set(['findUnique', 'findUniqueOrThrow']);
const MANY_WRITES = new Set(['updateMany', 'deleteMany']);

function mentionsOrgId(where) {
  if (!where || typeof where !== 'object') return false;
  if ('org_id' in where) return true;
  return ['AND', 'OR', 'NOT'].some((k) => (Array.isArray(where[k]) ? where[k].some(mentionsOrgId) : mentionsOrgId(where[k])));
}

function install(prisma) {
  prisma.$use(async (params, next) => {
    const orgId = orgContext.getOrgId();
    if (!orgId || !params.model || !scoped.has(params.model) || params.model.startsWith('Saas')) return next(params);
    if (Date.now() - loadedAt > TTL_MS) await refresh(prisma);
    if (customerOrgs.size === 0) return next(params); // nobody is a customer: behave exactly as before

    const isCustomer = customerOrgs.has(orgId);
    const notCustomer = { org_id: { notIn: [...customerOrgs] } };
    const rule = isCustomer ? { org_id: orgId } : (nullableOrg.has(params.model) ? { OR: [{ org_id: null }, notCustomer] } : notCustomer);

    if (READS.has(params.action) || MANY_WRITES.has(params.action)) {
      params.args = params.args || {};
      if (!mentionsOrgId(params.args.where)) params.args.where = params.args.where ? { AND: [params.args.where, rule] } : rule;
      return next(params);
    }
    if (UNIQUE_READS.has(params.action)) {
      const row = await next(params);
      if (!row || row.org_id === undefined || mentionsOrgId(params.args?.where)) return row;
      const hidden = isCustomer ? row.org_id !== orgId : (row.org_id && customerOrgs.has(row.org_id));
      if (!hidden) return row;
      if (params.action === 'findUniqueOrThrow') { const e = new Error('No record found'); e.code = 'P2025'; throw e; }
      return null;
    }
    return next(params);
  });
}

module.exports = { install, clearCache, _rules: { scoped, nullableOrg } };
