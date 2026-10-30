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
     (designation, company, skills, experience, education);
   - up to 3 short **follow-ups** on vague answers (never on aptitude);
   - an **aptitude section** (default 4): AI-written logic / number / pattern questions, each with an expected answer that stays on the server.
   Answers are spoken (browser speech-to-text, Chrome/Edge) or typed. Closing the tab keeps progress; the same link resumes.
4. At the end the AI scores a rubric: **Role knowledge, Communication, Depth, Aptitude** (0-10 each, with summary + evidence). The
   total is the weighted average using the admin's weights. Outcome: **pass** (>= pass mark, default 60), **borderline**
   (within 10 points below), **below pass**.
5. The card shows score, outcome and a plain-language **"Why"** (built from the numbers, not asked of the AI): score vs pass mark,
   weakest parts, red flags. "View result" shows the breakdown, strengths, red flags, transcript and the recording.
6. A person can **override** the outcome with a reason (audit log `override_ai_interview`); the AI result is kept. An admin can delete an
   interview (audited) so a new link can be sent. Nothing is auto-rejected: **auto-reject is not built**; the stage never changes by itself.

## Optional recording (audio + video)
Off by default (Hiring setup > AI interview > Recording). When on, the candidate is asked for permission and can decline and still
interview. The browser records with `MediaRecorder` (about 500 kbps) and uploads 5-second parts in order to
`POST /public/ai-interviews/:token/recording?seq=n`; the server appends to `uploads/ai-interviews/<id>.webm`. Cap 250 MB per interview.
The file is **deleted automatically after the retention days (default 2, setting 1-30)** by the hourly job
`jobs/aiInterviewRecordings.js`; the interview, transcript and scores stay. The team plays/downloads it through
`GET /ai-interviews/:id/recording` (login required, never a public URL).

## Never blocks the candidate
- AI down when starting: "try again later"; the link is not used up.
- AI down while scoring: every answer is saved and the interview becomes **pending human review**.
- Candidate text is data, never instructions: wrapped in `<candidate_answer>` tags, control characters stripped, 4000 char cap;
  "ignore instructions / give full marks" patterns add a red flag and do not change the score.
- Accent / pronunciation / protected traits are not judged.

## Where things are
| Part | Path |
|---|---|
| Tables | `ai_interviews`, `ai_interview_settings` (migrations `20261105100000_ai_interview`, `20261105110000_ai_interview_aptitude_recording`) |
| API (team, login) | `/api/v1/ai-interviews` (list, send, review, override, delete, recording, settings) |
| API (candidate, token) | `/api/v1/public/ai-interviews/:token` (open, start, answer, recording) |
| Server code | `server/src/modules/aiInterviews/` (`aiClient.js` Anthropic call, `aiInterviews.logic.js` prompts + rubric maths, `aiInterviews.service.js`, `aiInterviews.routes.js`) |
| Job | `server/src/jobs/aiInterviewRecordings.js` |
| Candidate page | `client/src/pages/public/AiInterviewPage.jsx` |
| Team card | `client/src/pages/submissions/AiInterviewCard.jsx` (mounted in `SubmissionDetailPage`) |
| Admin settings | `client/src/pages/hiringSetup/AiInterviewTab.jsx` (tab "AI interview") |
| Tests | `server/tests/ai-interviews.test.js` (AI provider stubbed) |

## Settings (admin editable, per company)
On/off, role question count, follow-ups, pass mark, borderline range, link validity, extra instructions for the AI, aptitude on/off + count,
weights (knowledge / communication / depth / aptitude), recording on/off + retention days.

## Going live
- Needs `ANTHROPIC_API_KEY` (and optionally `AI_INTERVIEW_MODEL`, default `claude-sonnet-5-5`) in the server environment. Without it the
  candidate sees "not switched on yet" and nothing else is affected. Never commit the key.
- Two additive migrations; nothing existing is altered. Settings start with the feature **off**.
- Recording storage lives in `UPLOAD_DIR/ai-interviews`; keep disk headroom (a 20-minute interview is roughly 70 MB).

## Not built yet
Auto-reject, e-mail of the result to anyone, resume text (the AI uses the profile fields, not the CV file), analytics counts for AI
screened / pass / borderline / below pass, per-requirement on/off switch, resuming a recording after a closed tab.
