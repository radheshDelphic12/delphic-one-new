const prisma = require('../../config/db');
const { STUCK_THRESHOLD_DAYS } = require('../../config/constants');
const gxLeads = require('../gulati/leads.service');
const gxDeals = require('../gulati/deals.service');
const gxFinance = require('../gulati/finance.service');
const axLeads = require('../acconcy/leads.service');
const axDeals = require('../acconcy/deals.service');
const axFinance = require('../acconcy/finance.service');
const zxProperties = require('../zephyr/properties.service');
const zxProjects = require('../zephyr/projects.service');
const zxRent = require('../zephyr/rent.service');

// Group Dashboard > Group Finance > Company insights, for the companies that have no section of their own yet
// (Delphic Global, Gulati Industries, Zephyr, Acconcy; Foundation, Zklyrera and Valterra have theirs). Every company
// answers in the same shape so one component draws them all:
//   { kind, org_id, org_name, title, subtitle, open_path, kpis: [{ label, value, format, hint, tone }],
//     attention: { title, rows: [{ label, detail, tag }] } | null, top: { title, columns, rows } | null }
// Figures come from each company's own services (the same numbers as its own dashboard); nothing is calculated twice.

const num = (v) => Number(v) || 0;
const kpi = (label, value, format, hint, tone) => ({ label, value, format, hint: hint || null, tone: tone || 'blue' });
const DAY = 86400000;

async function delphic(org) {
  const now = new Date();
  const orgId = org.id;
  const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_DAYS * DAY);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const liveReq = { org_id: orgId, deleted_at: null, status: { in: ['open', 'in_progress'] } };
  const [byStatus, tatActive, clients, leads, subs, subsMonth, stuck, byClient] = await Promise.all([
    prisma.requirement.groupBy({ by: ['status'], where: { org_id: orgId, deleted_at: null }, _count: { _all: true } }),
    prisma.requirement.count({ where: { ...liveReq, tat_ends_at: { gt: now } } }),
    prisma.account.count({ where: { org_id: orgId, type: 'client', stage: 'active', is_project: false, deleted_at: null } }),
    prisma.account.count({ where: { org_id: orgId, stage: { in: ['lead', 'meeting_scheduled', 'rescheduled'] }, deleted_at: null } }),
    prisma.submission.groupBy({ by: ['stage'], where: { org_id: orgId }, _count: { _all: true } }),
    prisma.submission.count({ where: { org_id: orgId, created_at: { gte: monthStart } } }),
    prisma.requirement.findMany({ where: { ...liveReq, updated_at: { lte: stuckBefore } }, orderBy: { updated_at: 'asc' }, take: 6, select: { id: true, title: true, updated_at: true, account: { select: { name: true } } } }),
    prisma.requirement.groupBy({ by: ['account_id'], where: liveReq, _count: { _all: true }, orderBy: { _count: { account_id: 'desc' } }, take: 6 }),
  ]);
  const st = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  const sub = Object.fromEntries(subs.map((r) => [r.stage, r._count._all]));
  const inPlay = ['sourced', 'internal_screening', 'submitted_to_client', 'interview_scheduled', 'interview_result', 'offer_sent', 'bgv'].reduce((a, k) => a + (sub[k] || 0), 0);
  const names = new Map((await prisma.account.findMany({ where: { id: { in: byClient.map((r) => r.account_id) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const stuckCount = await prisma.requirement.count({ where: { ...liveReq, updated_at: { lte: stuckBefore } } });
  return {
    title: 'Hiring, clients and pipeline',
    subtitle: 'Requirements, candidates in play and client accounts',
    open_path: '/requirements',
    kpis: [
      kpi('Open requirements', (st.open || 0) + (st.in_progress || 0), 'count', `${st.open || 0} open · ${st.in_progress || 0} in progress`, 'blue'),
      kpi('TAT running', tatActive, 'count', 'Open requirements still inside their TAT window', 'orange'),
      kpi('Active clients', clients, 'count', `${leads} lead${leads === 1 ? '' : 's'} / meetings in the pipeline`, 'green'),
      kpi('Candidates in play', inPlay, 'count', `${subsMonth} submitted this month`, 'purple'),
      kpi('Interviews', sub.interview_scheduled || 0, 'count', `${sub.interview_result || 0} awaiting a result`, 'cyan'),
      kpi('Offers and BGV', (sub.offer_sent || 0) + (sub.bgv || 0), 'count', `${sub.offer_sent || 0} offers · ${sub.bgv || 0} in BGV`, 'green'),
      kpi('No movement', stuckCount, 'count', `Open requirements untouched for ${STUCK_THRESHOLD_DAYS}+ days`, stuckCount ? 'red' : 'green'),
      kpi('On hold', st.on_hold || 0, 'count', `${st.closed || 0} closed · ${st.dropped || 0} dropped`, 'purple'),
    ],
    attention: stuck.length
      ? { title: `Requirements with no movement for ${STUCK_THRESHOLD_DAYS}+ days`, rows: stuck.map((r) => ({ label: r.title, detail: `${r.account?.name || 'No client'} · last touched ${r.updated_at.toISOString().slice(0, 10)}`, tag: null })) }
      : null,
    top: byClient.length
      ? { title: 'Clients with the most open requirements', columns: [{ key: 'name', label: 'Client' }, { key: 'open', label: 'Open requirements', format: 'count' }], rows: byClient.map((r) => ({ name: names.get(r.account_id) || 'Client', open: r._count._all })) }
      : null,
  };
}

async function gulatiIndustries(org) {
  const orgId = org.id;
  const [ls, dealRows, fin] = await Promise.all([
    gxLeads.summary(orgId),
    prisma.gxDeal.findMany({ where: { org_id: orgId, deleted_at: null, status: { not: 'cancelled' } } }),
    gxFinance.overview(orgId, {}, []),
  ]);
  const deals = await gxDeals.decorate(orgId, dealRows);
  const active = deals.filter((d) => gxDeals.ACTIVE.includes(d.status));
  const delayed = active.filter((d) => d.summary.delayed);
  const top = [...active].sort((a, b) => num(b.expected_sale_amount ?? b.summary.sales_revenue) - num(a.expected_sale_amount ?? a.summary.sales_revenue)).slice(0, 6);
  return {
    title: 'Trading deals and pipeline',
    subtitle: 'Leads, active deals, money still to collect and pay',
    open_path: '/gulati',
    kpis: [
      kpi('Leads', ls.total, 'count', `${ls.by_stage?.new?.count || 0} new · ${ls.by_stage?.negotiation?.count || 0} in negotiation`, 'blue'),
      kpi('Open pipeline value', num(ls.open_value), 'money', `${ls.by_stage?.won?.count || 0} won so far`, 'purple'),
      kpi('Active deals', fin.active_deals, 'count', `${fin.completed_deals} completed`, 'green'),
      kpi('Active deal value', num(fin.active_deal_value), 'money', `Completed ${Math.round(num(fin.completed_deal_value)).toLocaleString('en-IN')}`, 'cyan'),
      kpi('To collect (receivables)', num(fin.receivables), 'money', 'Unpaid by clients', 'orange'),
      kpi('To pay (payables)', num(fin.payables), 'money', 'Unpaid to vendors', 'orange'),
      kpi('Pending sourcing', active.filter((d) => (d.summary.quantities?.remaining_to_source ?? 0) > 0).length, 'count', 'Active deals still to source', 'purple'),
      kpi('Delayed deals', delayed.length, 'count', 'Past their expected date', delayed.length ? 'red' : 'green'),
    ],
    attention: delayed.length
      ? { title: 'Delayed deals', rows: delayed.slice(0, 6).map((d) => ({ label: d.name, detail: `${d.code} · ${d.status}`, tag: null })) }
      : null,
    top: top.length
      ? { title: 'Largest active deals', columns: [{ key: 'name', label: 'Deal' }, { key: 'status', label: 'Status' }, { key: 'value', label: 'Value', format: 'money' }], rows: top.map((d) => ({ name: `${d.name} (${d.code})`, status: d.status, value: num(d.expected_sale_amount ?? d.summary.sales_revenue) })) }
      : null,
  };
}

async function acconcy(org) {
  const orgId = org.id;
  // One after another: the first read of a new company creates its settings row, and two at once would collide.
  const ls = await axLeads.summary(orgId, {});
  const dealRows = await prisma.axDeal.findMany({ where: axDeals.whereOf(orgId, {}) });
  const fin = await axFinance.overview(orgId, {}, []);
  const deals = (await axDeals.decorate(orgId, dealRows)).filter((d) => d.status !== 'cancelled');
  const active = deals.filter((d) => axDeals.ACTIVE.includes(d.status));
  const delayed = active.filter((d) => d.summary.delayed);
  const top = [...active].sort((a, b) => num(b.deal_amount) - num(a.deal_amount)).slice(0, 6);
  return {
    title: 'Service deals and pipeline',
    subtitle: 'Leads, active deals and delivery by service',
    open_path: '/acconcy',
    kpis: [
      kpi('Leads', ls.total, 'count', `${ls.open_count} open`, 'blue'),
      kpi('Open pipeline value', num(ls.open_value), 'money', ls.win_rate === null || ls.win_rate === undefined ? 'No decided leads yet' : `Win rate ${ls.win_rate}%`, 'purple'),
      kpi('Active deals', fin.active_deals, 'count', `${fin.completed_deals} completed`, 'green'),
      kpi('Active deal value', num(fin.active_deal_value), 'money', `All deals ${Math.round(num(fin.total_deal_value)).toLocaleString('en-IN')}`, 'cyan'),
      kpi('Delayed deals', delayed.length, 'count', 'Past their expected date', delayed.length ? 'red' : 'green'),
      ...(fin.deals_by_service || []).filter((s) => s.count).slice(0, 3).map((s) => kpi(s.label, s.count, 'count', `Value ${Math.round(num(s.value)).toLocaleString('en-IN')}`, 'orange')),
    ],
    attention: delayed.length
      ? { title: 'Delayed deals', rows: delayed.slice(0, 6).map((d) => ({ label: d.name, detail: `${d.code} · ${d.status}`, tag: null })) }
      : null,
    top: top.length
      ? { title: 'Largest active deals', columns: [{ key: 'name', label: 'Deal' }, { key: 'status', label: 'Status' }, { key: 'value', label: 'Deal amount', format: 'money' }], rows: top.map((d) => ({ name: `${d.name} (${d.code})`, status: d.status, value: num(d.deal_amount) })) }
      : null,
  };
}

async function zephyr(org) {
  const orgId = org.id;
  const [props, projects, overdue] = await Promise.all([
    zxProperties.summary(orgId, { canFinance: true }),
    zxProjects.summary(orgId),
    zxRent.listOverdue(orgId),
  ]);
  const owed = (d) => Math.max(0, num(d.amount) - num(d.paid_amount));
  const overdueTotal = overdue.reduce((a, d) => a + owed(d), 0);
  const occupancy = props.units ? Math.round((props.occupied / props.units) * 100) : null;
  return {
    title: 'Properties, projects and rent',
    subtitle: 'Real-estate holdings, live projects and rent still to collect',
    open_path: '/zephyr',
    kpis: [
      kpi('Properties', props.properties, 'count', `${props.units} unit${props.units === 1 ? '' : 's'} · ${props.vacant} vacant`, 'blue'),
      kpi('Occupancy', occupancy, 'pct', `${props.occupied} of ${props.units} units rented`, 'green'),
      kpi('Total invested', num(props.total_invested), 'money', `Loans outstanding ${Math.round(num(props.outstanding_loans)).toLocaleString('en-IN')}`, 'purple'),
      kpi('Property valuation', num(props.valuation), 'money', props.appreciation_pct === null || props.appreciation_pct === undefined ? 'No valuations entered' : `Appreciation ${props.appreciation_pct}% (unrealised)`, 'cyan'),
      kpi('Live projects', projects.live_count, 'count', `${projects.total} in all · ${projects.milestones_overdue} milestone${projects.milestones_overdue === 1 ? '' : 's'} overdue`, projects.milestones_overdue ? 'red' : 'green'),
      kpi('Live contract value', num(projects.live_contract_value), 'money', `Committed cost ${Math.round(num(projects.committed_cost)).toLocaleString('en-IN')}`, 'orange'),
      kpi('Rent overdue', overdueTotal, 'money', `${overdue.length} due${overdue.length === 1 ? '' : 's'} past date`, overdue.length ? 'red' : 'green'),
      kpi('Monthly EMI', num(props.monthly_emi), 'money', 'Across active property loans', 'purple'),
    ],
    attention: overdue.length
      ? { title: 'Rent past its due date', rows: overdue.slice(0, 6).map((d) => ({ label: d.tenant?.company_name || d.tenant?.name || 'Tenant', detail: `${d.property?.name || ''} ${d.unit?.name || ''} · ${d.days_overdue} days late`.trim(), tag: owed(d) })) }
      : null,
    top: null,
  };
}

const BUILDERS = { delphic, gulati: gulatiIndustries, acconcy, zephyr };
const KINDS = Object.keys(BUILDERS);

const TTL_MS = 60000;
const cache = new Map(); // org id -> { at, value }; the dashboard polls every 30s, the numbers do not need to be fresher than this

/** One company's insight, or null when it has none / cannot be read (one failing company never breaks the dashboard). */
async function build(org, kind) {
  if (!BUILDERS[kind]) return null;
  const hit = cache.get(org.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value;
  try {
    const body = await BUILDERS[kind](org);
    value = { kind, org_id: org.id, org_name: org.name, ...body };
  } catch (err) {
    console.error(`group insights failed for ${org.name}:`, err.message);
    return { kind, org_id: org.id, org_name: org.name, title: 'Not available', subtitle: 'The figures could not be read right now', open_path: '/', kpis: [], attention: null, top: null, error: true };
  }
  cache.set(org.id, { at: Date.now(), value });
  return value;
}

const clearCache = () => cache.clear();

module.exports = { build, KINDS, clearCache };
