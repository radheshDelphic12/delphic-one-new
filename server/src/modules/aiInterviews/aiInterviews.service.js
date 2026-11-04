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
  is_enabled: false, question_count: 12, max_followups: 3, pass_percentage: 60, borderline_margin: 10,
  weight_knowledge: 30, weight_communication: 20, weight_depth: 15, aptitude_enabled: true, aptitude_question_count: 12, weight_aptitude: 10,
  recording_enabled: false, recording_retention_days: 2, auto_reject: false, extra_instructions: null, link_valid_days: 7,
  answer_time_seconds: 180, max_tab_switches: 3,
  weight_problem_solving: 15, weight_experience_fit: 10, use_reference_sites: true, reference_sites: 'w3schools.com,javatpoint.com', recording_viewer_ids: [],
};
const TAB_EVENTS = ['tab_hidden', 'window_blur']; // leaving the interview page; these count towards max_tab_switches
const OTHER_EVENTS = ['copy', 'cut', 'paste', 'context_menu', 'blocked_key', 'camera_off'];
const EVENT_TYPES = [...TAB_EVENTS, ...OTHER_EVENTS];
const eventsOf = (a) => (Array.isArray(a.integrity_events) ? a.integrity_events : []);
const tabSwitchesOf = (a) => eventsOf(a).filter((e) => TAB_EVENTS.includes(e.type)).length;
// { tab_switches, copy_paste, camera_off, total } for the team and for the scorer
function integritySummary(a) {
  const ev = eventsOf(a);
  const n = (types) => ev.filter((e) => types.includes(e.type)).length;
  return { tab_switches: n(TAB_EVENTS), copy_paste: n(['copy', 'cut', 'paste', 'context_menu', 'blocked_key']), camera_off: n(['camera_off']), total: ev.length };
}
const RECORDING_DIR = () => path.join(env.uploadDir, 'ai-interviews');
const MAX_RECORDING_BYTES = 250 * 1024 * 1024;
const MAX_CHUNK_BYTES = 12 * 1024 * 1024;
const SETTING_KEYS = Object.keys(DEFAULTS);

const attemptLink = (token) => `${env.corsOrigin.replace(/\/$/, '')}/ai-interview/${token}`;
const isLive = (a) => !a.deleted_at && !a.superseded_at;
const adminOf = (user) => user?.role === 'admin' || Boolean(user?.is_superadmin);
// The recording is for admins, the people an admin named in the settings (all recordings), and the team member who sent that candidate's link.
const canSeeRecording = (a, user, seesAll = false) => Boolean(user) && (seesAll || adminOf(user) || (a.invited_by != null && a.invited_by === user.id));
async function seesAllRecordings(user) {
  if (!user) return false;
  if (adminOf(user)) return true;
  if (!user.org_id) return false;
  return (await getSettings(user.org_id)).recording_viewer_ids.includes(user.id);
}
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
  const weightTotal = merged.weight_knowledge + merged.weight_communication + merged.weight_depth + merged.weight_problem_solving + merged.weight_experience_fit + (merged.aptitude_enabled ? merged.weight_aptitude : 0);
  if (weightTotal <= 0) return { error: 'weights_zero' };
  if (data.reference_sites !== undefined) {
    // stored as a clean, comma separated list of bare domains; a typed list with nothing usable in it is refused
    const sites = logic.normaliseSites(data.reference_sites);
    if (String(data.reference_sites).trim() && !sites.length) return { error: 'bad_sites' };
    data.reference_sites = sites.join(',');
  }
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

function toTeamView(a, names = new Map(), user = null, seesAll = false) {
  const seeRecording = canSeeRecording(a, user, seesAll);
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
    integrity: integritySummary(a),
    has_recording: seeRecording && filesOf(a).length > 0 && !a.recording_deleted_at,
    recording_parts: !seeRecording || a.recording_deleted_at ? [] : filesOf(a).map((p) => ({ bytes: p.bytes })),
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
    experience_min: min,
    experience_max: max,
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
async function invite({ submissionId, restart = false, retake = false }, user) {
  const settings = await getSettings(user.org_id);
  if (!settings.is_enabled) return { error: 'disabled' };
  const ctx = await contextFor(submissionId);
  if (!ctx) return { error: 'not_found' };
  if (ctx.requirement_switch === false) return { error: 'requirement_off' };

  const requirement = await loadRequirementForSubmission(prisma, submissionId);
  const roundId = requirement?.interview_template?.rounds?.find((r) => r.kind === 'screening_test')?.id || null;

  const existing = await prisma.aiInterview.findMany({ where: { submission_id: submissionId, deleted_at: null } });
  const live = existing.filter(isLive);
  // A finished interview keeps its result; a new link is sent only when the sender asks for a re-take (the old result stays in the history).
  if (live.some((a) => a.status === 'completed' || a.status === 'pending_review') && !retake) return { error: 'already_completed' };
  // a candidate in the middle of the interview keeps it, unless the sender chooses to restart it with a new link
  if (live.some((a) => a.status === 'started') && !restart) return { error: 'in_progress' };

  const token = crypto.randomBytes(24).toString('hex');
  const row = await prisma.$transaction(async (tx) => {
    if (live.length) await tx.aiInterview.updateMany({ where: { id: { in: live.map((a) => a.id) } }, data: { superseded_at: new Date() } });
    for (const a of live.filter((x) => x.status === 'started')) await audit(tx, user, 'restart_ai_interview', a, 'A new link replaced an interview in progress');
    for (const a of live.filter((x) => x.status === 'completed' || x.status === 'pending_review')) await audit(tx, user, 'retake_ai_interview', a, 'A new link was sent after the interview was finished (re-take)');
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
      text: `Hi ${row.candidate_name},\n\nPlease complete this short online interview: ${link}\n\nIt is a conversation with an AI interviewer; you answer by speaking, except the aptitude / numerical questions which are typed (a microphone is required; use Chrome or Edge), and it takes about 15 to 20 minutes. The link is valid for ${settings.link_valid_days} days and can be used once.\n\nThank you,\nDelphic Team`,
    });
  }
  return { interview: toTeamView(row, new Map(), user, await seesAllRecordings(user)), link, superseded: live.length };
}

async function list({ submissionId }, user) {
  const rows = await prisma.aiInterview.findMany({ where: { submission_id: submissionId, deleted_at: null }, orderBy: { invited_at: 'desc' } });
  const names = await userNames(rows.map((r) => r.invited_by));
  const seesAll = await seesAllRecordings(user);
  const items = rows.map((r) => toTeamView(r, names, user, seesAll));
  const ctx = await contextFor(submissionId);
  return { items, live_id: rows.find(isLive)?.id || null, requirement_id: ctx?.requirement_id || null, requirement_switch: ctx?.requirement_switch ?? null };
}

async function review(id, user) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  if (!['completed', 'pending_review'].includes(a.status)) return { error: 'not_finished' };
  const names = await userNames([a.invited_by, a.override_by]);
  return {
    review: {
      ...toTeamView(a, names, user, await seesAllRecordings(user)),
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
  return { interview: toTeamView(row, new Map(), user, await seesAllRecordings(user)) };
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
function candidateView(a, settings = null) {
  const transcript = Array.isArray(a.transcript) ? a.transcript : [];
  const questions = Array.isArray(a.questions) ? a.questions : [];
  const last = transcript[transcript.length - 1];
  return {
    // timer: the page counts down from the moment the question was asked (server clock, so a reload cannot reset it)
    answer_seconds: settings ? settings.answer_time_seconds : null,
    question_asked_at: last && last.role === 'ai' ? last.at || null : null,
    server_now: new Date().toISOString(),
    max_tab_switches: settings ? settings.max_tab_switches : null,
    tab_switches: tabSwitchesOf(a),
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

const NO_ANSWER_TEXT = '[No answer - time ran out]';
const OVERDUE_GRACE_SECONDS = 20; // the page sends "no answer" itself at 0; the server steps in only when that did not happen

// A request can die after the answer was saved (a restart, a gateway timeout). The transcript then ends with the candidate's answer and no
// question is waiting, so the page would sit there for ever. Any later look at the interview carries it on: the next question, or the scoring.
async function resumeStalled(a, settings) {
  const transcript = Array.isArray(a.transcript) ? [...a.transcript] : [];
  const last = transcript[transcript.length - 1];
  if (a.status !== 'started' || !last || last.role !== 'candidate' || busy.has(a.id)) return a;
  busy.add(a.id);
  let keepLocked = false;
  try {
    const questions = Array.isArray(a.questions) ? a.questions : [];
    const next = questions.find((q) => q.id === last.question_index + 1);
    if (next) {
      transcript.push({ role: 'ai', kind: 'question', section: next.kind, question_index: next.id, text: next.text, at: new Date().toISOString() });
      return await prisma.aiInterview.update({ where: { id: a.id }, data: { transcript } });
    }
    const ctx = await contextFor(a.submission_id);
    const scoring = finish(a, settings, ctx, transcript, { input: 0, output: 0 });
    const settled = await Promise.race([scoring, new Promise((resolve) => { setTimeout(() => resolve(null), FINISH_WAIT_MS).unref?.(); })]);
    if (settled) return settled;
    keepLocked = true; // scoring goes on in the background; the lock is held until it ends
    scoring.catch((err) => logger.error({ err: err.message, id: a.id }, 'ai interview scoring failed after the interview was resumed')).finally(() => busy.delete(a.id));
    return { ...a, transcript, status: 'completed' };
  } finally {
    if (!keepLocked) busy.delete(a.id);
  }
}

// A question that stayed unanswered well past its time (the page was closed or frozen) is recorded as not answered, so the time limit holds
// whether or not the page was open, and the interview moves on instead of waiting on a question nobody is looking at.
async function expireOverdue(a, settings) {
  const limit = settings.answer_time_seconds;
  const transcript = Array.isArray(a.transcript) ? [...a.transcript] : [];
  const last = transcript[transcript.length - 1];
  if (a.status !== 'started' || !limit || !last || last.role !== 'ai' || !last.at || busy.has(a.id)) return a;
  const elapsed = (Date.now() - new Date(last.at).getTime()) / 1000;
  if (elapsed <= limit + OVERDUE_GRACE_SECONDS) return a;
  transcript.push({ role: 'candidate', kind: 'answer', section: last.section, question_index: last.question_index, text: NO_ANSWER_TEXT, at: new Date().toISOString(), seconds: Math.round(elapsed), timed_out: true });
  const row = await prisma.aiInterview.update({ where: { id: a.id }, data: { transcript } });
  return resumeStalled(row, settings);
}

async function openForCandidate(token) {
  const r = await load(token);
  if (r.error) return r;
  // before the start, tell the page whether this company records interviews, so it can ask for consent up front
  const settings = await getSettings(r.a.org_id);
  r.a = await resumeStalled(r.a, settings); // an interrupted request must not leave the candidate with no question
  r.a = await expireOverdue(r.a, settings);
  // recording is mandatory whenever the company has it on: the candidate must allow camera and microphone to take the interview
  return { view: { ...candidateView(r.a, settings), recording_offered: Boolean(settings.recording_enabled), recording_required: Boolean(settings.recording_enabled), recording_days: settings.recording_retention_days } };
}

async function startForCandidate(token, { consent, recording_consent: recordingConsent }) {
  const r = await load(token);
  if (r.error) return r;
  let a = r.a;
  if (a.status === 'started') return { view: { ...candidateView(a, await getSettings(a.org_id)), recording_required: Boolean((await getSettings(a.org_id)).recording_enabled) } }; // reopened after a closed tab: carry on where it stopped
  if (!consent) return { error: 'consent_required' };
  if (busy.has(a.id)) return { error: 'busy' };
  busy.add(a.id);
  try {
    const settings = await getSettings(a.org_id);
    if (settings.recording_enabled && !recordingConsent) return { error: 'recording_required' };
    const ctx = await contextFor(a.submission_id);
    ctx.resume = await loadResume(ctx.profile_id);
    const { questions, usage } = await logic.generateQuestions(ctx, { ...settings });
    const first = { role: 'ai', kind: 'question', section: questions[0].kind, question_index: 1, text: questions[0].text, at: new Date().toISOString() };
    a = await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        status: 'started', started_at: new Date(), consented_at: new Date(), questions, transcript: [first],
        // recording is mandatory when the company has it on (checked above); without it on, nothing is recorded
        recording_on: Boolean(settings.recording_enabled && recordingConsent),
        input_tokens: { increment: usage.input }, output_tokens: { increment: usage.output },
      },
    });
    return { view: { ...candidateView(a, settings), recording_required: Boolean(settings.recording_enabled) } };
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
    const fresh = await prisma.aiInterview.findUnique({ where: { id: a.id }, select: { integrity_events: true } });
    const integrity = integritySummary({ integrity_events: fresh?.integrity_events });
    const scored = await logic.scoreInterview(ctx, rubric, transcript, questions);
    const { percent, outcome, scores } = logic.buildScores(scored.data, rubric, transcript, integrity, logic.levelFor(ctx));
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

const FINISH_WAIT_MS = 15000;

async function answerForCandidate(token, rawText, { timedOut = false } = {}) {
  const r = await load(token);
  if (r.error) return r;
  const a = r.a;
  if (a.status !== 'started') return { error: 'not_started' };
  const text = logic.cleanAnswer(rawText);
  if (text.length < 2) return { error: 'empty_answer' };
  const transcript = Array.isArray(a.transcript) ? [...a.transcript] : [];
  const last = transcript[transcript.length - 1];
  if (!last || last.role !== 'ai') return { error: 'not_waiting' };
  // a recorded interview must actually be recording: the first chunk reaches the server a few seconds after the start
  if (a.recording_on && !filesOf(a).length) return { error: 'recording_missing' };
  if (busy.has(a.id)) return { error: 'busy' };
  busy.add(a.id);
  let keepLocked = false;
  try {
    const settings = await getSettings(a.org_id);
    const ctx = await contextFor(a.submission_id);
    const questions = Array.isArray(a.questions) ? a.questions : [];
    const current = questions.find((q) => q.id === last.question_index);
    const now = () => new Date().toISOString();
    const seconds = last.at ? Math.max(0, Math.round((Date.now() - new Date(last.at).getTime()) / 1000)) : null;
    transcript.push({ role: 'candidate', kind: 'answer', section: last.section, question_index: last.question_index, text, at: now(), ...(seconds != null ? { seconds } : {}), ...(timedOut ? { timed_out: true } : {}) });
    const tokens = { input: 0, output: 0 };

    // Save the answer first so a later AI failure can never lose it.
    let row = await prisma.aiInterview.update({ where: { id: a.id }, data: { transcript } });

    // One short follow-up at most per role question (never for aptitude), and a capped number per interview.
    if (!timedOut && last.kind === 'question' && current?.kind === 'role' && row.followups_used < settings.max_followups) {
      try {
        const f = await logic.decideFollowUp(ctx, settings, last.text, text);
        tokens.input += f.usage.input; tokens.output += f.usage.output;
        if (f.follow_up) {
          transcript.push({ role: 'ai', kind: 'follow_up', section: 'role', question_index: last.question_index, text: f.follow_up, at: now() });
          row = await prisma.aiInterview.update({
            where: { id: a.id },
            data: { transcript, followups_used: { increment: 1 }, input_tokens: { increment: tokens.input }, output_tokens: { increment: tokens.output } },
          });
          return { view: candidateView(row, settings) };
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
      return { view: candidateView(row, settings), done: false };
    }
    // Scoring can take a minute (AI call, one retry), longer than a gateway waits. The answer is already saved, so after a
    // short wait the candidate is told they are done while scoring finishes in the background (the lock is held until then).
    const scoring = finish(a, settings, ctx, transcript, tokens);
    const settled = await Promise.race([scoring, new Promise((resolve) => { setTimeout(() => resolve(null), FINISH_WAIT_MS).unref?.(); })]);
    if (settled) return { view: candidateView(settled, settings), done: true };
    keepLocked = true;
    scoring
      .catch((err) => logger.error({ err: err.message, id: a.id }, 'ai interview scoring failed after the candidate finished'))
      .finally(() => busy.delete(a.id));
    return { view: { ...candidateView({ ...row, transcript }, settings), status: 'completed', waiting_for_answer: false }, done: true };
  } finally {
    if (!keepLocked) busy.delete(a.id);
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

// Report + dashboard: every AI interview (the live link of each candidate and requirement), who attempted it, for which requirement
// and client, how it went, with the submission to open. view_status: not_opened | in_progress | scored | pending_review | expired.
const REPORT_STATUSES = ['not_opened', 'in_progress', 'scored', 'pending_review', 'expired'];
const REPORT_OUTCOMES = ['pass', 'borderline', 'below_pass', 'none'];
// Submission status filter: any pipeline stage, or "not_submitted" = the candidate has not been put forward to the client yet (sourced / internal screening).
const SUBMISSION_STAGES = ['sourced', 'internal_screening', 'submitted_to_client', 'interview_scheduled', 'interview_result', 'offer_sent', 'bgv', 'closed', 'backout', 'rejected'];
const REPORT_SUBMISSION_STAGES = [...SUBMISSION_STAGES, 'not_submitted'];
const NOT_SUBMITTED = ['sourced', 'internal_screening'];
async function report(q, user) {
  const where = { deleted_at: null, superseded_at: null, org_id: user.org_id || null };
  if (q.from || q.to) where.invited_at = { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}) };
  const interviews = await prisma.aiInterview.findMany({ where, orderBy: { invited_at: 'desc' }, take: 5000 });
  const subs = await prisma.submission.findMany({
    where: { id: { in: [...new Set(interviews.map((i) => i.submission_id))] } },
    select: { id: true, stage: true, is_locked: true, profile_id: true, seat: { select: { requirement: { select: { id: true, title: true, account: { select: { id: true, name: true } } } } } } },
  });
  const subById = new Map(subs.map((s) => [s.id, s]));
  const names = await userNames(interviews.map((i) => i.invited_by));
  let rows = interviews.map((a) => {
    const s = subById.get(a.submission_id);
    const r = s?.seat?.requirement;
    const outcome = effectiveOutcome(a);
    return {
      id: a.id,
      submission_id: a.submission_id,
      profile_id: s?.profile_id || null,
      submission_stage: s?.stage || null,
      submission_locked: Boolean(s?.is_locked),
      candidate_name: a.candidate_name,
      candidate_email: a.candidate_email,
      requirement_id: r?.id || null,
      requirement_title: r?.title || a.role_title || null,
      client_id: r?.account?.id || null,
      client_name: r?.account?.name || null,
      view_status: viewStatus(a),
      attempted: a.status !== 'invited',
      score_percent: a.score_percent != null ? Number(a.score_percent) : null,
      pass_percentage: a.pass_percentage,
      outcome,
      ai_outcome: a.outcome,
      overridden: Boolean(a.override_outcome),
      auto_rejected: Boolean(a.auto_rejected_at),
      tab_switches: tabSwitchesOf(a),
      recording: Boolean(a.recording_on && a.recording_path && !a.recording_deleted_at),
      invited_by_name: names.get(a.invited_by) || null,
      invited_at: a.invited_at,
      started_at: a.started_at,
      completed_at: a.completed_at,
    };
  });
  if (q.requirement_id) rows = rows.filter((r) => r.requirement_id === q.requirement_id);
  if (q.client_id) rows = rows.filter((r) => r.client_id === q.client_id);
  if (q.status) rows = rows.filter((r) => r.view_status === q.status);
  if (q.outcome) rows = rows.filter((r) => (q.outcome === 'none' ? !r.outcome : r.outcome === q.outcome));
  if (q.attempted === 'yes') rows = rows.filter((r) => r.attempted);
  if (q.submission_stage) rows = rows.filter((r) => (q.submission_stage === 'not_submitted' ? NOT_SUBMITTED.includes(r.submission_stage) : r.submission_stage === q.submission_stage));
  if (q.q) {
    const needle = q.q.toLowerCase();
    rows = rows.filter((r) => [r.candidate_name, r.candidate_email, r.requirement_title, r.client_name].some((v) => v && v.toLowerCase().includes(needle)));
  }
  const count = (fn) => rows.filter(fn).length;
  const scores = rows.map((r) => r.score_percent).filter((n) => n != null);
  const byReq = new Map();
  for (const r of rows) {
    const key = r.requirement_id || 'none';
    const g = byReq.get(key) || { requirement_id: r.requirement_id, requirement_title: r.requirement_title || 'No requirement', client_name: r.client_name, sent: 0, attempted: 0, scored: 0, pass: 0, borderline: 0, below_pass: 0, scoreSum: 0, scoreN: 0 };
    g.sent += 1;
    if (r.attempted) g.attempted += 1;
    if (r.view_status === 'scored') g.scored += 1;
    if (r.outcome === 'pass') g.pass += 1;
    if (r.outcome === 'borderline') g.borderline += 1;
    if (r.outcome === 'below_pass') g.below_pass += 1;
    if (r.score_percent != null) {
      g.scoreSum += r.score_percent;
      g.scoreN += 1;
    }
    byReq.set(key, g);
  }
  return {
    summary: {
      sent: rows.length,
      attempted: count((r) => r.attempted),
      not_opened: count((r) => r.view_status === 'not_opened'),
      in_progress: count((r) => r.view_status === 'in_progress'),
      scored: count((r) => r.view_status === 'scored'),
      pending_review: count((r) => r.view_status === 'pending_review'),
      expired: count((r) => r.view_status === 'expired'),
      pass: count((r) => r.outcome === 'pass'),
      borderline: count((r) => r.outcome === 'borderline'),
      below_pass: count((r) => r.outcome === 'below_pass'),
      average_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    },
    by_requirement: [...byReq.values()]
      .map(({ scoreSum, scoreN, ...g }) => ({ ...g, average_score: scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null }))
      .sort((a, b) => b.sent - a.sent),
    rows,
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

// For the team: one stored part, while it exists. Only admins and the team member who sent the link may open it.
async function recordingFor(id, part = 0, user = null) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a) return { error: 'not_found' };
  if (!canSeeRecording(a, user, await seesAllRecordings(user))) return { error: 'recording_forbidden' };
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


// Re-sends the SAME link (the candidate carries on where they stopped) by email, and gives the link back to copy. A link that has
// expired or is about to is given a fresh validity period.
async function resend(id, user) {
  const a = await prisma.aiInterview.findFirst({ where: { id, deleted_at: null } });
  if (!a || a.superseded_at) return { error: 'not_found' };
  if (a.status === 'completed' || a.status === 'pending_review') return { error: 'already_completed' };
  const settings = await getSettings(user.org_id);
  let row = a;
  if (a.expires_at.getTime() < Date.now() + 86400000) {
    row = await prisma.aiInterview.update({ where: { id }, data: { expires_at: new Date(Date.now() + settings.link_valid_days * 86400000) } });
  }
  const link = attemptLink(row.token);
  let emailed = false;
  if (row.candidate_email) {
    await enqueue(prisma, {
      kind: 'ai_interview_invite',
      to: { email: row.candidate_email, name: row.candidate_name },
      subject: `Your interview for ${row.role_title || 'the role'} (link sent again)`,
      text: `Hi ${row.candidate_name},\n\nHere is your interview link again: ${link}\n\nIf you had already started, open the same link to carry on where you stopped.`,
    });
    emailed = true;
  }
  await audit(prisma, user, 'resend_ai_interview', row, 'Interview link sent again', { emailed });
  return { interview: toTeamView(row, new Map(), user, await seesAllRecordings(user)), link, emailed };
}

// One event from the candidate's page (tab switch, copy / paste attempt, camera turned off). Logged on the interview; when the
// company limit of tab switches is reached the interview ends and a person reviews the answers given so far.
async function recordEvent(token, { type, seconds_away: secondsAway }) {
  if (!EVENT_TYPES.includes(type)) return { error: 'bad_event' };
  const r = await load(token);
  if (r.error) return r;
  const a = r.a;
  if (a.status !== 'started') return { error: 'not_started' };
  // appended in one statement: a burst of events (a held-down Ctrl+V) must not overwrite each other, so no read-modify-write here
  const event = { type, at: new Date().toISOString(), ...(Number.isFinite(secondsAway) ? { seconds_away: Math.round(secondsAway) } : {}) };
  await prisma.$executeRaw`UPDATE "ai_interviews" SET "integrity_events" = COALESCE("integrity_events", '[]'::jsonb) || ${JSON.stringify([event])}::jsonb WHERE "id" = ${a.id}::uuid AND jsonb_array_length(COALESCE("integrity_events", '[]'::jsonb)) < 200`;
  let row = await prisma.aiInterview.findUnique({ where: { id: a.id } });
  const settings = await getSettings(a.org_id);
  const switches = tabSwitchesOf(row);
  if (settings.max_tab_switches > 0 && TAB_EVENTS.includes(type) && switches >= settings.max_tab_switches && !busy.has(a.id)) {
    const summary = integritySummary(row);
    const reason = `The interview was ended automatically: the candidate left the interview page ${switches} times (limit ${settings.max_tab_switches}).`;
    const answered = (Array.isArray(row.transcript) ? row.transcript : []).filter((t) => t.role === 'candidate').length;
    row = await prisma.aiInterview.update({
      where: { id: a.id },
      data: {
        status: 'pending_review', outcome: 'pending_review', completed_at: new Date(),
        scores: { parameters: [], summary: reason, strengths: [], red_flags: [reason], decision_reason: `${reason} ${answered} answer(s) were given before that; please read them and decide.` },
        ...(a.recording_on ? { recording_expires_at: new Date(Date.now() + settings.recording_retention_days * 86400000) } : {}),
      },
    });
    await announceResult(row, await contextFor(a.submission_id));
    return { ended: true, tab_switches: switches, summary };
  }
  return { ended: false, tab_switches: switches };
}

module.exports = {
  OUTCOMES, DEFAULTS, getSettings, updateSettings,
  invite, resend, recordEvent, list, review, override, remove, setRequirementSwitch, analytics, report, REPORT_STATUSES, REPORT_OUTCOMES, REPORT_SUBMISSION_STAGES,
  openForCandidate, startForCandidate, answerForCandidate,
  saveRecordingChunk, recordingFor, purgeExpiredRecordings,
};
