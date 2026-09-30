const prisma = require('../config/db');

// Expense claim approval chain: Manager -> HR -> Finance.
//   manager — the claimant's reporting manager (OrgMembership.manager_id);
//             a claimant with no manager starts at HR.
//   hr      — anyone in the HR department.
//   finance — anyone in the Finance / Accounts department.
// An admin can act at any step. Departments are matched by name (same
// posture as requireDepartment / requireItDepartment), from either the
// per-org membership department or the legacy User.department.
const CLAIM_STAGES = ['manager', 'hr', 'finance'];
const STAGE_DEPARTMENTS = {
  hr: new Set(['hr', 'human resources', 'human resource', 'people']),
  finance: new Set(['finance', 'accounts', 'accounting', 'finance & accounts']),
};

function nextStage(stage) {
  const i = CLAIM_STAGES.indexOf(stage);
  return i >= 0 && i < CLAIM_STAGES.length - 1 ? CLAIM_STAGES[i + 1] : null;
}

// The departments (lower-cased names) the acting user belongs to.
async function actorDepartments(user) {
  const [membership, legacy] = await Promise.all([
    user.org_membership_id
      ? prisma.orgMembership.findUnique({ where: { id: user.org_membership_id }, select: { department: { select: { name: true } } } })
      : null,
    user.id ? prisma.user.findUnique({ where: { id: user.id }, select: { department: { select: { name: true } } } }) : null,
  ]);
  return new Set([membership?.department?.name, legacy?.department?.name].filter(Boolean).map((n) => n.trim().toLowerCase()));
}

// What this user may approve: { admin, hr, finance, membershipId }.
async function approverScope(user) {
  const departments = await actorDepartments(user);
  const inStage = (stage) => [...departments].some((d) => STAGE_DEPARTMENTS[stage].has(d));
  return { admin: user.role === 'admin', hr: inStage('hr'), finance: inStage('finance'), membershipId: user.org_membership_id || null };
}

// May `scope` act on a claim waiting at `stage`, owned by a member whose manager is `managerId`?
function canActOn(scope, stage, managerId) {
  if (scope.admin) return true;
  if (stage === 'manager') return Boolean(scope.membershipId) && managerId === scope.membershipId;
  if (stage === 'hr') return scope.hr;
  if (stage === 'finance') return scope.finance;
  return false;
}

// Prisma `where` for the pending claims `scope` may act on right now.
function actionableWhere(scope) {
  if (scope.admin) return { status: 'pending' };
  const or = [];
  if (scope.membershipId) or.push({ approval_stage: 'manager', org_membership: { manager_id: scope.membershipId } });
  if (scope.hr) or.push({ approval_stage: 'hr' });
  if (scope.finance) or.push({ approval_stage: 'finance' });
  return or.length ? { status: 'pending', OR: or } : null;
}

module.exports = { CLAIM_STAGES, nextStage, approverScope, canActOn, actionableWhere };
