const prisma = require('../../config/db');
const { parseStandardList } = require('./taxonomy.seed');

// Business classification of the holding group: its own sector > industry > sub-industry list (seeded from the standard list, then edited freely)
// and where every business sits in it (several sectors, several industries in each, several sub-industries in each). The Business map reads this
// to show which sectors / industries / sub-industries the group's companies cover and which are still empty.

const KIND_COMPANY = 'group_company';
const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const collator = (a, b) => a.name.localeCompare(b.name);

// One taxonomy per holding group: the first group of the caller.
const groupOf = (groupIds) => groupIds[0];

function sortTree(sectors) {
  return sectors
    .map((s) => ({
      id: s.id, name: s.name, position: s.position,
      industries: s.industries
        .map((i) => ({ id: i.id, name: i.name, position: i.position, subs: i.sub_industries.map((x) => ({ id: x.id, name: x.name, position: x.position })).sort((a, b) => a.position - b.position || collator(a, b)) }))
        .sort((a, b) => a.position - b.position || collator(a, b)),
    }))
    .sort((a, b) => a.position - b.position || collator(a, b));
}

async function tree(groupIds) {
  const rows = await prisma.businessSector.findMany({ where: { org_group_id: groupOf(groupIds) }, include: { industries: { include: { sub_industries: true } } } });
  const sectors = sortTree(rows);
  return {
    sectors,
    counts: { sectors: sectors.length, industries: sectors.reduce((t, s) => t + s.industries.length, 0), sub_industries: sectors.reduce((t, s) => t + s.industries.reduce((u, i) => u + i.subs.length, 0), 0) },
  };
}

/** Loads the standard list (27 sectors) next to what the group already has: names that exist are left alone, nothing is removed or renamed. */
async function seedStandard(groupIds) {
  const groupId = groupOf(groupIds);
  const added = { sectors: 0, industries: 0, sub_industries: 0 };
  const std = parseStandardList();
  const existing = await prisma.businessSector.findMany({ where: { org_group_id: groupId }, include: { industries: { include: { sub_industries: true } } } });
  const bySector = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
  let position = existing.reduce((m, s) => Math.max(m, s.position), 0);
  for (const sec of std) {
    let s = bySector.get(sec.name.toLowerCase());
    if (!s) {
      position += 1;
      s = await prisma.businessSector.create({ data: { org_group_id: groupId, name: sec.name, position }, include: { industries: { include: { sub_industries: true } } } });
      added.sectors += 1;
    }
    const byIndustry = new Map(s.industries.map((i) => [i.name.toLowerCase(), i]));
    let ip = s.industries.reduce((m, i) => Math.max(m, i.position), 0);
    for (const ind of sec.industries) {
      let i = byIndustry.get(ind.name.toLowerCase());
      if (!i) {
        ip += 1;
        i = await prisma.businessIndustry.create({ data: { org_group_id: groupId, sector_id: s.id, name: ind.name, position: ip }, include: { sub_industries: true } });
        added.industries += 1;
      }
      const have = new Set(i.sub_industries.map((x) => x.name.toLowerCase()));
      let sp = i.sub_industries.reduce((m, x) => Math.max(m, x.position), 0);
      const fresh = ind.subs.filter((n) => !have.has(n.toLowerCase())).map((name) => ({ org_group_id: groupId, industry_id: i.id, name, position: (sp += 1) }));
      if (fresh.length) { await prisma.businessSubIndustry.createMany({ data: fresh }); added.sub_industries += fresh.length; }
    }
  }
  return added;
}

// ---- editing the list ---------------------------------------------------------------------------------------------------

async function addSector(groupIds, { name }) {
  const groupId = groupOf(groupIds);
  const n = clean(name);
  if (!n) return { error: 'name_needed' };
  if (await prisma.businessSector.findFirst({ where: { org_group_id: groupId, name: { equals: n, mode: 'insensitive' } } })) return { error: 'name_taken' };
  const last = await prisma.businessSector.aggregate({ where: { org_group_id: groupId }, _max: { position: true } });
  return { sector: await prisma.businessSector.create({ data: { org_group_id: groupId, name: n, position: (last._max.position || 0) + 1 } }) };
}

async function renameSector(groupIds, id, { name }) {
  const groupId = groupOf(groupIds);
  const s = await prisma.businessSector.findFirst({ where: { id, org_group_id: groupId } });
  if (!s) return { error: 'not_found' };
  const n = clean(name);
  if (!n) return { error: 'name_needed' };
  if (await prisma.businessSector.findFirst({ where: { org_group_id: groupId, id: { not: id }, name: { equals: n, mode: 'insensitive' } } })) return { error: 'name_taken' };
  return { sector: await prisma.businessSector.update({ where: { id }, data: { name: n } }) };
}

async function removeSector(groupIds, id) {
  const s = await prisma.businessSector.findFirst({ where: { id, org_group_id: groupOf(groupIds) } });
  if (!s) return { error: 'not_found' };
  const businesses = (await prisma.businessClassification.findMany({ where: { sector_id: id }, distinct: ['entity_kind', 'entity_id'], select: { entity_id: true } })).length;
  await prisma.businessSector.delete({ where: { id } });
  return { deleted: true, businesses_unmapped: businesses };
}

async function addIndustry(groupIds, sectorId, { name }) {
  const groupId = groupOf(groupIds);
  const sector = await prisma.businessSector.findFirst({ where: { id: sectorId, org_group_id: groupId } });
  if (!sector) return { error: 'not_found' };
  const n = clean(name);
  if (!n) return { error: 'name_needed' };
  if (await prisma.businessIndustry.findFirst({ where: { sector_id: sectorId, name: { equals: n, mode: 'insensitive' } } })) return { error: 'name_taken' };
  const last = await prisma.businessIndustry.aggregate({ where: { sector_id: sectorId }, _max: { position: true } });
  return { industry: await prisma.businessIndustry.create({ data: { org_group_id: groupId, sector_id: sectorId, name: n, position: (last._max.position || 0) + 1 } }) };
}

async function renameIndustry(groupIds, id, { name }) {
  const i = await prisma.businessIndustry.findFirst({ where: { id, org_group_id: groupOf(groupIds) } });
  if (!i) return { error: 'not_found' };
  const n = clean(name);
  if (!n) return { error: 'name_needed' };
  if (await prisma.businessIndustry.findFirst({ where: { sector_id: i.sector_id, id: { not: id }, name: { equals: n, mode: 'insensitive' } } })) return { error: 'name_taken' };
  return { industry: await prisma.businessIndustry.update({ where: { id }, data: { name: n } }) };
}

async function removeIndustry(groupIds, id) {
  const i = await prisma.businessIndustry.findFirst({ where: { id, org_group_id: groupOf(groupIds) } });
  if (!i) return { error: 'not_found' };
  const businesses = (await prisma.businessClassification.findMany({ where: { industry_id: id }, distinct: ['entity_kind', 'entity_id'], select: { entity_id: true } })).length;
  // a business mapped only to this industry stays in its sector (the sector row is kept: only the narrower rows go with the industry)
  await prisma.$transaction(async (tx) => {
    const rows = await tx.businessClassification.findMany({ where: { industry_id: id }, select: { entity_kind: true, entity_id: true, sector_id: true, org_group_id: true } });
    await tx.businessIndustry.delete({ where: { id } });
    const seen = new Set();
    for (const r of rows) {
      const k = `${r.entity_kind}|${r.entity_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const left = await tx.businessClassification.count({ where: { entity_kind: r.entity_kind, entity_id: r.entity_id, sector_id: r.sector_id } });
      if (!left) await tx.businessClassification.create({ data: { org_group_id: r.org_group_id, entity_kind: r.entity_kind, entity_id: r.entity_id, sector_id: r.sector_id } });
    }
  });
  return { deleted: true, businesses_affected: businesses };
}

/** `names` can be several, one per line or comma separated (the usual way to add a batch of sub-industries). */
async function addSubIndustries(groupIds, industryId, { names }) {
  const groupId = groupOf(groupIds);
  const industry = await prisma.businessIndustry.findFirst({ where: { id: industryId, org_group_id: groupId } });
  if (!industry) return { error: 'not_found' };
  const typed = String(names || '').split(/[\n,]/).map(clean).filter(Boolean);
  const seenNames = new Set();
  const wanted = typed.filter((n) => (seenNames.has(n.toLowerCase()) ? false : seenNames.add(n.toLowerCase())));
  if (!wanted.length) return { error: 'name_needed' };
  const have = new Set((await prisma.businessSubIndustry.findMany({ where: { industry_id: industryId }, select: { name: true } })).map((x) => x.name.toLowerCase()));
  const last = await prisma.businessSubIndustry.aggregate({ where: { industry_id: industryId }, _max: { position: true } });
  let position = last._max.position || 0;
  const fresh = wanted.filter((n) => !have.has(n.toLowerCase())).map((name) => ({ org_group_id: groupId, industry_id: industryId, name, position: (position += 1) }));
  if (fresh.length) await prisma.businessSubIndustry.createMany({ data: fresh });
  return { added: fresh.length, skipped: typed.length - fresh.length };
}

async function renameSubIndustry(groupIds, id, { name }) {
  const x = await prisma.businessSubIndustry.findFirst({ where: { id, org_group_id: groupOf(groupIds) } });
  if (!x) return { error: 'not_found' };
  const n = clean(name);
  if (!n) return { error: 'name_needed' };
  if (await prisma.businessSubIndustry.findFirst({ where: { industry_id: x.industry_id, id: { not: id }, name: { equals: n, mode: 'insensitive' } } })) return { error: 'name_taken' };
  return { sub_industry: await prisma.businessSubIndustry.update({ where: { id }, data: { name: n } }) };
}

async function removeSubIndustry(groupIds, id) {
  const x = await prisma.businessSubIndustry.findFirst({ where: { id, org_group_id: groupOf(groupIds) } });
  if (!x) return { error: 'not_found' };
  await prisma.$transaction(async (tx) => {
    const rows = await tx.businessClassification.findMany({ where: { sub_industry_id: id }, select: { entity_kind: true, entity_id: true, sector_id: true, industry_id: true, org_group_id: true } });
    await tx.businessSubIndustry.delete({ where: { id } });
    const seen = new Set();
    for (const r of rows) {
      const k = `${r.entity_kind}|${r.entity_id}|${r.industry_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const left = await tx.businessClassification.count({ where: { entity_kind: r.entity_kind, entity_id: r.entity_id, industry_id: r.industry_id } });
      if (!left) await tx.businessClassification.create({ data: { org_group_id: r.org_group_id, entity_kind: r.entity_kind, entity_id: r.entity_id, sector_id: r.sector_id, industry_id: r.industry_id } });
    }
  });
  return { deleted: true };
}

// ---- where a business sits ----------------------------------------------------------------------------------------------

/**
 * Replaces one business's classification. The ids must belong together: an industry belongs to a chosen sector and a sub-industry to a chosen industry.
 * What is stored is one row per deepest choice (a sub-industry, else an industry, else the sector), so nothing is counted twice.
 */
async function setClassification(groupIds, entityKind, entityId, { sector_ids = [], industry_ids = [], sub_industry_ids = [] }) {
  const groupId = groupOf(groupIds);
  const sectors = await prisma.businessSector.findMany({ where: { org_group_id: groupId, id: { in: sector_ids } }, select: { id: true } });
  if (sectors.length !== new Set(sector_ids).size) return { error: 'bad_selection' };
  const industries = await prisma.businessIndustry.findMany({ where: { org_group_id: groupId, id: { in: industry_ids } }, select: { id: true, sector_id: true } });
  if (industries.length !== new Set(industry_ids).size) return { error: 'bad_selection' };
  const subs = await prisma.businessSubIndustry.findMany({ where: { org_group_id: groupId, id: { in: sub_industry_ids } }, select: { id: true, industry_id: true } });
  if (subs.length !== new Set(sub_industry_ids).size) return { error: 'bad_selection' };
  const sectorSet = new Set(sector_ids);
  const industryById = new Map(industries.map((i) => [i.id, i]));
  if (industries.some((i) => !sectorSet.has(i.sector_id))) return { error: 'bad_selection' };
  if (subs.some((x) => !industryById.has(x.industry_id))) return { error: 'bad_selection' };

  const rows = [];
  const industriesWithSub = new Set(subs.map((x) => x.industry_id));
  const sectorsWithIndustry = new Set(industries.map((i) => i.sector_id));
  for (const x of subs) rows.push({ sector_id: industryById.get(x.industry_id).sector_id, industry_id: x.industry_id, sub_industry_id: x.id });
  for (const i of industries) if (!industriesWithSub.has(i.id)) rows.push({ sector_id: i.sector_id, industry_id: i.id, sub_industry_id: null });
  for (const sid of sectorSet) if (!sectorsWithIndustry.has(sid)) rows.push({ sector_id: sid, industry_id: null, sub_industry_id: null });
  await prisma.$transaction([
    prisma.businessClassification.deleteMany({ where: { entity_kind: entityKind, entity_id: entityId } }),
    prisma.businessClassification.createMany({ data: rows.map((r) => ({ org_group_id: groupId, entity_kind: entityKind, entity_id: entityId, ...r })) }),
  ]);
  return { rows: rows.length };
}

/** entity id -> { sectors: [{ id, name }], industries: [...], sub_industries: [...] } for the given businesses. */
async function classificationOf(groupIds, entityKind, entityIds) {
  const rows = entityIds.length
    ? await prisma.businessClassification.findMany({
      where: { org_group_id: groupOf(groupIds), entity_kind: entityKind, entity_id: { in: entityIds } },
      include: { sector: { select: { id: true, name: true } }, industry: { select: { id: true, name: true, sector_id: true } }, sub_industry: { select: { id: true, name: true, industry_id: true } } },
    })
    : [];
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.entity_id)) out.set(r.entity_id, { sectors: new Map(), industries: new Map(), sub_industries: new Map() });
    const o = out.get(r.entity_id);
    o.sectors.set(r.sector.id, r.sector);
    if (r.industry) o.industries.set(r.industry.id, r.industry);
    if (r.sub_industry) o.sub_industries.set(r.sub_industry.id, r.sub_industry);
  }
  return new Map([...out].map(([id, o]) => [id, { sectors: [...o.sectors.values()].sort(collator), industries: [...o.industries.values()].sort(collator), sub_industries: [...o.sub_industries.values()].sort(collator) }]));
}

/**
 * The map: every sector with its industries and sub-industries and which of the group's businesses operate in each, and what is still empty.
 * `statuses` narrows to businesses that are operational / planning / future. Businesses with no classification are listed apart.
 */
async function businessMap(groupIds, { statuses } = {}) {
  const groupId = groupOf(groupIds);
  const [t, companies, rows] = await Promise.all([
    tree(groupIds),
    prisma.groupCompany.findMany({ where: { org_group_id: { in: groupIds } }, include: { org: { select: { name: true } } } }),
    prisma.businessClassification.findMany({ where: { org_group_id: groupId, entity_kind: KIND_COMPANY } }),
  ]);
  const wanted = statuses?.length ? new Set(statuses) : null;
  const byId = new Map(companies.filter((c) => !wanted || wanted.has(c.status)).map((c) => [c.id, { id: c.id, name: c.org?.name || c.name, status: c.status }]));
  const inSector = new Map();
  const inIndustry = new Map();
  const inSub = new Map();
  const add = (map, key, id) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); };
  const placed = new Set();
  for (const r of rows) {
    if (!byId.has(r.entity_id)) continue;
    placed.add(r.entity_id);
    add(inSector, r.sector_id, r.entity_id);
    if (r.industry_id) add(inIndustry, r.industry_id, r.entity_id);
    if (r.sub_industry_id) add(inSub, r.sub_industry_id, r.entity_id);
  }
  const list = (set) => [...(set || [])].map((id) => byId.get(id)).sort(collator);
  const sectors = t.sectors.map((s) => {
    const industries = s.industries.map((i) => {
      const subs = i.subs.map((x) => ({ id: x.id, name: x.name, companies: list(inSub.get(x.id)) }));
      return { id: i.id, name: i.name, companies: list(inIndustry.get(i.id)), subs, subs_covered: subs.filter((x) => x.companies.length).length };
    });
    return {
      id: s.id, name: s.name, companies: list(inSector.get(s.id)), industries,
      industries_covered: industries.filter((i) => i.companies.length).length,
      subs_total: industries.reduce((n, i) => n + i.subs.length, 0),
      subs_covered: industries.reduce((n, i) => n + i.subs_covered, 0),
    };
  });
  return {
    sectors,
    unclassified: [...byId.values()].filter((c) => !placed.has(c.id)).sort(collator),
    summary: {
      sectors: sectors.length,
      sectors_covered: sectors.filter((s) => s.companies.length).length,
      industries: sectors.reduce((n, s) => n + s.industries.length, 0),
      industries_covered: sectors.reduce((n, s) => n + s.industries_covered, 0),
      sub_industries: sectors.reduce((n, s) => n + s.subs_total, 0),
      sub_industries_covered: sectors.reduce((n, s) => n + s.subs_covered, 0),
      companies: byId.size,
      companies_classified: placed.size,
    },
  };
}

module.exports = {
  tree, seedStandard,
  addSector, renameSector, removeSector, addIndustry, renameIndustry, removeIndustry, addSubIndustries, renameSubIndustry, removeSubIndustry,
  setClassification, classificationOf, businessMap, KIND_COMPANY,
};
