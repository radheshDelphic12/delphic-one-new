const prisma = require('../../config/db');

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Role-scoped requirement filter used by pipeline board and reports explorer.
 * admin + bda see all (BDAs work the whole requirement map across the team),
 * sales sees own (sales_owner_id), recruiter sees assigned only.
 */
async function requirementScopeWhere(user) {
  if (!user) return { id: NO_MATCH_ID };
  if (user.role === 'admin' || user.role === 'bda') return {};
  if (user.role === 'sales') return { sales_owner_id: user.id };
  if (user.role === 'recruiter') {
    const assignments = await prisma.requirementAssignment.findMany({
      where: { user_id: user.id, role_on_req: 'recruiter', unassigned_at: null },
      select: { requirement_id: true },
    });
    const ids = assignments.map((a) => a.requirement_id);
    return { id: { in: ids.length ? ids : [NO_MATCH_ID] } };
  }
  return { id: NO_MATCH_ID };
}

/**
 * Role-scoped account filter for lead pipeline boards.
 * admin + bda see all accounts (BDAs may browse the full book); sales sees clients.
 * Account mutation remains ownership-gated for BDAs.
 */
function accountScopeWhere(user) {
  if (!user) return { id: NO_MATCH_ID };
  if (user.role === 'admin' || user.role === 'bda') return {};
  if (user.role === 'sales') return { type: 'client' };
  return { id: NO_MATCH_ID };
}

module.exports = { requirementScopeWhere, accountScopeWhere, NO_MATCH_ID };
