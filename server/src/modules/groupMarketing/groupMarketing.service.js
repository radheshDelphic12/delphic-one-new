const { z } = require('zod');
const prisma = require('../../config/db');

// Group Dashboard > Marketing: campaigns across the group's companies. Each has a channel, dates, a budget and a target, a log of what was
// spent, and what it brought (leads, deals won, revenue). The summary adds them up by channel and by company, with cost per lead and the
// return on the spend.

const CHANNELS = ['linkedin', 'google_ads', 'meta_ads', 'email', 'event', 'website', 'referral', 'content', 'other'];
const STATUSES = ['planned', 'live', 'paused', 'done'];
const uuid = z.string().uuid();
const day = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());
const num = (max) => z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(0).max(max).optional());
const campaignSchema = z.object({
  org_group_id: uuid.optional(),
  name: z.string().trim().min(1, 'Name the campaign').max(150),
  channel: z.enum(CHANNELS).default('other'),
  company_ids: z.array(uuid).max(50).default([]),
  status: z.enum(STATUSES).default('planned'),
  start_date: day, end_date: day,
  budget: num(1e13), target_leads: num(1e7), leads: num(1e7), deals_won: num(1e7), revenue: num(1e13),
  owner_name: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable().optional()),
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(3000).nullable().optional()),
});
const campaignUpdateSchema = campaignSchema.partial().omit({ org_group_id: true });
const spendSchema = z.object({ spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), amount: z.coerce.number().positive('Enter the amount').max(1e12), note: z.string().trim().max(500).optional() });
const listSchema = z.object({ status: z.enum(STATUSES).optional(), channel: z.enum(CHANNELS).optional(), company_id: uuid.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });

const asDate = (v) => (v ? new Date(`${v}T00:00:00Z`) : v === null ? null : undefined);
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const groupOrgs = (groupIds) => prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });

function view(c, orgName) {
  const spent = round2((c.spends || []).reduce((s, x) => s + Number(x.amount), 0));
  const budget = Number(c.budget);
  return {
    id: c.id, name: c.name, channel: c.channel, status: c.status, start_date: ymd(c.start_date), end_date: ymd(c.end_date),
    companies: c.company_ids.map((id) => ({ id, name: orgName.get(id) || 'Company' })), all_companies: c.company_ids.length === 0,
    budget, spent, left: round2(budget - spent), over_budget: budget > 0 && spent > budget,
    target_leads: c.target_leads, leads: c.leads, deals_won: c.deals_won, revenue: Number(c.revenue),
    cost_per_lead: c.leads ? round2(spent / c.leads) : null, return_on_spend: spent ? round2(Number(c.revenue) / spent) : null,
    owner_name: c.owner_name, notes: c.notes,
    spends: (c.spends || []).map((s) => ({ id: s.id, spent_on: ymd(s.spent_on), amount: Number(s.amount), note: s.note })).sort((a, b) => b.spent_on.localeCompare(a.spent_on)),
  };
}

function summarize(rows) {
  const add = (m, k, r) => {
    const cur = m.get(k) || { key: k, campaigns: 0, budget: 0, spent: 0, leads: 0, deals_won: 0, revenue: 0 };
    cur.campaigns += 1; cur.budget += r.budget; cur.spent += r.spent; cur.leads += r.leads; cur.deals_won += r.deals_won; cur.revenue += r.revenue;
    m.set(k, cur);
  };
  const byChannel = new Map(); const byCompany = new Map();
  for (const r of rows) {
    add(byChannel, r.channel, r);
    if (r.all_companies) add(byCompany, 'All companies', r); else for (const c of r.companies) add(byCompany, c.name, r);
  }
  const finish = (m) => [...m.values()].map((x) => ({ ...x, budget: round2(x.budget), spent: round2(x.spent), revenue: round2(x.revenue), cost_per_lead: x.leads ? round2(x.spent / x.leads) : null })).sort((a, b) => b.spent - a.spent);
  const t = rows.reduce((s, r) => ({ budget: s.budget + r.budget, spent: s.spent + r.spent, leads: s.leads + r.leads, deals_won: s.deals_won + r.deals_won, revenue: s.revenue + r.revenue }), { budget: 0, spent: 0, leads: 0, deals_won: 0, revenue: 0 });
  return {
    totals: { campaigns: rows.length, live: rows.filter((r) => r.status === 'live').length, budget: round2(t.budget), spent: round2(t.spent), leads: t.leads, deals_won: t.deals_won, revenue: round2(t.revenue), cost_per_lead: t.leads ? round2(t.spent / t.leads) : null, return_on_spend: t.spent ? round2(t.revenue / t.spent) : null },
    by_channel: finish(byChannel), by_company: finish(byCompany),
  };
}

async function list(groupIds, q) {
  const orgs = await groupOrgs(groupIds);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const where = { org_group_id: { in: groupIds }, deleted_at: null, ...(q.status ? { status: q.status } : {}), ...(q.channel ? { channel: q.channel } : {}) };
  if (q.company_id) where.OR = [{ company_ids: { has: q.company_id } }, { company_ids: { isEmpty: true } }];
  if (q.year) {
    const from = new Date(Date.UTC(q.year, 0, 1)); const to = new Date(Date.UTC(q.year, 11, 31));
    where.AND = [{ OR: [{ start_date: null }, { start_date: { lte: to } }] }, { OR: [{ end_date: null }, { end_date: { gte: from } }] }];
  }
  const rows = (await prisma.groupCampaign.findMany({ where, include: { spends: true }, orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }] })).map((c) => view(c, orgName));
  return { campaigns: rows, summary: summarize(rows), companies: orgs, channels: CHANNELS, statuses: STATUSES };
}

async function checkCompanies(groupId, ids) {
  if (!ids || !ids.length) return true;
  return (await prisma.org.count({ where: { id: { in: ids }, org_group_id: groupId } })) === new Set(ids).size;
}
const find = (groupIds, id) => prisma.groupCampaign.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { spends: true } });
const one = async (groupIds, id) => view(await find(groupIds, id), new Map((await groupOrgs(groupIds)).map((o) => [o.id, o.name])));

async function create(groupIds, actorId, input) {
  const groupId = input.org_group_id && groupIds.includes(input.org_group_id) ? input.org_group_id : groupIds[0];
  if (!(await checkCompanies(groupId, input.company_ids))) return { error: 'company_not_in_group' };
  if (input.start_date && input.end_date && input.end_date < input.start_date) return { error: 'bad_dates' };
  const { org_group_id: _g, ...rest } = input;
  const row = await prisma.groupCampaign.create({ data: { ...rest, org_group_id: groupId, company_ids: [...new Set(input.company_ids)], start_date: asDate(input.start_date), end_date: asDate(input.end_date), created_by: actorId } });
  return { campaign: await one(groupIds, row.id) };
}

async function update(groupIds, id, input) {
  const c = await find(groupIds, id);
  if (!c) return { error: 'not_found' };
  if (input.company_ids && !(await checkCompanies(c.org_group_id, input.company_ids))) return { error: 'company_not_in_group' };
  const start = input.start_date !== undefined ? input.start_date : ymd(c.start_date);
  const end = input.end_date !== undefined ? input.end_date : ymd(c.end_date);
  if (start && end && end < start) return { error: 'bad_dates' };
  const data = { ...input };
  if (input.start_date !== undefined) data.start_date = asDate(input.start_date);
  if (input.end_date !== undefined) data.end_date = asDate(input.end_date);
  if (input.company_ids) data.company_ids = [...new Set(input.company_ids)];
  await prisma.groupCampaign.update({ where: { id }, data });
  return { campaign: await one(groupIds, id) };
}

async function remove(groupIds, id) {
  const c = await find(groupIds, id);
  if (!c) return { error: 'not_found' };
  await prisma.groupCampaign.update({ where: { id }, data: { deleted_at: new Date() } });
  return { removed: true };
}

async function addSpend(groupIds, actorId, id, input) {
  const c = await find(groupIds, id);
  if (!c) return { error: 'not_found' };
  await prisma.groupCampaignSpend.create({ data: { campaign_id: id, spent_on: asDate(input.spent_on || new Date().toISOString().slice(0, 10)), amount: input.amount, note: input.note || null, created_by: actorId } });
  return { campaign: await one(groupIds, id) };
}

async function removeSpend(groupIds, id, spendId) {
  const c = await find(groupIds, id);
  if (!c) return { error: 'not_found' };
  const done = await prisma.groupCampaignSpend.deleteMany({ where: { id: spendId, campaign_id: id } });
  return done.count ? { campaign: await one(groupIds, id) } : { error: 'not_found' };
}

module.exports = { CHANNELS, STATUSES, campaignSchema, campaignUpdateSchema, spendSchema, listSchema, list, create, update, remove, addSpend, removeSpend };
