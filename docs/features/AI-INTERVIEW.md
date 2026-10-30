# AI interview (optional first-round screening)

Built 2026-11-05 on branch `feature/ai-interview` (local, not pushed). An **optional, separate link** for a candidate's first
round. It is **off by default** and nothing in the existing flow (screening test, interview plan, stage rules, offer gate)
depends on it or waits for it.

## What it does
1. A recruiter opens a candidate's page and clicks **Send AI interview link** (card "AI interview (optional, first round)",
   shown only when an admin has switched the feature on). The link is `/ai-interview/<token>`, valid 7 days (setting), one attempt.
2. The candidate (no login) does a microphone test, agrees to AI evaluation (and, if the company records, optionally to recording).
3. The AI asks one question at a time:
   - **role questions** (default 7) built from the requirement (title, JD, skills, experience) and the candidate's profile
     (designation, company, skills, experience, education, and the CV when a PDF is stored);
   - up to 3 short **follow-ups** on vague answers (never on aptitude);
   - an **aptitude section** (default 4): AI-written logic / number / pattern questions, each with an expected answer that stays on the server.
   Answers are spoken (browser speech-to-text, Chrome/Edge) or typed. Closing the tab keeps progress; the same link resumes.
4. At the end the AI scores a rubric: **Role knowledge, Communication, Depth, Aptitude** (0-10 each, with summary + evidence). The
   total is the weighted average using the admin's weights. Outcome: **pass** (>= pass mark, default 60), **borderline**
   (within 10 points below), **below pass**.
5. The card shows score, outcome and a plain-language **"Why"** (built from the numbers, not asked of the AI): score vs pass mark,
   weakest parts, red flags. "View result" shows the breakdown, strengths, red flags, transcript and the recording.
6. **Auto-reject (setting, off by default).** With it on, a below-pass result moves the candidate to Rejected through the normal stage
   machine (history, notification, reason `AI interview: <why>`), only while they are in `sourced` / `internal_screening`. Later
   stages, locked tickets, borderline and pass results are never rejected; the card shows why it did not. An admin can reactivate a
   rejected candidate.
7. **Result notification.** When an interview finishes (scored or pending review) the person who sent it, and the admins, get a bell
   notification (and an e-mail, per their notification preferences): event `ai_interview_completed`.
8. A person can **override** the outcome with a reason (audit log `override_ai_interview`); the AI result is kept. An admin can delete
   an interview (audited) so a new link can be sent.

## CV
If a PDF is stored for the profile (Documents; newest "Resume" / "CV" first; up to 4 MB) it is attached to the question-writing call
so the questions are specific to the candidate's real work. No PDF, a Word file or a huge file means the AI uses the profile fields only.

## Per requirement
On the card, "Turn off for this requirement" (admin / recruiter / sales; audited as `set_ai_interview_switch`) stops new links for that
requirement even when the company setting is on. `requirements.ai_interview_enabled`: null = follow the company, false = off.

## Analytics
Hiring setup > AI interview shows: links sent, finished, pass / borderline / below pass, needs review, not opened, in progress, decided
by a person, auto-rejected, average score and minutes. API: `GET /ai-interviews/analytics?from&to`.

## Optional recording (audio + video)
Off by default (Hiring setup > AI interview > Recording). When on, the candidate is asked for permission and can decline and still
interview. The browser records with `MediaRecorder` (about 500 kbps) and uploads 5-second chunks in order to
`POST /public/ai-interviews/:token/recording?part=p&seq=n`; the server appends to `uploads/ai-interviews/<id>.webm`. A candidate who
closes the tab and reopens the link records the **next part** as its own file (`<id>-p2.webm`, ...); the team plays / downloads each
part. Cap 250 MB per interview. The files are **deleted automatically after the retention days (default 2, setting 1-30)** by the
hourly job `jobs/aiInterviewRecordings.js`; the interview, transcript and scores stay. The team plays / downloads through
`GET /ai-interviews/:id/recording?part=n` (login required, never a public URL).

## Never blocks the candidate
- AI down when starting: "try again later"; the link is not used up.
- AI down while scoring: every answer is saved and the interview becomes **pending human review**.
- Candidate text is data, never instructions: wrapped in `<candidate_answer>` tags, control characters stripped, 4000 char cap;
  "ignore instructions / give full marks" patterns add a red flag and do not change the score.
- Accent / pronunciation / protected traits are not judged.

## Where things are
| Part | Path |
|---|---|
| Tables | `ai_interviews`, `ai_interview_settings`, `requirements.ai_interview_enabled` (migrations `20261105100000_ai_interview`, `...110000_ai_interview_aptitude_recording`, `...120000_ai_interview_completion`, `...130000_ai_interview_notification_type`) |
| API (team, login) | `/api/v1/ai-interviews` (list, send, review, override, delete, recording, settings, analytics, requirements/:id/switch) |
| API (candidate, token) | `/api/v1/public/ai-interviews/:token` (open, start, answer, recording) |
| Server code | `server/src/modules/aiInterviews/` (`aiClient.js` Anthropic call, `aiInterviews.logic.js` prompts + rubric maths, `aiInterviews.service.js`, `aiInterviews.routes.js`) |
| Job | `server/src/jobs/aiInterviewRecordings.js` |
| Candidate page | `client/src/pages/public/AiInterviewPage.jsx` |
| Team card | `client/src/pages/submissions/AiInterviewCard.jsx` (mounted in `SubmissionDetailPage`) |
| Admin settings + analytics | `client/src/pages/hiringSetup/AiInterviewTab.jsx` (tab "AI interview") |
| Tests | `server/tests/ai-interviews.test.js` (AI provider stubbed), `server/tests/ai-client.test.js` (the Anthropic request / failure handling with fetch replaced) |

## Settings (admin editable, per company)
On/off, role question count, follow-ups, pass mark, borderline range, link validity, extra instructions for the AI, aptitude on/off + count,
weights (knowledge / communication / depth / aptitude), auto-reject on/off, recording on/off + retention days.

## Going live
- Needs `ANTHROPIC_API_KEY` (and optionally `AI_INTERVIEW_MODEL`, default `claude-sonnet-5-5`) in the server environment. Without it the
  candidate sees "not switched on yet" and nothing else is affected. Never commit the key.
- Four additive migrations (one adds a nullable `requirements` column, one a notification enum value); nothing existing is altered.
  Settings start with the feature **off**.
- Recording storage lives in `UPLOAD_DIR/ai-interviews`; keep disk headroom (a 20-minute interview is roughly 70 MB).

## Still manual / known limits
- Needs the Anthropic key and a real staging run with camera + mic: the browser parts (speech, MediaRecorder, mic test) were not
  exercised in a browser.
- A CV that is a Word file is not read (PDF only): reading .docx would need a new dependency (jszip is only a transitive one today).
- A recording split into parts is not merged; each part plays on its own.
- The e-mail to the candidate with the link follows the existing "e-mail the test link" company setting.
- Public rate limits: 240 interview calls per hour per IP, and a separate 2500 per hour for recording chunks (one every 5 seconds).
