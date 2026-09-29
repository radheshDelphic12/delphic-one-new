const prisma = require('../../config/db');

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

async function getOrgChart(orgId, { include_terminated }) {
  const [memberships, teams] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { org_id: orgId, ...(include_terminated ? {} : { employment_status: { not: 'terminated' } }) },
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
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
  const charts = await Promise.all(orgs.map(async (org) => ({ org, ...(await getOrgChart(org.id, { include_terminated })) })));
  return charts;
}

module.exports = { getOrgChart, getGroupOrgChart };
