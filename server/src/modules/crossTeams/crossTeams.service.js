const { z } = require('zod');
const prisma = require('../../config/db');

// Cross-functional teams across the group. Managed on the Group Dashboard (group superadmin); on a company's people screens an admin sees
// and sets which of these teams an employee belongs to. A team covers chosen companies (none chosen = every company of the group) and its
// members can come from any of them; one person can be in several teams.

const uuid = z.string().uuid();
const teamSchema = z.object({
  org_group_id: uuid.optional(),
  name: z.string().trim().min(1, 'Name the team').max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  company_ids: z.array(uuid).max(50).default([]),
  lead_user_id: uuid.nullable().optional(),
});
const teamUpdateSchema = teamSchema.partial().omit({ org_group_id: true });
const membersSchema = z.object({ members: z.array(z.object({ user_id: uuid, org_id: uuid.nullable().optional() })).max(500) });
const personTeamsSchema = z.object({ team_ids: z.array(uuid).max(100) });

const groupOrgs = (groupIds) => prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true, org_group_id: true }, orderBy: { name: 'asc' } });

async function shape(teams, orgs) {
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const userIds = [...new Set(teams.flatMap((t) => [...t.members.map((m) => m.user_id), t.lead_user_id].filter(Boolean)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return teams.map((t) => ({
    id: t.id, org_group_id: t.org_group_id, name: t.name, description: t.description,
    companies: t.company_ids.map((id) => ({ id, name: orgName.get(id) || 'Company' })), all_companies: t.company_ids.length === 0,
    lead: t.lead_user_id ? { id: t.lead_user_id, name: byId.get(t.lead_user_id)?.name || 'Unknown' } : null,
    members: t.members.map((m) => ({ user_id: m.user_id, name: byId.get(m.user_id)?.name || 'Unknown', email: byId.get(m.user_id)?.email || null, org_id: m.org_id, company: m.org_id ? orgName.get(m.org_id) || null : null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    member_count: t.members.length, updated_at: t.updated_at,
  }));
}

// ---- Group Dashboard (group superadmin)

async function list(groupIds) {
  const [teams, orgs] = await Promise.all([
    prisma.crossFunctionalTeam.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null }, include: { members: true }, orderBy: { name: 'asc' } }),
    groupOrgs(groupIds),
  ]);
  return { teams: await shape(teams, orgs), companies: orgs.map((o) => ({ id: o.id, name: o.name })) };
}

/** People of the group's companies, to pick members from: a person in several companies is listed once with all of them. */
async function people(groupIds, { search, company_ids }) {
  const orgs = await groupOrgs(groupIds);
  const allowed = new Set(orgs.map((o) => o.id));
  const wanted = (company_ids || []).filter((id) => allowed.has(id));
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: { in: wanted.length ? wanted : [...allowed] }, employment_status: { not: 'terminated' }, deleted_at: null, ...(search ? { person: { name: { contains: search, mode: 'insensitive' } } } : {}) },
    select: { org_id: true, person: { select: { id: true, name: true, email: true, active: true } }, designation: { select: { name: true } } },
    take: 1000,
  });
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const byUser = new Map();
  for (const r of rows) {
    if (!r.person?.active) continue;
    const cur = byUser.get(r.person.id) || { user_id: r.person.id, name: r.person.name, email: r.person.email, companies: [] };
    cur.companies.push({ org_id: r.org_id, name: orgName.get(r.org_id), designation: r.designation?.name || null });
    byUser.set(r.person.id, cur);
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function checkCompanies(groupId, ids) {
  if (!ids.length) return true;
  return (await prisma.org.count({ where: { id: { in: ids }, org_group_id: groupId } })) === new Set(ids).size;
}

async function create(groupIds, actorId, input) {
  const groupId = input.org_group_id && groupIds.includes(input.org_group_id) ? input.org_group_id : groupIds[0];
  if (!(await checkCompanies(groupId, input.company_ids))) return { error: 'company_not_in_group' };
  const t = await prisma.crossFunctionalTeam.create({ data: { org_group_id: groupId, name: input.name, description: input.description || null, company_ids: [...new Set(input.company_ids)], lead_user_id: input.lead_user_id || null, created_by: actorId } });
  return { team: (await shape([{ ...t, members: [] }], await groupOrgs(groupIds)))[0] };
}

async function findTeam(groupIds, id) {
  return prisma.crossFunctionalTeam.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { members: true } });
}

async function update(groupIds, id, input) {
  const t = await findTeam(groupIds, id);
  if (!t) return { error: 'not_found' };
  if (input.company_ids && !(await checkCompanies(t.org_group_id, input.company_ids))) return { error: 'company_not_in_group' };
  const data = {};
  for (const k of ['name', 'description', 'lead_user_id']) if (input[k] !== undefined) data[k] = input[k] || (k === 'name' ? t.name : null);
  if (input.company_ids) data.company_ids = [...new Set(input.company_ids)];
  const row = await prisma.crossFunctionalTeam.update({ where: { id }, data, include: { members: true } });
  return { team: (await shape([row], await groupOrgs(groupIds)))[0] };
}

async function remove(groupIds, id) {
  const t = await findTeam(groupIds, id);
  if (!t) return { error: 'not_found' };
  await prisma.crossFunctionalTeam.update({ where: { id }, data: { deleted_at: new Date() } });
  return { removed: true };
}

/** Replace the team's members. Each must work in one of the group's companies (and in one of the team's companies, when it has some). */
async function setMembers(groupIds, id, members) {
  const t = await findTeam(groupIds, id);
  if (!t) return { error: 'not_found' };
  const orgsAllowed = t.company_ids.length ? t.company_ids : (await groupOrgs([t.org_group_id])).map((o) => o.id);
  const userIds = [...new Set(members.map((m) => m.user_id))];
  const memberships = await prisma.orgMembership.findMany({ where: { person_id: { in: userIds }, org_id: { in: orgsAllowed }, employment_status: { not: 'terminated' } }, select: { person_id: true, org_id: true } });
  const ok = new Map();
  for (const m of memberships) if (!ok.has(m.person_id)) ok.set(m.person_id, m.org_id);
  const bad = userIds.filter((u) => !ok.has(u));
  if (bad.length) return { error: 'person_not_in_companies' };
  await prisma.$transaction([
    prisma.crossFunctionalTeamMember.deleteMany({ where: { team_id: id, user_id: { notIn: userIds } } }),
    ...userIds.map((u) => {
      const asked = members.find((m) => m.user_id === u)?.org_id;
      const orgId = asked && memberships.some((m) => m.person_id === u && m.org_id === asked) ? asked : ok.get(u);
      return prisma.crossFunctionalTeamMember.upsert({ where: { team_id_user_id: { team_id: id, user_id: u } }, create: { team_id: id, user_id: u, org_id: orgId }, update: { org_id: orgId } });
    }),
  ]);
  return { team: (await shape([await findTeam(groupIds, id)], await groupOrgs(groupIds)))[0] };
}

// ---- a company's people screens (company admin / People > Edit): the teams open to this company, and one employee's teams

async function teamsForCompany(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { org_group_id: true } });
  if (!org?.org_group_id) return [];
  const teams = await prisma.crossFunctionalTeam.findMany({ where: { org_group_id: org.org_group_id, deleted_at: null, OR: [{ company_ids: { isEmpty: true } }, { company_ids: { has: orgId } }] }, select: { id: true, name: true, description: true }, orderBy: { name: 'asc' } });
  return teams;
}

async function personTeams(orgId, membershipId) {
  const m = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { person_id: true } });
  if (!m) return { error: 'not_found' };
  const open = await teamsForCompany(orgId);
  const rows = await prisma.crossFunctionalTeamMember.findMany({ where: { user_id: m.person_id, team: { deleted_at: null } }, include: { team: { select: { id: true, name: true } } } });
  return { teams: rows.map((r) => ({ id: r.team.id, name: r.team.name, via_company: r.org_id })), options: open };
}

/** Set an employee's teams from their company: only teams open to this company are added or removed here (others stay as they are). */
async function setPersonTeams(orgId, membershipId, teamIds) {
  const m = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { person_id: true } });
  if (!m) return { error: 'not_found' };
  const open = await teamsForCompany(orgId);
  const openIds = new Set(open.map((t) => t.id));
  if (teamIds.some((id) => !openIds.has(id))) return { error: 'team_not_open' };
  await prisma.$transaction([
    prisma.crossFunctionalTeamMember.deleteMany({ where: { user_id: m.person_id, team_id: { in: [...openIds].filter((id) => !teamIds.includes(id)) } } }),
    ...teamIds.map((id) => prisma.crossFunctionalTeamMember.upsert({ where: { team_id_user_id: { team_id: id, user_id: m.person_id } }, create: { team_id: id, user_id: m.person_id, org_id: orgId }, update: {} })),
  ]);
  return personTeams(orgId, membershipId);
}

module.exports = { teamSchema, teamUpdateSchema, membersSchema, personTeamsSchema, list, people, create, update, remove, setMembers, teamsForCompany, personTeams, setPersonTeams };
