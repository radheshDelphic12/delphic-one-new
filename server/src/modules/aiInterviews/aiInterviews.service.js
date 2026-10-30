const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { enqueue } = require('../../lib/email/outbox');
const { notify } = require('../../lib/notifications');
const submissionsService = require('../submissions/submissions.service');
const { loadRequirementForSubmission } = require('../interviewTemplates/interviewTemplates.service');
const { AiUnavailableError } = require('./aiClient');
const logic = require('./aiInterviews.logic');

const OUTCOMES = ['pass', 'borderline', 'below_pass'];
// is_enabled starts false: the AI interview is an optional, separate link and nothing in the existing flow depends on it.
const DEFAULTS = {
  is_enabled: false, question_count: 7, max_followups: 3, pass_percentage: 60, borderline_margin: 10,
  weight_knowledge: 50, weight_communication: 25, weight_depth: 25, aptitude_enabled: true, aptitude_question_count: 4, weight_aptitude: 20,
  recording_enabled: false, recording_retention_days: 2, auto_reject: false, extra_instructions: null, link_valid_days: 7,
};
const RECORDING_DIR = () => path.join(env.uploadDir, 'ai-interviews');
const MAX_RECORDING_BYTES = 250 * 1024 * 1024;
const MAX_CHUNK_BYTES = 12 * 1024 * 1024;
const SETTING_KEYS = Object.keys(DEFAULTS);

const attemptLink = (token) => `${env.corsOrigin.replace(/\/$/, '')}/ai-interview/${token}`;
const isLive = (a) => !a.deleted_at && !a.superseded_at;
const adminOf = (user) => user?.role === 'admin' || Boolean(user?.is_superadmin);
const effectiveOutcome = (a) => a.override_outcome || a.outcome || null;

// ---- settings (admin editable; defaults until a row exists) ----
async function getSettings(orgId) {
  const row = orgId ? await prisma.aiInterviewSettings.findUnique({ where: { org_id: orgId } }) : null;
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, row ? row[k] : DEFAULTS[k]]));
}

async function updateSettings(orgId, patch, user) {
  if (!orgId) return { error: 'no_org' };
  const data = Object.fromEntries(Object.entries(patch).filter(([k, v]) => SETTING_KEYS.includes(k) && v !== undefined));
  const merged = { ...(await getSettings(orgId)), ...data };
  const weightTotal = merged.weight_knowledge + merged.weight_communication + merged.weight_depth + (merged.aptitude_enabled ? merged.weight_aptitude : 0);
  if (weightTotal <= 0) return { error: 'weights_zero' };
  await prisma.aiInterviewSettings.upsert({
    where: { org_id: orgId },
    create: { org_id: orgId, ...data, updated_by: user?.id || null },
    update: { ...data, updated_by: user?.id || null },
  });
  return { settings: await getSettings(orgId) };
}

async function audit(db, user, action, row, reason, extra = {}) {
  await db.auditLog.create({
    data: {
      actor_id: user.id, action, entity_type: 'ai_interview', entity_id: row.id,
      reason: reason || 'Changed by the team', org_id: user.org_id || null,
      snapshot: { submission_id: row.submission_id, status: row.status, outcome: row.outcome, score_percent: row.score_percent != null ? Number(row.score_percent) : null, ...extra },
    },
  });
}

// ---- views ----
function viewStatus(a) {
  if (a.superseded_at) return 'superseded';
  if (a.status === 'completed') return 'scored';
  if (a.status === 'pending_review') return 'pending_review';
  if (a.expires_at < new Date()) return 'expired';
  return a.status === 'started' ? 'in_progress' : 'not_opened';
}

function toTeamView(a, names = new Map()) {
  return {
    id: a.id,
    submission_id: a.submission_id,
    candidate_name: a.candidate_name,
    status: a.status,
    view_status: viewStatus(a),
    is_live: isLive(a),
    outcome: a.outcome,
    override_outcome: a.override_outcome,
    effective_outcome: effectiveOutcome(a),
    override_reason: a.override_reason,
    override_at: a.override_at,
    score_percent: a.score_percent != null ? Number(a.score_percent) : null,
    pass_percentage: a.pass_percentage,
    invited_at: a.invited_at,
    created_by_name: names.get(a.invited_by) || null,
    expires_at: a.expires_at,
    completed_at: a.completed_at,
    recording_on: a.recording_on,
    has_recording: filesOf(a).length > 0 && !a.recording_deleted_at,
    recording_parts: a.recording_deleted_at ? [] : filesOf(a).map((p) => ({ bytes: p.bytes })),
    auto_rejected_at: a.auto_rejected_at,
    auto_reject_note: a.auto_reject_note,
    recording_expires_at: a.recording_expires_at,
    recording_deleted: Boolean(a.recording_deleted_at),
    link: a.status === 'invited' || a.status === 'started' ? (a.superseded_at ? null : attemptLink(a.token)) : null,
  };
}

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

// ---- context handed to the AI (requirement JD + the candidate's profile) ----
async function contextFor(submissionId) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      profile_id: true,
      profile: { select: { name: true, email: true, current_designation: true, current_company: true, total_experience_years: true, primary_skills: true, secondary_skills: true, education: true } },
      seat: { select: { requirement: { select: { id: true, ai_interview_enabled: true, title: true, description: true, job_description: true, primary_tech_stack: true, secondary_tech_stack: true, experience_min: true, experience_max: true } } } },
    },
  });
  if (!sub) return null;
  const r = sub.seat?.requirement;
  const p = sub.profile;
  const min = r?.experience_min != null ? Number(r.experience_min) : null;
  const max = r?.experience_max != null ? Number(r.experience_max) : null;
  return {
    profile_id: sub.profile_id,
    requirement_id: r?.id || null,
    requirement_switch: r?.ai_interview_enabled ?? null,
    candidate_name: p?.name || 'Candidate',
    candidate_email: p?.email || null,
    role_title: r?.title || null,
    job_description: [r?.description, r?.job_description].filter(Boolean).join('\n'),
    primary_skills: r?.primary_tech_stack || [],
    secondary_skills: r?.secondary_tech_stack || [],
    experience_range: min != null || max != null ? `${min ?? 0} to ${max ?? 'any'} years` : null,
    candidate_designation: p?.current_designation || null,
    candidate_company: p?.current_company || null,
    candidate_experience: p?.total_experience_years != null ? Number(p.total_experience_years) : null,
    candidate_skills: [...(p?.primary_skills || []), ...(p?.secondary_skills || [])],
    candidate_education: p?.education ? JSON.stringify(p.education) : null,
  };
}

// The candidate's CV for the AI, when a PDF is stored for the profile (newest "Resume" first). A missing, huge or non-PDF file
// just means the AI works from the profile fields alone.
const MAX_RESUME_BYTES = 4 * 1024 * 1024;
async function loadResume(profileId) {
  if (!profileId) return null;
  const docs = await prisma.document.findMany({ where: { entity_type: 'profile', entity_id: profileId }, orderBy: { uploaded_at: 'desc' }, take: 10 });
  const pdfs = docs.filter((d) => /\.pdf$/i.test(d.file_url || ''));
  const doc = pdfs.find((d) => /resume|cv/i.test(d.label)) || pdfs[0];
  if (!doc) return null;
  try {
    const file = path.resolve(env.uploadDir, path.basename(doc.file_url));
    const stat = await fs.promises.stat(file);
    if (stat.size > MAX_RESUME_BYTES) return null;
    return { base64: (await fs.promises.readFile(file)).toString('base64'), name: doc.label };
  } catch {
    return null;
  }
}

// ---- team side ----
async function invite({ submissionId }, user) {
  const settings = await getSettings(user.org_id);
  if (!settings.is_enabled) return { error: 'disabled' };
  const ctx = await contextFor(submissionId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.requirement_switch === false) return { error: 'requirement_off' };

  const requirement = await loadRequirementForSubmission(prisma, submissionId);
  const roundId = requirement?.interview_template?.rounds?.find((r) => r.kind === 'screening_test')?.id || null;

  const existing = await prisma.aiInterview.findMany({ where: { submission_id: submissionId, deleted_at: null } });
  const live = existing.filter(isLive);
  if (live.some((a) => a.status === 'completed' || a.status === 'pending_review')) return { error: 'already_completed' };
  if (live.some((a) => a.status === 'started')) return { error: 'in_progress' };

  const token = crypto.randomBytes(24).toString('hex');
  const row = await prisma.$transaction(async (tx) => {
    if (live.length) await tx.aiInterview.updateMany({ where: { id: { in: live.map((a) => a.id) } }, data: { superseded_at: new Date() } });
    return tx.aiInterview.create({
      data: {
        token, submission_id: submissionId, org_id: user.org_id || null, template_round_id: roundId,
        candidate_name: ctx.candidate_name, candidate_email: ctx.candidate_email, role_title: ctx.role_title,
        pass_percentage: settings.pass_percentage, invited_by: user.id,
        expires_at: new Date(Date.now() + settings.link_valid_days * 86400000),
      },
    });
  });

  const link = attemptLink(token);
  const org = user.org_id ? await prisma.org.findUnique({ where: { id: user.org_id }, select: { assessment_email_candidate: true } }) : null;
  if (org?.assessment_email_candidate && row.candidate_email) {
    await enqueue(prisma, {
      kind: 'ai_interview_invite',
      to: { email: row.candidate_email, name: row.candidate_name },
      subject: `Your interview for ${ctx.role_title || 'the role'}`,
      text: `Hi ${row.candidate_name},\n\nPlease complete this short online interview: ${link}\n\nIt is a conversation with an AI interviewer; you can speak or type your answers, and it takes about 15 to 20 minutes. The link is valid for ${settings.link_valid_days} days and can be used once.\n\nThank you,\nDelphic Team`,
    });
  }
  return { interview: toTeamView(row), link, superseded: live.length };
}

async function list({ submissionId }) {
  const rows = await prisma.aiInterview.findMany({ where: { submission_id: submissionId, deleted_at: null }, orderBy: { invited_at: 'desc' } });
  const names = await userNames(rows.map((r) => r.invited_by));
  const items = rows.map((r) => toTeamView(r, names));
  const ctx = await contextFor(submissionId);
  return { items, live_id: rows.find(isLive)?.id || null, requirement_id: ctx?.requirement_id || null, requirement_switch: ctx?.requirement_switch ?? null };
}

async function review(id) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  if (!['completed', 'pending_review'].includes(a.status)) return { error: 'not_finished' };
  const names = await userNames([a.invited_by, a.override_by]);
  return {
    review: {
      ...toTeamView(a, names),
      transcript: a.transcript,
      scores: a.scores,
      override_by_name: names.get(a.override_by) || null,
    },
  };
}

// A person's decision on top of the AI result; recorded in the audit log. Any team member who can see the candidate may set it.
async function override(id, { outcome, reason }, user) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  if (!['completed', 'pending_review'].includes(a.status)) return { error: 'not_finished' };
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.aiInterview.update({
      where: { id }, data: { override_outcome: outcome, override_reason: reason, override_by: user.id, override_at: new Date() },
    });
    await audit(tx, user, 'override_ai_interview', updated, reason, { ai_outcome: a.outcome, override_outcome: outcome });
    return updated;
  });
  return { interview: toTeamView(row) };
}

async function remove(id, { reason }, user) {
  if (!adminOf(user)) return { error: 'forbidden' };
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  await removeRecordingFiles(a);
  await prisma.$transaction(async (tx) => {
    await tx.aiInterview.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id, recording_path: null, recording_files: [], recording_deleted_at: filesOf(a).length ? new Date() : a.recording_deleted_at } });
    await audit(tx, user, 'delete_ai_interview', a, reason || 'Deleted by admin');
  });
  return { deleted: true };
}

// ---- candidate side (no login; the token is the credential) ----
const busy = new Set(); // one AI turn per link at a time (a double click must not ask two questions)

async function load(token) {
  const a = await prisma.aiInterview.findUnique({ where: { token } });
  if (!a || a.deleted_at) return { error: 'not_found' };
  if (a.superseded_at) return { error: 'superseded' };
  if (a.status === 'completed' || a.status === 'pending_review') return { error: 'already_submitted' };
  if (a.expires_at < new Date()) return { error: 'expired' };
  return { a };
}

// What the candidate may see: the conversation so far and the question waiting for an answer. Never scores or rubric.
function candidateView(a) {
  const transcript = Array.isArray(a.transcript) ? a.transcript : [];
  const questions = Array.isArray(a.questions) ? a.questions : [];
  const last = transcript[transcript.length - 1];
  return {
    candidate_name: a.candidate_name,
    role_title: a.role_title,
    status: a.status,
    total_questions: questions.length || null,
    section: last && last.role === 'ai' ? last.section || 'role' : null,
    recording_on: a.recording_on,
    recording_parts: filesOf(a).length,
    answered: transcript.filter((t) => t.role === 'candidate').length,
    transcript: transcript.map((t) => ({ role: t.role, kind: t.kind, text: t.text })),
    waiting_for_answer: Boolean(last && last.role === 'ai'),
    ai_enabled: Boolean(env.aiInterview.apiKey),
  };
}

async function openForCandidate(token) {
  const r = await load(token);
  if (r.error) return r;
  // before the start, tell the page whether this company records interviews, so it can ask for consent up front
  const settings = await getSettings(r.a.org_id);
  return { view: { ...candidateView(r.a), recording_offered: Boolean(settings.recording_enabled), recording_days: settings.recording_retention_days } };
}

async function startForCandidate(token, { consent, recording_consent: recordingConsent }) {
  const r = await load(token);
  if (r.error) return r;
  let a = r.a;
  if (a.status === 'started') return { view: candidateView(a) }; // reopened after a closed tab: carry on where it stopped
  if (!consent) return { error: 'consent_required' };
  if (busy.has(a.id)) return { error: 'busy' };
  busy.add(a.id);
  try {
    const settings = await getSettings(a.org_id);
    const ctx = await contextFor(a.submission_id);
    ctx.resume = await loadResume(ctx.profile_id);
    const { questions, usage } = await logic.generateQuestions(ctx, { ...settings });
    const first = { role: 'ai', kind: 'question', section: questions[0].kind, question_index: 1, text: questions[0].text, at: new Date().toISOString() };
    a = await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        status: 'started', started_at: new Date(), consented_at: new Date(), questions, transcript: [first],
        // recorded only when the company has recording on AND this candidate agreed; declining never blocks the interview
        recording_on: Boolean(settings.recording_enabled && recordingConsent),
        input_tokens: { increment: usage.input }, output_tokens: { increment: usage.output },
      },
    });
    return { view: candidateView(a) };
  } catch (err) {
    if (err instanceof AiUnavailableError) { logger.warn({ err: err.message }, 'ai interview could not start'); return { error: 'ai_unavailable' }; }
    throw err;
  } finally {
    busy.delete(a.id);
  }
}

// Tells whoever sent the interview (and the admins) that a result is in. Never throws; a notification problem must not lose a result.
async function announceResult(row, ctx) {
  try {
    const outcome = effectiveOutcome(row);
    await notify(prisma, {
      type: 'ai_interview_completed',
      recipientIds: [row.invited_by].filter(Boolean),
      context: {
        submissionId: row.submission_id, candidateName: row.candidate_name, requirementTitle: ctx.role_title,
        score: row.score_percent != null ? Number(row.score_percent) : null, outcome, passPercentage: row.pass_percentage,
      },
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'ai interview notification failed');
  }
}

// With the company's auto-reject switch on, a below-pass result moves the candidate to Rejected with the AI's reason, but only
// while they are still in sourcing / screening (before any client has seen them). Anything else is left for a person.
const AUTO_REJECT_STAGES = ['sourced', 'internal_screening'];
async function maybeAutoReject(row, settings) {
  if (!settings.auto_reject || row.outcome !== 'below_pass') return row;
  const note = async (text, rejectedAt = null) => prisma.aiInterview.update({ where: { id: row.id }, data: { auto_reject_note: text, auto_rejected_at: rejectedAt } });
  try {
    const submission = await prisma.submission.findUnique({ where: { id: row.submission_id }, select: { stage: true, is_locked: true } });
    if (!submission || submission.is_locked || !AUTO_REJECT_STAGES.includes(submission.stage)) {
      return note(`Not rejected automatically: the candidate is already at "${submission?.stage || 'unknown'}". A person should decide.`);
    }
    const inviter = row.invited_by ? await prisma.user.findUnique({ where: { id: row.invited_by }, select: { id: true, name: true, role: true, is_superadmin: true } }) : null;
    if (!inviter) return note('Not rejected automatically: the person who sent the interview no longer exists.');
    const reason = `AI interview: ${row.scores?.decision_reason || `scored ${Number(row.score_percent)}% against the ${row.pass_percentage}% pass mark`}`.slice(0, 900);
    const res = await submissionsService.changeStage(row.submission_id, { to_stage: 'rejected', rejection_reason: reason }, inviter);
    if (res.error) return note(`Not rejected automatically (${res.error}). A person should decide.`);
    return note('Rejected automatically after a below-pass AI interview. An admin can reactivate the candidate.', new Date());
  } catch (err) {
    logger.warn({ err: err.message, id: row.id }, 'ai interview auto-reject failed');
    return row;
  }
}

async function finish(a, settings, ctx, transcript, tokens) {
  const questions = Array.isArray(a.questions) ? a.questions : [];
  // the rubric of THIS interview: the pass mark it was sent with, and aptitude only if it actually had aptitude questions
  const rubric = { ...settings, pass_percentage: a.pass_percentage, aptitude_enabled: questions.some((q) => q.kind === 'aptitude') };
  const retention = a.recording_on ? { recording_expires_at: new Date(Date.now() + settings.recording_retention_days * 86400000) } : {};
  const base = { transcript, input_tokens: { increment: tokens.input }, output_tokens: { increment: tokens.output }, completed_at: new Date(), ...retention };
  try {
    const scored = await logic.scoreInterview(ctx, rubric, transcript, questions);
    const { percent, outcome, scores } = logic.buildScores(scored.data, rubric, transcript);
    let row = await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        ...base, status: 'completed', scores, score_percent: percent, outcome,
        input_tokens: { increment: tokens.input + scored.usage.input }, output_tokens: { increment: tokens.output + scored.usage.output },
      },
    });
    row = await maybeAutoReject(row, settings);
    await announceResult(row, ctx);
    return row;
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    // Never block the candidate: keep every answer and leave the call to a person.
    logger.warn({ err: err.message, id: a.id }, 'ai interview scoring failed; pending human review');
    const row = await prisma.aiInterview.update({ where: { id: a.id }, data: { ...base, status: 'pending_review', outcome: 'pending_review' } });
    await announceResult(row, ctx);
    return row;
  }
}

async function answerForCandidate(token, rawText) {
  const r = await load(token);
  if (r.error) return r;
  const a = r.a;
  if (a.status !== 'started') return { error: 'not_started' };
  const text = logic.cleanAnswer(rawText);
  if (text.length < 2) return { error: 'empty_answer' };
  const transcript = Array.isArray(a.transcript) ? [...a.transcript] : [];
  const last = transcript[transcript.length - 1];
  if (!last || last.role !== 'ai') return { error: 'not_waiting' };
  if (busy.has(a.id)) return { error: 'busy' };
  busy.add(a.id);
  try {
    const settings = await getSettings(a.org_id);
    const ctx = await contextFor(a.submission_id);
    const questions = Array.isArray(a.questions) ? a.questions : [];
    const current = questions.find((q) => q.id === last.question_index);
    const now = () => new Date().toISOString();
    transcript.push({ role: 'candidate', kind: 'answer', section: last.section, question_index: last.question_index, text, at: now() });
    const tokens = { input: 0, output: 0 };

    // Save the answer first so a later AI failure can never lose it.
    let row = await prisma.aiInterview.update({ where: { id: a.id }, data: { transcript } });

    // One short follow-up at most per role question (never for aptitude), and a capped number per interview.
    if (last.kind === 'question' && current?.kind === 'role' && row.followups_used < settings.max_followups) {
      try {
        const f = await logic.decideFollowUp(ctx, settings, last.text, text);
        tokens.input += f.usage.input; tokens.output += f.usage.output;
        if (f.follow_up) {
          transcript.push({ role: 'ai', kind: 'follow_up', section: 'role', question_index: last.question_index, text: f.follow_up, at: now() });
          row = await prisma.aiInterview.update({
            where: { id: a.id },
            data: { transcript, followups_used: { increment: 1 }, input_tokens: { increment: tokens.input }, output_tokens: { increment: tokens.output } },
          });
          return { view: candidateView(row) };
        }
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err; // a failed follow-up just moves on to the next question
      }
    }

    const next = questions.find((q) => q.id === last.question_index + 1);
    if (next) {
      transcript.push({ role: 'ai', kind: 'question', section: next.kind, question_index: next.id, text: next.text, at: now() });
      row = await prisma.aiInterview.update({
        where: { id: a.id }, data: { transcript, input_tokens: { increment: tokens.input }, output_tokens: { increment: tokens.output } },
      });
      return { view: candidateView(row), done: false };
    }
    const done = await finish(a, settings, ctx, transcript, tokens);
    return { view: candidateView(done), done: true };
  } finally {
    busy.delete(a.id);
  }
}

// Admin / recruiter / sales: turn the AI interview off (false) or back to "follow the company" (null) for one requirement.
async function setRequirementSwitch(requirementId, value, user) {
  const req = await prisma.requirement.findUnique({ where: { id: requirementId }, select: { id: true, ai_interview_enabled: true } });
  if (!req) return { error: 'not_found' };
  await prisma.$transaction(async (tx) => {
    await tx.requirement.update({ where: { id: requirementId }, data: { ai_interview_enabled: value } });
    await tx.auditLog.create({
      data: {
        actor_id: user.id, action: 'set_ai_interview_switch', entity_type: 'requirement', entity_id: requirementId,
        reason: value === false ? 'AI interview turned off for this requirement' : 'AI interview follows the company setting', org_id: user.org_id || null,
        snapshot: { before: req.ai_interview_enabled, after: value },
      },
    });
  });
  return { requirement_switch: value };
}

// Counts for Hiring setup: how many were sent, how they went and how often a person overrode the AI. Per company, optional date range.
async function analytics({ from, to }, user) {
  const where = { deleted_at: null, superseded_at: null, org_id: user.org_id || null };
  if (from || to) where.invited_at = { ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}) };
  const rows = await prisma.aiInterview.findMany({
    where,
    select: { status: true, outcome: true, override_outcome: true, score_percent: true, auto_rejected_at: true, input_tokens: true, output_tokens: true, started_at: true, completed_at: true },
  });
  const finished = rows.filter((r) => r.status === 'completed');
  const scores = finished.map((r) => Number(r.score_percent)).filter((n) => Number.isFinite(n));
  const minutes = rows.filter((r) => r.started_at && r.completed_at).map((r) => (r.completed_at - r.started_at) / 60000);
  const count = (fn) => rows.filter(fn).length;
  return {
    sent: rows.length,
    not_started: count((r) => r.status === 'invited'),
    in_progress: count((r) => r.status === 'started'),
    completed: finished.length,
    pending_review: count((r) => r.status === 'pending_review'),
    pass: count((r) => r.outcome === 'pass'),
    borderline: count((r) => r.outcome === 'borderline'),
    below_pass: count((r) => r.outcome === 'below_pass'),
    overridden: count((r) => Boolean(r.override_outcome)),
    auto_rejected: count((r) => Boolean(r.auto_rejected_at)),
    average_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    average_minutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    tokens: rows.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0),
  };
}

// ---- recording (optional; audio + video; deleted automatically after the retention days) ----
// A candidate who closes the tab and comes back records a new part: the browser starts a fresh file, so each session is its own file.
const RECORDING_TYPES = { 'video/webm': 'webm', 'audio/webm': 'webm', 'video/mp4': 'mp4' };
const recBusy = new Set();
const recordingFilePath = (name) => path.resolve(RECORDING_DIR(), path.basename(name));
const filesOf = (a) => (Array.isArray(a.recording_files) ? a.recording_files : []);

// The browser sends each part in order, one chunk at a time (?part=0&seq=0,1,2...). A chunk that arrives twice (a retry) is accepted
// and ignored; the next part starts at seq 0 once the previous one exists.
async function saveRecordingChunk(token, { part = 0, seq, buffer, mime }) {
  const a = await prisma.aiInterview.findUnique({ where: { token } });
  if (!a || a.deleted_at || a.superseded_at || !a.recording_on || a.recording_deleted_at) return { error: 'not_found' };
  // allowed while the interview runs and for a few minutes after it, so the last chunk can still be flushed
  const open = a.status === 'started' || (a.completed_at && Date.now() - a.completed_at.getTime() < 10 * 60000);
  if (!open) return { error: 'already_submitted' };
  const type = String(mime || '').split(';')[0].trim();
  const ext = RECORDING_TYPES[type];
  if (!ext) return { error: 'bad_recording' };
  if (!buffer || !buffer.length || buffer.length > MAX_CHUNK_BYTES) return { error: 'bad_recording' };
  const files = filesOf(a);
  if (part > files.length || part > 20) return { error: 'recording_gap' };
  const current = files[part];
  if (current && seq < current.chunks) return { saved: true, duplicate: true };
  if (seq !== (current ? current.chunks : 0)) return { error: 'recording_gap' };
  if (a.recording_bytes + buffer.length > MAX_RECORDING_BYTES) return { error: 'recording_too_big' };
  if (recBusy.has(a.id)) return { error: 'busy' };
  recBusy.add(a.id);
  try {
    const settings = await getSettings(a.org_id);
    const name = current ? current.name : (part === 0 ? `${a.id}.${ext}` : `${a.id}-p${part + 1}.${ext}`);
    await fs.promises.mkdir(RECORDING_DIR(), { recursive: true });
    await fs.promises.appendFile(recordingFilePath(name), buffer);
    const next = [...files];
    next[part] = { name, mime: type, bytes: (current?.bytes || 0) + buffer.length, chunks: (current?.chunks || 0) + 1 };
    await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        recording_files: next, recording_path: next[0].name, recording_mime: next[0].mime,
        recording_bytes: { increment: buffer.length }, recording_chunks: { increment: 1 },
        recording_expires_at: new Date(Date.now() + settings.recording_retention_days * 86400000),
      },
    });
    return { saved: true };
  } finally {
    recBusy.delete(a.id);
  }
}

// For the team: one stored part, while it exists. Authorization is done by the route.
async function recordingFor(id, part = 0) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  if (a.recording_deleted_at) return { error: 'recording_expired' };
  const entry = filesOf(a)[part];
  if (!entry) return { error: 'no_recording' };
  const file = recordingFilePath(entry.name);
  if (!fs.existsSync(file)) return { error: 'no_recording' };
  const label = a.candidate_name.replace(/[^a-z0-9]+/gi, '-');
  return { file, mime: entry.mime || 'video/webm', name: `ai-interview-${label}${filesOf(a).length > 1 ? `-part${part + 1}` : ''}.${entry.name.split('.').pop()}` };
}

const removeRecordingFiles = (a) => Promise.all(filesOf(a).map((f) => fs.promises.unlink(recordingFilePath(f.name)).catch(() => {})));

// Deletes the files whose time is up (called by the hourly job); the interview, transcript and scores stay.
async function purgeExpiredRecordings(now = new Date()) {
  const due = await prisma.aiInterview.findMany({
    where: { recording_path: { not: null }, recording_deleted_at: null, recording_expires_at: { lt: now } },
  });
  for (const a of due) {
    await removeRecordingFiles(a);
    await prisma.aiInterview.update({ where: { id: a.id }, data: { recording_path: null, recording_files: [], recording_deleted_at: now } });
  }
  return { purged: due.length };
}

module.exports = {
  OUTCOMES, DEFAULTS, getSettings, updateSettings,
  invite, list, review, override, remove, setRequirementSwitch, analytics,
  openForCandidate, startForCandidate, answerForCandidate,
  saveRecordingChunk, recordingFor, purgeExpiredRecordings,
};
