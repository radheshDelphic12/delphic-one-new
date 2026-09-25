const prisma = require('../../config/db');
const env = require('../../config/env');
const { SUBMISSION_STAGE_TRANSITIONS, CLIENT_ROUND_TYPES, INTERNAL_ROUND_TYPES, computeMargin, computeMissingMandatoryRounds, isBackwardTransition, roundTypeLabel } = require('./stageMachines');
const { computeClosureDetail } = require('../../utils/closureProgress');
const { notify, interviewRoundParticipants, submissionParticipants, admins } = require('../../lib/notifications');
const { interviewRoundInvite } = require('../../lib/email/invites');

/**
 * Assemble the free-form context every submission / interview notification wants:
 * candidate name, requirement title, account name. Best-effort — returns {} on miss.
 */
async function loadNotifyContext(tx, submissionId) {
  const row = await tx.submission.findUnique({
    where: { id: submissionId },
    select: {
      profile: { select: { name: true } },
      seat: { select: { requirement: { select: { id: true, title: true, account: { select: { name: true } } } } } },
    },
  });
  if (!row) return {};
  return {
    candidateName: row.profile?.name,
    requirementId: row.seat?.requirement?.id,
    requirementTitle: row.seat?.requirement?.title,
    accountName: row.seat?.requirement?.account?.name,
  };
}

function fmtWhen(date) {
  if (!date) return '';
  try {
    // Server clock is UTC — render in the business timezone or the time is wrong in notifications.
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: env.timezone,
    });
  } catch (_err) {
    return '';
  }
}

const INTERVIEWER_INCLUDE = {
  interviewers: { include: { user: { select: { id: true, name: true, email: true } } } },
  scheduler: { select: { id: true, name: true, email: true } },
};

const INCLUDE = {
  seat: { include: { requirement: { include: { account: { select: { id: true, name: true } } } } } },
  profile: {
    select: {
      id: true, name: true, current_company: true, total_experience_years: true,
      primary_skills: true, expected_ctc: true, notice_period_days: true, source: true,
      vendor_account: { select: { id: true, name: true } },
    },
  },
  submitted_by_user: { select: { id: true, name: true } },
  interview_rounds: { orderBy: { round_number: 'asc' }, include: INTERVIEWER_INCLUDE },
};

function serializeInterviewRound(round) {
  if (!round) return null;
  const { interviewers, scheduler, ...rest } = round;
  return {
    ...rest,
    scheduled_by: scheduler ? { id: scheduler.id, name: scheduler.name, email: scheduler.email } : null,
    interviewers: (interviewers || []).map((row) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
    })),
  };
}

function serialize(row) {
  if (!row) return null;
  const { requirement_seat_id, profile_id, submitted_by, seat, profile, submitted_by_user, interview_rounds, ...rest } = row;

  return {
    ...rest,
    profile_id,
    seat: seat ? { id: seat.id, seat_label: seat.seat_label, requirement_id: seat.requirement_id } : null,
    requirement: seat
      ? { id: seat.requirement.id, title: seat.requirement.title, account_name: seat.requirement.account.name, sales_owner_id: seat.requirement.sales_owner_id }
      : null,
    profile,
    submitted_by: submitted_by_user,
    interview_rounds: interview_rounds ? interview_rounds.map(serializeInterviewRound) : undefined,
    missing_mandatory_rounds: interview_rounds ? computeMissingMandatoryRounds(interview_rounds) : undefined,
    progress: interview_rounds ? computeClosureDetail(row.stage, interview_rounds) : null,
  };
}

async function list(filters) {
  const {
    account_id, requirement_id, seat_id, profile_id, sales_owner_id, stage, submitted_by,
    joined_from, joined_to, search, sort_by, sort_order, page, limit,
  } = filters;

  const seatFilter = {};
  if (requirement_id) seatFilter.requirement_id = requirement_id;
  if (account_id) seatFilter.requirement = { ...(seatFilter.requirement || {}), account_id };
  if (sales_owner_id) seatFilter.requirement = { ...(seatFilter.requirement || {}), sales_owner_id };

  const stages = stage
    ? String(stage).split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const joinedRange = {};
  if (joined_from) joinedRange.gte = new Date(joined_from);
  if (joined_to) joinedRange.lte = new Date(joined_to);

  const where = {
    ...(Object.keys(seatFilter).length ? { seat: seatFilter } : {}),
    ...(seat_id ? { requirement_seat_id: seat_id } : {}),
    ...(profile_id ? { profile_id } : {}),
    ...(stages.length ? { stage: { in: stages } } : {}),
    ...(submitted_by ? { submitted_by } : {}),
    ...(Object.keys(joinedRange).length ? { actual_joining_date: joinedRange } : {}),
    ...(search
      ? {
          OR: [
            { profile: { name: { contains: search, mode: 'insensitive' } } },
            { seat: { requirement: { title: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const orderBy = sort_by === 'stage' ? { stage: sort_order } : sort_by === 'margin' ? { margin: sort_order } : { created_at: sort_order };

  const [total, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({ where, include: INCLUDE, orderBy, take: limit, skip: (page - 1) * limit }),
  ]);

  return { rows: rows.map(serialize), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getById(id) {
  const row = await prisma.submission.findUnique({ where: { id }, include: INCLUDE });
  return serialize(row);
}

async function create(data, user) {
  const seat = await prisma.requirementSeat.findUnique({ where: { id: data.requirement_seat_id } });
  if (!seat) return { error: 'seat_not_found' };
  if (seat.is_locked) return { error: 'seat_locked' };

  const profile = await prisma.profile.findUnique({ where: { id: data.profile_id } });
  if (!profile || !profile.is_active) return { error: 'profile_inactive' };
  if (profile.source === 'vendor' && data.vendor_rate == null) return { error: 'vendor_rate_required' };

  // Sales may only put forward bench candidates (source = direct/"Bench" AND
  // currently on_bench) — everything else (vendor-sourced, market, off-bench) stays
  // recruiter/admin-only.
  if (user.role === 'sales' && !(profile.source === 'direct' && profile.on_bench)) {
    return { error: 'sales_bench_only' };
  }

  const duplicate = await prisma.submission.findFirst({
    where: { requirement_seat_id: data.requirement_seat_id, profile_id: data.profile_id, stage: { notIn: ['rejected', 'backout'] } },
  });
  if (duplicate) return { error: 'duplicate_submission' };

  const { margin, margin_percentage } = computeMargin(
    data.proposed_rate, data.proposed_rate_currency, data.vendor_rate, data.vendor_rate_currency
  );

  const row = await prisma.submission.create({
    data: { ...data, submitted_by: user.id, margin, margin_percentage },
    include: INCLUDE,
  });

  return { submission: serialize(row) };
}

async function update(id, patch) {
  const existing = await prisma.submission.findUnique({ where: { id } });
  const proposed_rate = patch.proposed_rate ?? existing.proposed_rate;
  const proposed_rate_currency = patch.proposed_rate_currency ?? existing.proposed_rate_currency;
  const vendor_rate = patch.vendor_rate ?? existing.vendor_rate;
  const vendor_rate_currency = patch.vendor_rate_currency ?? existing.vendor_rate_currency;
  const { margin, margin_percentage } = computeMargin(proposed_rate, proposed_rate_currency, vendor_rate, vendor_rate_currency);

  const row = await prisma.submission.update({
    where: { id },
    data: { ...patch, margin, margin_percentage },
    include: INCLUDE,
  });
  return serialize(row);
}

async function changeStage(id, { to_stage, reason, backout_reason, rejection_reason }, user) {
  const userId = user.id;
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({ where: { id } });
    if (!submission) return { error: 'not_found' };
    if (submission.is_locked) return { error: 'locked' };
    if (!(SUBMISSION_STAGE_TRANSITIONS[submission.stage] || []).includes(to_stage)) return { error: 'invalid_transition' };

    // Stepping a submission back a stage, or reactivating a rejected / backed-out
    // candidate, is admin/superadmin-only and needs a reason (logged to stage_history).
    const backward = isBackwardTransition(submission.stage, to_stage);
    if (backward) {
      if (!(user.role === 'admin' || user.is_superadmin)) return { error: 'forbidden_backward' };
      if (!reason || !reason.trim()) return { error: 'reason_required' };
    }

    // Sales, recruiter and admin all do forward stage moves on any submission.
    // Backward moves / reactivations stay admin-only via the `backward` guard above.

    if (to_stage === 'backout' && !(backout_reason || reason)) return { error: 'backout_reason_required' };
    if (to_stage === 'rejected' && !(rejection_reason || reason)) return { error: 'rejection_reason_required' };

    if (to_stage === 'offer_sent') {
      const rounds = await tx.interviewRound.findMany({ where: { submission_id: id } });
      const allResolved = rounds.length > 0 && rounds.every((r) => r.result !== 'pending');
      if (!allResolved) return { error: 'rounds_not_resolved' };
    }
    if (to_stage === 'closed') {
      if (submission.bgv_status !== 'cleared') return { error: 'bgv_not_cleared' };
    }

    const patch = { stage: to_stage };
    if (to_stage === 'backout') {
      patch.backout_stage = submission.stage;
      patch.backout_reason = backout_reason || reason;
    }
    if (to_stage === 'rejected') {
      patch.rejection_stage = submission.stage;
      patch.rejection_reason = rejection_reason || reason;
    }
    if (to_stage === 'closed') patch.is_locked = true;

    // Reactivating a terminal submission clears the exit stamps so the ticket reads clean.
    if (submission.stage === 'rejected') { patch.rejection_stage = null; patch.rejection_reason = null; }
    if (submission.stage === 'backout') { patch.backout_stage = null; patch.backout_reason = null; }

    const updated = await tx.submission.update({ where: { id }, data: patch, include: INCLUDE });

    await tx.stageHistory.create({
      data: {
        entity_type: 'submission',
        entity_id: id,
        from_stage: submission.stage,
        to_stage,
        changed_by: userId,
        reason: reason || backout_reason || rejection_reason || null,
      },
    });

    if (to_stage === 'closed') {
      await tx.requirementSeat.update({
        where: { id: submission.requirement_seat_id },
        data: {
          seat_status: 'closed',
          is_locked: true,
          closed_at: new Date(),
          joined_at: updated.actual_joining_date || new Date(),
        },
      });
    }

    const NOTIFY_STAGES = {
      submitted_to_client: 'candidate_submitted_to_client',
      rejected: 'candidate_rejected',
      backout: 'candidate_backout',
      offer_sent: 'candidate_offer',
    };
    if (NOTIFY_STAGES[to_stage]) {
      const ctx = await loadNotifyContext(tx, id);
      const recipientIds = ['rejected', 'backout'].includes(to_stage)
        ? [...(await submissionParticipants(tx, id)), ...(await admins(tx))]
        : await submissionParticipants(tx, id);
      await notify(tx, {
        type: NOTIFY_STAGES[to_stage],
        actorId: userId,
        recipientIds,
        context: {
          ...ctx,
          actorName: user.name,
          submissionId: id,
          reason: patch.rejection_reason || patch.backout_reason || reason || null,
        },
      });
    }

    return { submission: serialize(updated) };
  });
}

// Superadmin-only: force a submission to any stage, ignoring the transition map, the
// lock, and every gate (rounds resolved / BGV cleared). Still audited in stage_history
// with an [override] reason prefix. Deliberately minimal — it does not touch seat
// status, so a superadmin correcting a mistaken `closed` should also fix the seat.
async function changeStageOverride(id, { to_stage, reason, is_locked }, user) {
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({ where: { id } });
    if (!submission) return { error: 'not_found' };

    const patch = { stage: to_stage };
    if (is_locked !== undefined) patch.is_locked = is_locked;

    const updated = await tx.submission.update({ where: { id }, data: patch, include: INCLUDE });

    const history = await tx.stageHistory.create({
      data: {
        entity_type: 'submission',
        entity_id: id,
        from_stage: submission.stage,
        to_stage,
        changed_by: user.id,
        reason: `[override] ${reason}`,
      },
    });

    return { submission: serialize(updated), history };
  });
}

async function getHistory(id) {
  const rows = await prisma.stageHistory.findMany({
    where: { entity_type: 'submission', entity_id: id },
    orderBy: { changed_at: 'asc' },
    include: { changed_by_user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    from_stage: r.from_stage,
    to_stage: r.to_stage,
    changed_by: r.changed_by_user,
    reason: r.reason,
    changed_at: r.changed_at,
  }));
}

function canManageInterviewRound(submission, requirementSalesOwnerId, roundType, user) {
  if (user.role === 'admin') return true;
  if (user.role === 'recruiter') return submission.submitted_by === user.id;
  if (user.role === 'sales') {
    return CLIENT_ROUND_TYPES.includes(roundType) && requirementSalesOwnerId === user.id;
  }
  return false;
}

function canRescheduleInterviewRound(round, submission, requirementSalesOwnerId, user) {
  if (canManageInterviewRound(submission, requirementSalesOwnerId, round.round_type, user)) return true;
  return Boolean(round.scheduled_by && round.scheduled_by === user.id);
}

async function loadRequirementSalesOwnerId(tx, submission) {
  const seat = await tx.requirementSeat.findUnique({
    where: { id: submission.requirement_seat_id },
    include: { requirement: { select: { sales_owner_id: true } } },
  });
  return seat?.requirement?.sales_owner_id ?? null;
}

async function validateActiveInterviewers(tx, interviewerIds) {
  if (!interviewerIds || interviewerIds.length === 0) return { ok: true };
  const users = await tx.user.findMany({
    where: { id: { in: interviewerIds }, active: true },
    select: { id: true },
  });
  if (users.length !== interviewerIds.length) return { error: 'invalid_interviewers' };
  return { ok: true };
}

async function syncInterviewers(tx, roundId, interviewerIds) {
  if (interviewerIds === undefined) return;
  await tx.interviewRoundInterviewer.deleteMany({ where: { interview_round_id: roundId } });
  if (interviewerIds.length === 0) return;
  await tx.interviewRoundInterviewer.createMany({
    data: interviewerIds.map((user_id) => ({ interview_round_id: roundId, user_id })),
  });
}

async function loadInterviewRound(tx, id) {
  const round = await tx.interviewRound.findUnique({
    where: { id },
    include: INTERVIEWER_INCLUDE,
  });
  return serializeInterviewRound(round);
}

async function addInterviewRound(submissionId, data, user) {
  const userId = user.id;
  return prisma.$transaction(async (tx) => {
    const submission = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!submission) return { error: 'not_found' };

    const salesOwnerId = await loadRequirementSalesOwnerId(tx, submission);
    if (!canManageInterviewRound(submission, salesOwnerId, data.round_type, user)) return { error: 'forbidden' };

    const last = await tx.interviewRound.findFirst({ where: { submission_id: submissionId }, orderBy: { round_number: 'desc' } });
    const round_number = last ? last.round_number + 1 : 1;

    const { interviewer_ids, ...roundFields } = data;
    const payload = { ...roundFields, submission_id: submissionId, round_number, scheduled_by: userId };
    if (payload.scheduled_at) payload.scheduled_at = new Date(payload.scheduled_at);
    if (payload.completed_at) payload.completed_at = new Date(payload.completed_at);
    if (['pass', 'fail', 'no_show'].includes(payload.result) && !payload.completed_at) {
      payload.completed_at = new Date();
    }
    if (payload.interviewer_email === '') payload.interviewer_email = null;

    if (INTERNAL_ROUND_TYPES.includes(data.round_type) && interviewer_ids !== undefined) {
      const check = await validateActiveInterviewers(tx, interviewer_ids);
      if (check.error) return { error: check.error };
    }

    const created = await tx.interviewRound.create({ data: payload });

    if (INTERNAL_ROUND_TYPES.includes(data.round_type) && interviewer_ids !== undefined) {
      await syncInterviewers(tx, created.id, interviewer_ids);
    }

    const round = await loadInterviewRound(tx, created.id);

    if (submission.stage === 'submitted_to_client') {
      await tx.submission.update({ where: { id: submissionId }, data: { stage: 'interview_scheduled' } });
      await tx.stageHistory.create({
        data: {
          entity_type: 'submission',
          entity_id: submissionId,
          from_stage: 'submitted_to_client',
          to_stage: 'interview_scheduled',
          changed_by: userId,
          reason: null,
        },
      });
    }

    // NOTE: interview_scheduled -> interview_result is deliberately a MANUAL move
    // (POST /submissions/:id/stage). Recording round results never auto-advances the
    // submission stage.

    const ctx = await loadNotifyContext(tx, submissionId);
    await notify(tx, {
      type: 'interview_scheduled',
      actorId: userId,
      recipientIds: await interviewRoundParticipants(tx, created.id),
      context: {
        ...ctx,
        actorName: user.name,
        submissionId,
        interviewRoundId: created.id,
        roundTypeLabel: roundTypeLabel(created.round_type),
        scheduledAtLabel: fmtWhen(created.scheduled_at),
        ics: interviewRoundInvite({
          round: created,
          title: `${roundTypeLabel(created.round_type)}: ${ctx.candidateName || 'Candidate'} (${ctx.requirementTitle || 'Requirement'})`,
          description: `Interview for ${ctx.candidateName || 'a candidate'} on ${ctx.requirementTitle || 'a requirement'}.`,
          organizer: { name: user.name, email: user.email },
        }),
      },
    });

    return { round };
  });
}

async function updateInterviewRound(id, patch, user) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.interviewRound.findUnique({ where: { id } });
    if (!existing) return { error: 'not_found' };

    const submission = await tx.submission.findUnique({ where: { id: existing.submission_id } });
    if (!submission) return { error: 'not_found' };
    const salesOwnerId = await loadRequirementSalesOwnerId(tx, submission);
    const isManager = canManageInterviewRound(submission, salesOwnerId, existing.round_type, user);
    const isScheduler = canRescheduleInterviewRound(existing, submission, salesOwnerId, user);
    if (!isManager && !isScheduler) return { error: 'forbidden' };

    const { interviewer_ids, ...patchFields } = patch;
    const finalPatch = { ...patchFields };
    if (!isManager) {
      const allowed = ['scheduled_at', 'duration_minutes', 'meeting_link', 'round_name'];
      for (const key of Object.keys(finalPatch)) {
        if (!allowed.includes(key)) delete finalPatch[key];
      }
    }
    delete finalPatch.scheduled_by;
    if (finalPatch.scheduled_at) finalPatch.scheduled_at = new Date(finalPatch.scheduled_at);
    if (finalPatch.completed_at) finalPatch.completed_at = new Date(finalPatch.completed_at);
    if (finalPatch.interviewer_email === '') finalPatch.interviewer_email = null;
    if (isManager && ['pass', 'fail', 'no_show'].includes(patch.result) && !patch.completed_at) {
      finalPatch.completed_at = new Date();
    }

    if (isManager && INTERNAL_ROUND_TYPES.includes(existing.round_type) && interviewer_ids !== undefined) {
      const check = await validateActiveInterviewers(tx, interviewer_ids);
      if (check.error) return { error: check.error };
    }

    await tx.interviewRound.update({ where: { id }, data: finalPatch });

    if (isManager && INTERNAL_ROUND_TYPES.includes(existing.round_type) && interviewer_ids !== undefined) {
      await syncInterviewers(tx, id, interviewer_ids);
    }

    const round = await loadInterviewRound(tx, id);

    // NOTE: interview_scheduled -> interview_result stays MANUAL. Editing a round's
    // result (pass/fail/no_show) never auto-advances the submission stage.

    const rescheduled = finalPatch.scheduled_at
      && (!existing.scheduled_at || new Date(finalPatch.scheduled_at).getTime() !== new Date(existing.scheduled_at).getTime());
    const feedbackTouched = patch.result !== undefined || patch.feedback !== undefined || patch.rating !== undefined;

    if (rescheduled || feedbackTouched) {
      const ctx = await loadNotifyContext(tx, existing.submission_id);
      const base = {
        ...ctx,
        actorName: user.name,
        submissionId: existing.submission_id,
        interviewRoundId: id,
        roundTypeLabel: roundTypeLabel(existing.round_type),
      };
      if (rescheduled) {
        await notify(tx, {
          type: 'interview_rescheduled',
          actorId: user.id,
          recipientIds: await interviewRoundParticipants(tx, id),
          context: {
            ...base,
            scheduledAtLabel: fmtWhen(finalPatch.scheduled_at),
            ics: interviewRoundInvite({
              round,
              title: `${roundTypeLabel(existing.round_type)}: ${ctx.candidateName || 'Candidate'} (${ctx.requirementTitle || 'Requirement'})`,
              description: `Interview rescheduled for ${ctx.candidateName || 'a candidate'}.`,
              organizer: { name: user.name, email: user.email },
              sequence: Math.floor(Date.now() / 1000),
            }),
          },
        });
      }
      if (feedbackTouched) {
        await notify(tx, {
          type: 'interview_feedback_submitted',
          actorId: user.id,
          recipientIds: await submissionParticipants(tx, existing.submission_id),
          context: { ...base, result: patch.result || round.result },
        });
      }
    }

    return { round };
  });
}

module.exports = {
  list,
  getById,
  create,
  update,
  changeStage,
  changeStageOverride,
  getHistory,
  addInterviewRound,
  updateInterviewRound,
  canManageInterviewRound,
  canRescheduleInterviewRound,
};
