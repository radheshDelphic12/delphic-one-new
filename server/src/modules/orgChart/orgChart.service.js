const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');

const MEMBER_SELECT = {
  id: true,
  manager_id: true,
  role: true,
  employee_code: true,
  team_id: true,
  worker_type: true,
  employment_status: true,
  joined_at: true,
  left_at: true,
  notice_end_date: true,
  person: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
};

// Builds the reporting-line tree from OrgMembership.manager_id in memory —
// row counts here are "employees at one company", not a scale that needs a
// recursive SQL CTE (see HLD §12, no analytics-warehouse posture applies
// the same reasoning). A membership whose manager isn't in this same result
// set (filtered out by include_terminated, or a cross-org manager_id that
// should never happen but isn't DB-enforced) becomes its own root rather
// than being silently dropped.
function buildTree(memberships) {
  const nodes = new Map(memberships.map((m) => [m.id, { ...m, direct_reports: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    if (node.manager_id && nodes.has(node.manager_id)) {
      nodes.get(node.manager_id).direct_reports.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// The company admins in a built tree, as small cards (the group chart shows them between the company and its teams).
function adminsOf(roots) {
  const out = [];
  const walk = (node) => {
    if (node.role === 'admin') {
      out.push({ id: node.id, name: node.person?.name || '', email: node.person?.email || null, designation: node.designation?.name || null, employee_code: node.employee_code || null });
    }
    node.direct_reports.forEach(walk);
  };
  roots.forEach(walk);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Someone who has exited is not in the chart: status "terminated", or a last working day that has already passed (the
// nightly job that flips serving-notice people to terminated may not have run yet). The last working day itself still counts.
function exitedWhere(today) {
  return {
    AND: [
      { employment_status: { not: 'terminated' } },
      { OR: [{ left_at: null }, { left_at: { gte: today } }] },
      { NOT: { employment_status: 'notice_period', notice_end_date: { lt: today } } },
    ],
  };
}

async function getOrgChart(orgId, { include_terminated, exclude_group_admins = false }) {
  const [memberships, teams] = await Promise.all([
    prisma.orgMembership.findMany({
      where: {
        org_id: orgId,
        ...(include_terminated ? {} : exitedWhere(todayIst())),
        ...(exclude_group_admins ? { person: { is_group_superadmin: false } } : {}),
      },
      select: MEMBER_SELECT,
      orderBy: { joined_at: 'asc' },
    }),
    // HR Settings → Teams, for the team view (a box per team around its lead).
    prisma.team.findMany({
      where: { org_id: orgId },
      select: { id: true, name: true, lead_membership_id: true, manager_membership_id: true, open_positions: true, sort_order: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
  ]);
  return { headcount: memberships.length, roots: buildTree(memberships), teams };
}

// Cross-org — mirrors super-dashboard's posture (HLD §7): gated to
// authorizeGroupSuperadmin only, org_group_id narrows it, omitted it spans
// every org. Reads live OrgMembership rows directly, unlike the super
// dashboard's profitability rollups, because there's no fact table here to
// roll up — this *is* the live directory.
async function getGroupOrgChart({ org_group_id, include_terminated }, allowedGroupIds) {
  const orgs = await prisma.org.findMany({
    where: {
      org_group_id: org_group_id && allowedGroupIds.includes(org_group_id)
        ? org_group_id
        : { in: allowedGroupIds },
    },
    select: { id: true, name: true, slug: true, enabled_modules: true },
    orderBy: { name: 'asc' },
  });
  // The group superadmin sits above every company in the group chart, not inside each one. Under each company
  // comes its own admin (the company's role 'admin' members), then the company's team chart.
  const charts = await Promise.all(orgs.map(async (org) => {
    const chart = await getOrgChart(org.id, { include_terminated, exclude_group_admins: true });
    return { org, ...chart, admins: adminsOf(chart.roots) };
  }));
  return charts;
}

module.exports = { getOrgChart, getGroupOrgChart };
