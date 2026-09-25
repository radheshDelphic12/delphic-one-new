/**
 * Recipient resolvers. Each takes a Prisma client (`tx` inside a transaction, or the
 * shared `prisma` singleton otherwise) and returns an array of user ids. Callers pass
 * the resolved list to notify(); dedupe + role/preference filtering happen there.
 */

async function admins(client) {
  const rows = await client.user.findMany({
    where: { role: 'admin', active: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function accountParticipants(client, accountId) {
  if (!accountId) return [];
  const account = await client.account.findUnique({
    where: { id: accountId },
    select: { owner_id: true, origin_owner_id: true },
  });
  if (!account) return [];
  return [account.owner_id, account.origin_owner_id].filter(Boolean);
}

async function requirementParticipants(client, requirementId) {
  if (!requirementId) return [];
  const requirement = await client.requirement.findUnique({
    where: { id: requirementId },
    select: {
      sales_owner_id: true,
      account: { select: { owner_id: true } },
      assignments: {
        where: { role_on_req: 'recruiter', unassigned_at: null },
        select: { user_id: true },
      },
    },
  });
  if (!requirement) return [];
  return [
    requirement.sales_owner_id,
    requirement.account?.owner_id,
    ...requirement.assignments.map((a) => a.user_id),
  ].filter(Boolean);
}

async function submissionParticipants(client, submissionId) {
  if (!submissionId) return [];
  const submission = await client.submission.findUnique({
    where: { id: submissionId },
    select: {
      submitted_by: true,
      seat: {
        select: {
          requirement: {
            select: { sales_owner_id: true, account: { select: { owner_id: true } } },
          },
        },
      },
    },
  });
  if (!submission) return [];
  return [
    submission.submitted_by,
    submission.seat?.requirement?.sales_owner_id,
    submission.seat?.requirement?.account?.owner_id,
  ].filter(Boolean);
}

async function interviewRoundParticipants(client, roundId) {
  if (!roundId) return [];
  const round = await client.interviewRound.findUnique({
    where: { id: roundId },
    select: {
      submission: {
        select: {
          submitted_by: true,
          seat: { select: { requirement: { select: { sales_owner_id: true } } } },
        },
      },
      interviewers: { select: { user_id: true } },
    },
  });
  if (!round) return [];
  return [
    round.submission?.submitted_by,
    round.submission?.seat?.requirement?.sales_owner_id,
    ...round.interviewers.map((i) => i.user_id),
  ].filter(Boolean);
}

async function isAssignedInterviewer(client, roundId, userId) {
  if (!roundId || !userId) return false;
  const row = await client.interviewRoundInterviewer.findFirst({
    where: { interview_round_id: roundId, user_id: userId },
    select: { id: true },
  });
  return Boolean(row);
}

module.exports = {
  admins,
  accountParticipants,
  requirementParticipants,
  submissionParticipants,
  interviewRoundParticipants,
  isAssignedInterviewer,
};
