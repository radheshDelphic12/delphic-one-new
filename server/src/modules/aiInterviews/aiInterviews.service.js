const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { enqueue } = require('../../lib/email/outbox');
const { loadRequirementForSubmission } = require('../interviewTemplates/interviewTemplates.service');
const { AiUnavailableError } = require('./aiClient');
const logic = require('./aiInterviews.logic');

const OUTCOMES = ['pass', 'borderline', 'below_pass'];
// is_enabled starts false: the AI interview is an optional, separate link and nothing in the existing flow depends on it.
const DEFAULTS = {
  is_enabled: false, question_count: 7, max_followups: 3, pass_percentage: 60, borderline_margin: 10,
  weight_knowledge: 50, weight_communication: 25, weight_depth: 25, aptitude_enabled: true, aptitude_question_count: 4, weight_aptitude: 20,
  recording_enabled: false, recording_retention_days: 2, extra_instructions: null, link_valid_days: 7,
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
    has_recording: Boolean(a.recording_path) && !a.recording_deleted_at,
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
  if (a.recording_path) await fs.promises.unlink(recordingFilePath(a.recording_path)).catch(() => {});
  await prisma.$transaction(async (tx) => {
    await tx.aiInterview.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: user.id, recording_path: null, recording_deleted_at: a.recording_path ? new Date() : a.recording_deleted_at } });
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

async function finish(a, settings, ctx, transcript, tokens) {
  const questions = Array.isArray(a.questions) ? a.questions : [];
  // the rubric of THIS interview: the pass mark it was sent with, and aptitude only if it actually had aptitude questions
  const rubric = { ...settings, pass_percentage: a.pass_percentage, aptitude_enabled: questions.some((q) => q.kind === 'aptitude') };
  const retention = a.recording_on ? { recording_expires_at: new Date(Date.now() + settings.recording_retention_days * 86400000) } : {};
  const base = { transcript, input_tokens: { increment: tokens.input }, output_tokens: { increment: tokens.output }, completed_at: new Date(), ...retention };
  try {
    const scored = await logic.scoreInterview(ctx, rubric, transcript, questions);
    const { percent, outcome, scores } = logic.buildScores(scored.data, rubric, transcript);
    return prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        ...base, status: 'completed', scores, score_percent: percent, outcome,
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

// ---- recording (optional; audio + video; deleted automatically after the retention days) ----
const RECORDING_TYPES = { 'video/webm': 'webm', 'audio/webm': 'webm', 'video/mp4': 'mp4' };
const recBusy = new Set();
const recordingFilePath = (name) => path.resolve(RECORDING_DIR(), path.basename(name));

// The browser sends the recording in order, one chunk at a time. A chunk that arrives twice (a retry) is accepted and ignored.
async function saveRecordingChunk(token, { seq, buffer, mime }) {
  const a = await prisma.aiInterview.findUnique({ where: { token } });
  if (!a || a.deleted_at || a.superseded_at || !a.recording_on || a.recording_deleted_at) return { error: 'not_found' };
  // allowed while the interview runs and for a few minutes after it, so the last chunk can still be flushed
  const open = a.status === 'started' || (a.completed_at && Date.now() - a.completed_at.getTime() < 10 * 60000);
  if (!open) return { error: 'already_submitted' };
  const ext = RECORDING_TYPES[String(mime || '').split(';')[0].trim()];
  if (!ext) return { error: 'bad_recording' };
  if (!buffer || !buffer.length || buffer.length > MAX_CHUNK_BYTES) return { error: 'bad_recording' };
  if (seq < a.recording_chunks) return { saved: true, duplicate: true };
  if (seq > a.recording_chunks) return { error: 'recording_gap' };
  if (a.recording_bytes + buffer.length > MAX_RECORDING_BYTES) return { error: 'recording_too_big' };
  if (recBusy.has(a.id)) return { error: 'busy' };
  recBusy.add(a.id);
  try {
    const settings = await getSettings(a.org_id);
    const name = a.recording_path || `${a.id}.${ext}`;
    await fs.promises.mkdir(RECORDING_DIR(), { recursive: true });
    await fs.promises.appendFile(recordingFilePath(name), buffer);
    await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        recording_path: name, recording_mime: mime.split(';')[0].trim(), recording_bytes: { increment: buffer.length }, recording_chunks: { increment: 1 },
        recording_expires_at: new Date(Date.now() + settings.recording_retention_days * 86400000),
      },
    });
    return { saved: true };
  } finally {
    recBusy.delete(a.id);
  }
}

// For the team: the stored file, while it exists. Authorization is done by the route.
async function recordingFor(id) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  if (a.recording_deleted_at) return { error: 'recording_expired' };
  if (!a.recording_path) return { error: 'no_recording' };
  const file = recordingFilePath(a.recording_path);
  if (!fs.existsSync(file)) return { error: 'no_recording' };
  return { file, mime: a.recording_mime || 'video/webm', name: `ai-interview-${a.candidate_name.replace(/[^a-z0-9]+/gi, '-')}.${a.recording_path.split('.').pop()}` };
}

// Deletes the files whose time is up (called by the hourly job); the interview, transcript and scores stay.
async function purgeExpiredRecordings(now = new Date()) {
  const due = await prisma.aiInterview.findMany({
    where: { recording_path: { not: null }, recording_deleted_at: null, recording_expires_at: { lt: now } },
    select: { id: true, recording_path: true },
  });
  for (const a of due) {
    await fs.promises.unlink(recordingFilePath(a.recording_path)).catch(() => {});
    await prisma.aiInterview.update({ where: { id: a.id }, data: { recording_path: null, recording_deleted_at: now } });
  }
  return { purged: due.length };
}

module.exports = {
  OUTCOMES, DEFAULTS, getSettings, updateSettings,
  invite, list, review, override, remove,
  openForCandidate, startForCandidate, answerForCandidate,
  saveRecordingChunk, recordingFor, purgeExpiredRecordings,
};
