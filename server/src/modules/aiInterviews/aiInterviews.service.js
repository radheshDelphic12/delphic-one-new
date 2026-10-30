const crypto = require('crypto');
const prisma = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { enqueue } = require('../../lib/email/outbox');
const { loadRequirementForSubmission } = require('../interviewTemplates/interviewTemplates.service');
const { AiUnavailableError } = require('./aiClient');
const logic = require('./aiInterviews.logic');

const OUTCOMES = ['pass', 'borderline', 'below_pass'];
const DEFAULTS = {
  is_enabled: true, question_count: 7, max_followups: 3, pass_percentage: 60, borderline_margin: 10,
  weight_knowledge: 50, weight_communication: 25, weight_depth: 25, extra_instructions: null, link_valid_days: 7,
};
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
  if (merged.weight_knowledge + merged.weight_communication + merged.weight_depth <= 0) return { error: 'weights_zero' };
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
      profile: { select: { name: true, email: true, current_designation: true, current_company: true, total_experience_years: true, primary_skills: true, secondary_skills: true, education: true } },
      seat: { select: { requirement: { select: { title: true, description: true, job_description: true, primary_tech_stack: true, secondary_tech_stack: true, experience_min: true, experience_max: true } } } },
    },
  });
  if (!sub) return null;
  const r = sub.seat?.requirement;
  const p = sub.profile;
  const min = r?.experience_min != null ? Number(r.experience_min) : null;
  const max = r?.experience_max != null ? Number(r.experience_max) : null;
  return {
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

// ---- team side ----
async function invite({ submissionId }, user) {
  const settings = await getSettings(user.org_id);
  if (!settings.is_enabled) return { error: 'disabled' };
  const ctx = await contextFor(submissionId);
  if (!ctx) return { error: 'not_found' };

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
  return { items, live_id: rows.find(isLive)?.id || null };
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
  await prisma.$transaction(async (tx) => {
    await tx.aiInterview.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id } });
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
    answered: transcript.filter((t) => t.role === 'candidate').length,
    transcript: transcript.map((t) => ({ role: t.role, kind: t.kind, text: t.text })),
    waiting_for_answer: Boolean(last && last.role === 'ai'),
    ai_enabled: Boolean(env.aiInterview.apiKey),
  };
}

async function openForCandidate(token) {
  const r = await load(token);
  return r.error ? r : { view: candidateView(r.a) };
}

async function startForCandidate(token, { consent }) {
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
    const { questions, usage } = await logic.generateQuestions(ctx, { ...settings });
    const first = { role: 'ai', kind: 'question', question_index: 1, text: questions[0].text, at: new Date().toISOString() };
    a = await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        status: 'started', started_at: new Date(), consented_at: new Date(), questions, transcript: [first],
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

async function finish(a, settings, ctx, transcript, tokens) {
  const base = { transcript, input_tokens: { increment: tokens.input }, output_tokens: { increment: tokens.output }, completed_at: new Date() };
  try {
    const scored = await logic.scoreInterview(ctx, settings, transcript);
    const { percent, scores } = logic.buildScores(scored.data, settings, transcript);
    return prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        ...base, status: 'completed', scores, score_percent: percent,
        outcome: logic.outcomeFor(percent, a.pass_percentage, settings.borderline_margin),
        input_tokens: { increment: tokens.input + scored.usage.input }, output_tokens: { increment: tokens.output + scored.usage.output },
      },
    });
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    // Never block the candidate: keep every answer and leave the call to a person.
    logger.warn({ err: err.message, id: a.id }, 'ai interview scoring failed; pending human review');
    return prisma.aiInterview.update({ where: { id: a.id }, data: { ...base, status: 'pending_review', outcome: 'pending_review' } });
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
    const now = () => new Date().toISOString();
    transcript.push({ role: 'candidate', kind: 'answer', question_index: last.question_index, text, at: now() });
    const tokens = { input: 0, output: 0 };

    // Save the answer first so a later AI failure can never lose it.
    let row = await prisma.aiInterview.update({ where: { id: a.id }, data: { transcript } });

    // One short follow-up at most per main question, and a capped number per interview.
    if (last.kind === 'question' && row.followups_used < settings.max_followups) {
      try {
        const f = await logic.decideFollowUp(ctx, settings, last.text, text);
        tokens.input += f.usage.input; tokens.output += f.usage.output;
        if (f.follow_up) {
          transcript.push({ role: 'ai', kind: 'follow_up', question_index: last.question_index, text: f.follow_up, at: now() });
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

    const nextIndex = last.question_index + 1;
    const next = questions.find((q) => q.id === nextIndex);
    if (next) {
      transcript.push({ role: 'ai', kind: 'question', question_index: nextIndex, text: next.text, at: now() });
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

module.exports = {
  OUTCOMES, DEFAULTS, getSettings, updateSettings,
  invite, list, review, override, remove,
  openForCandidate, startForCandidate, answerForCandidate,
};
