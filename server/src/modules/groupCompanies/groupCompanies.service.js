const prisma = require('../../config/db');

// Group Dashboard > Companies & Stakes. The register of every business of the holding group, current or planned, with sector, tagline,
// foundation day and who holds how much of it (several holders per company). Rows exist for every company workspace of the group (created the
// first time the register is read); a business with no workspace here (planned / future, or an investee) is added by hand.

const STATUSES = ['operational', 'planning', 'future'];
const HOLDER_KINDS = ['group', 'company', 'external'];
const NO_SECTOR = 'Not set';

const num = (v) => Number(v);
const round3 = (n) => Math.round(n * 1000) / 1000;
const labelOf = (c) => (c ? c.org?.name || c.name : '');

const scoped = (groupIds) => ({ org_group_id: { in: groupIds } });

async function ensureRegister(groupIds) {
  const orgs = await prisma.org.findMany({ where: scoped(groupIds), select: { id: true, name: true, org_group_id: true, enabled_modules: true } });
  if (!orgs.length) return;
  const have = new Map((await prisma.groupCompany.findMany({ where: { org_id: { in: orgs.map((o) => o.id) } }, select: { id: true, org_id: true, org_group_id: true } })).map((r) => [r.org_id, r]));
  for (const o of orgs) {
    const row = have.get(o.id);
    if (row) {
      // the workspace moved to another holding group after its row was made: the row and its stakes follow, or it could never be a holder here
      if (row.org_group_id !== o.org_group_id) {
        await prisma.$transaction([
          prisma.groupCompany.update({ where: { id: row.id }, data: { org_group_id: o.org_group_id } }),
          prisma.groupCompanyStake.updateMany({ where: { OR: [{ held_company_id: row.id }, { holder_company_id: row.id }] }, data: { org_group_id: o.org_group_id } }),
        ]);
      }
      continue;
    }
    try {
      // a business added by hand under the same name becomes this workspace's row instead of a duplicate
      const same = await prisma.groupCompany.findFirst({ where: { org_group_id: o.org_group_id, name: o.name, org_id: null } });
      if (same) await prisma.groupCompany.update({ where: { id: same.id }, data: { org_id: o.id } });
      else await prisma.groupCompany.create({ data: { org_group_id: o.org_group_id, org_id: o.id, name: o.name, status: o.enabled_modules?.includes('coming_soon') ? 'planning' : 'operational' } });
    } catch (err) {
      if (err.code !== 'P2002') throw err; // a parallel request created it first
    }
  }
}

/** The whole register, the holders of each business, what each one holds in others, and the sector roll-up. */
async function list(groupIds) {
  await ensureRegister(groupIds);
  const [groups, rows, stakes] = await Promise.all([
    prisma.orgGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }),
    prisma.groupCompany.findMany({
      where: scoped(groupIds),
      include: { org: { select: { id: true, name: true, logo_url: true, enabled_modules: true } } },
      orderBy: [{ created_at: 'asc' }, { name: 'asc' }],
    }),
    prisma.groupCompanyStake.findMany({ where: scoped(groupIds), orderBy: { created_at: 'asc' } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const byId = new Map(rows.map((c) => [c.id, c]));

  const companies = rows.map((c) => {
    const holders = stakes.filter((s) => s.held_company_id === c.id).map((s) => ({
      id: s.id,
      holder_kind: s.holder_kind,
      holder_company_id: s.holder_company_id,
      holder_name: s.holder_name,
      holder_label: s.holder_kind === 'group' ? groupName.get(s.org_group_id) || 'The group' : s.holder_kind === 'company' ? labelOf(byId.get(s.holder_company_id)) : s.holder_name,
      pct: num(s.pct),
      notes: s.notes,
    }));
    const holdings = stakes.filter((s) => s.holder_company_id === c.id).map((s) => ({ company_id: s.held_company_id, company: labelOf(byId.get(s.held_company_id)), pct: num(s.pct) }));
    return {
      id: c.id,
      org_id: c.org_id,
      org_group_id: c.org_group_id,
      is_current: Boolean(c.org_id),
      coming_soon: Boolean(c.org?.enabled_modules?.includes('coming_soon')),
      name: labelOf(c),
      logo_url: c.org?.logo_url || null,
      short_code: c.short_code,
      sector: c.sector,
      tagline: c.tagline,
      foundation_date: c.foundation_date ? c.foundation_date.toISOString().slice(0, 10) : null,
      status: c.status,
      notes: c.notes,
      holders,
      total_pct: round3(holders.reduce((s, h) => s + h.pct, 0)),
      holdings,
    };
  });

  const bySector = new Map();
  for (const c of companies) {
    const key = (c.sector || '').trim() || NO_SECTOR;
    if (!bySector.has(key)) bySector.set(key, { sector: key, companies: [] });
    bySector.get(key).companies.push({ id: c.id, name: c.name, status: c.status, total_pct: c.total_pct });
  }
  const sectors = [...bySector.values()].map((s) => ({ ...s, count: s.companies.length })).sort((a, b) => (a.sector === NO_SECTOR) - (b.sector === NO_SECTOR) || b.count - a.count || a.sector.localeCompare(b.sector));

  return {
    groups,
    companies,
    sectors,
    sector_options: [...new Set(companies.map((c) => (c.sector || '').trim()).filter(Boolean))].sort(),
    summary: {
      total: companies.length,
      current: companies.filter((c) => c.is_current).length,
      off_platform: companies.filter((c) => !c.is_current).length,
      by_status: Object.fromEntries(STATUSES.map((s) => [s, companies.filter((c) => c.status === s).length])),
      stakes_missing: companies.filter((c) => !c.holders.length).length,
      stakes_over: companies.filter((c) => c.total_pct > 100).length,
    },
  };
}

function groupFor(groupIds, requested) {
  if (requested) return groupIds.includes(requested) ? requested : null;
  return groupIds.length === 1 ? groupIds[0] : null;
}

/** A business with no workspace here: a planned or future business, or an investee. */
async function create(groupIds, userId, body) {
  const groupId = groupFor(groupIds, body.org_group_id);
  if (!groupId) return { error: 'group_required' };
  const name = body.name.trim();
  if (await prisma.org.findFirst({ where: { org_group_id: groupId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) return { error: 'exists_as_workspace' };
  if (await prisma.groupCompany.findFirst({ where: { org_group_id: groupId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) return { error: 'name_taken' };
  const company = await prisma.groupCompany.create({
    data: {
      org_group_id: groupId,
      name,
      short_code: body.short_code || null,
      sector: body.sector || null,
      tagline: body.tagline || null,
      foundation_date: body.foundation_date ? new Date(`${body.foundation_date}T00:00:00.000Z`) : null,
      status: body.status || 'planning',
      notes: body.notes || null,
      created_by: userId,
    },
  });
  return { company };
}

async function update(groupIds, id, patch) {
  const company = await prisma.groupCompany.findFirst({ where: { id, ...scoped(groupIds) } });
  if (!company) return { error: 'not_found' };
  const data = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    // A workspace keeps the name it has in Settings; renaming happens there.
    if (company.org_id) {
      const org = await prisma.org.findUnique({ where: { id: company.org_id }, select: { name: true } });
      if (name !== org?.name) return { error: 'name_linked' };
    } else if (name !== company.name) {
      const clash = await prisma.groupCompany.findFirst({ where: { org_group_id: company.org_group_id, id: { not: id }, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
      if (clash) return { error: 'name_taken' };
      data.name = name;
    }
  }
  for (const k of ['short_code', 'sector', 'tagline', 'notes']) if (patch[k] !== undefined) data[k] = patch[k] ? String(patch[k]).trim() : null;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.foundation_date !== undefined) data.foundation_date = patch.foundation_date ? new Date(`${patch.foundation_date}T00:00:00.000Z`) : null;
  const saved = await prisma.groupCompany.update({ where: { id }, data });
  return { company: saved };
}

/** Renames a sector for every business of the group that uses it; `to` null clears it (the businesses show as "Not set"). */
async function renameSector(groupIds, from, to) {
  const target = to ? to.trim() : null;
  const result = await prisma.groupCompany.updateMany({ where: { ...scoped(groupIds), sector: { equals: from.trim(), mode: 'insensitive' } }, data: { sector: target || null } });
  return { updated: result.count };
}

/** Only a business without a workspace can be removed here; its stakes (and the stakes it holds in others) go with it. */
async function remove(groupIds, id) {
  const company = await prisma.groupCompany.findFirst({ where: { id, ...scoped(groupIds) }, include: { holdings: { select: { id: true } } } });
  if (!company) return { error: 'not_found' };
  if (company.org_id) return { error: 'linked_company' };
  await prisma.groupCompany.delete({ where: { id } });
  return { deleted: true, stakes_removed: company.holdings.length };
}

// Ownership must not loop: A cannot hold B when B (directly or through others) already holds A.
async function loops(groupId, companyId, holderIds) {
  const edges = await prisma.groupCompanyStake.findMany({ where: { org_group_id: groupId, holder_company_id: { not: null }, held_company_id: { not: companyId } }, select: { holder_company_id: true, held_company_id: true } });
  const holdersOf = new Map();
  for (const e of edges) holdersOf.set(e.held_company_id, [...(holdersOf.get(e.held_company_id) || []), e.holder_company_id]);
  for (const start of holderIds) {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const at = stack.pop();
      if (at === companyId) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(holdersOf.get(at) || []));
    }
  }
  return false;
}

/** Replaces the holders of one business. The percentages add up to at most 100; each holder is the group, another business of the register or a named outsider. */
async function setStakes(groupIds, id, stakes) {
  const company = await prisma.groupCompany.findFirst({ where: { id, ...scoped(groupIds) } });
  if (!company) return { error: 'not_found' };
  const seen = new Set();
  let total = 0;
  const holderCompanies = [];
  for (const s of stakes) {
    if (!HOLDER_KINDS.includes(s.holder_kind)) return { error: 'bad_holder' };
    const key = s.holder_kind === 'group' ? 'group' : s.holder_kind === 'company' ? `c:${s.holder_company_id}` : `x:${String(s.holder_name || '').trim().toLowerCase()}`;
    if (seen.has(key)) return { error: 'duplicate_holder' };
    seen.add(key);
    if (s.holder_kind === 'company') {
      if (!s.holder_company_id || s.holder_company_id === id) return { error: 'self_holder' };
      holderCompanies.push(s.holder_company_id);
    }
    if (s.holder_kind === 'external' && !String(s.holder_name || '').trim()) return { error: 'holder_name_needed' };
    total += s.pct;
  }
  if (round3(total) > 100) return { error: 'over_100', total: round3(total) };
  if (holderCompanies.length) {
    const found = await prisma.groupCompany.count({ where: { id: { in: holderCompanies }, org_group_id: company.org_group_id } });
    if (found !== new Set(holderCompanies).size) return { error: 'holder_not_found' };
    if (await loops(company.org_group_id, id, holderCompanies)) return { error: 'ownership_loop' };
  }
  await prisma.$transaction(async (tx) => {
    await tx.groupCompanyStake.deleteMany({ where: { held_company_id: id } });
    if (stakes.length) {
      await tx.groupCompanyStake.createMany({
        data: stakes.map((s) => ({
          org_group_id: company.org_group_id,
          held_company_id: id,
          holder_kind: s.holder_kind,
          holder_company_id: s.holder_kind === 'company' ? s.holder_company_id : null,
          holder_name: s.holder_kind === 'external' ? String(s.holder_name).trim() : null,
          pct: s.pct,
          notes: s.notes || null,
        })),
      });
    }
  });
  return { total: round3(total) };
}

/** Quick start: every company workspace with no holder yet is recorded as wholly owned by the group. */
async function setGroupDefault(groupIds) {
  await ensureRegister(groupIds);
  const open = await prisma.groupCompany.findMany({ where: { ...scoped(groupIds), org_id: { not: null }, holders: { none: {} } }, select: { id: true, org_group_id: true } });
  if (open.length) await prisma.groupCompanyStake.createMany({ data: open.map((c) => ({ org_group_id: c.org_group_id, held_company_id: c.id, holder_kind: 'group', pct: 100 })) });
  return { updated: open.length };
}

module.exports = { list, create, update, renameSector, remove, setStakes, setGroupDefault, STATUSES };
