# AI interview (optional first-round screening)

Built on branch `feature/ai-interview`; **shipped to `super_admin_branch`, `staging` and `main` (production) on 2026-10-30** (commits up to `b9f039c`, 4 additive migrations `20261105*`). Prod `.env` has `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (user-level key) and `AI_INTERVIEW_MODEL` (quoted, picked up by the next server recreate). **Not yet verified end to end** (browser microphone / speech, recording, the live Anthropic call): trial it on a dummy candidate first. An **optional, separate link** for a candidate's first
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
   Answers are spoken (browser speech-to-text, Chrome/Edge); only the aptitude / numerical answers are typed, everywhere else the answer box is read-only, and the candidate must pass the microphone test and use a browser that supports speech-to-text before Start is enabled. Closing the tab keeps progress; the same link resumes.
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
Off by default (Hiring setup > AI interview > Recording). **When on, the recording is mandatory** (2026-11-02): the candidate cannot
start without ticking the recording box and allowing camera + microphone (`start` answers 400 `recording_required` otherwise), the page
asks for the camera before it calls `start`, and the interview pauses behind a "Turn the camera on" box if the camera is turned off.
The server refuses an answer (409 `recording_missing`) until the first chunk has been stored. The browser records with `MediaRecorder` (about 500 kbps) and uploads 5-second chunks in order to
`POST /public/ai-interviews/:token/recording?part=p&seq=n`; the server appends to `uploads/ai-interviews/<id>.webm`. A candidate who
closes the tab and reopens the link records the **next part** as its own file (`<id>-p2.webm`, ...); the team plays / downloads each
part. Cap 250 MB per interview. The files are **deleted automatically after the retention days (default 2, setting 1-30)** by the
hourly job `jobs/aiInterviewRecordings.js`; the interview, transcript and scores stay. The team plays / downloads through
`GET /ai-interviews/:id/recording?part=n` (login required, never a public URL).

## Timer, page integrity, resend (2026-11-02)
- **Timer:** setting `answer_time_seconds` (default 180, 0 = no limit). The candidate view carries `question_asked_at`, `answer_seconds` and
  `server_now`, so the countdown comes from the server clock and a reload cannot reset it. At 0 the page sends what is typed, or
  `[No answer - time ran out]` with `timed_out: true` (no follow-up is asked; the answer counts as skipped).
- **No copy / paste / tab switching:** while the interview runs the page blocks copy, cut, paste, right-click, drag and the Ctrl+C/X/V/A/P/S/U
  keys, and logs leaving the page (visibility change or window blur, with a 4 s grace around permission prompts). A browser cannot
  truly stop a tab switch, so it is detected: a warning with the count, and at `max_tab_switches` (default 3, 0 = only log) the interview
  ends as `pending_review` with a red flag. Events go to `POST /public/ai-interviews/:token/event` and are appended atomically to
  `ai_interviews.integrity_events`; the team sees counts on the list and as red flags on the result.
- **Resend / restart:** `POST /ai-interviews/:id/resend` sends the SAME link again by email (an expired or nearly expired link gets a new
  validity) and returns it to copy; the card shows **Resend link** for not opened / in progress / expired. A candidate in progress is
  kept by a normal invite; **Restart with a new link** (`restart: true`, confirmed, audited as `restart_ai_interview`) replaces it.
- **Communication score:** the rubric now defines what communication is (answers the question, structure, completeness, concision) with a
  0-10 scale, the evaluator is given plain answer facts (answers, average words, very short, skipped), and the score is **capped** by
  those facts: skipped half or more = max 2, a quarter = 4, under 10 words on average = 4, under 20 = 6.
- Migration `20261112100000_ai_interview_timer_and_integrity` (additive: 2 settings columns + the events column).

## Marking scheme, level and reference sites (2026-11-03)
- **Marking scheme out of 100:** every section carries marks (Hiring setup > AI interview > Marking scheme). Defaults: role knowledge 30, communication 20,
  depth 15, problem solving 15, experience fit 10, aptitude 10. Each section is scored 0-10 and earns score/10 of its marks. A scheme that does
  not add up to 100 still works (the result is always worked out out of 100 from the shares) but is flagged, with a **Scale to 100** button.
  Aptitude off = its marks are left out and the rest scale. The result stores per section `weight`, `max_points`, `points`; the review drawer shows a
  **Marks sheet** (section, score, maximum marks, marks obtained, total, pass mark).
- **Communication** is the average of five judged parts (clarity, structure, relevance, completeness, professionalism, each 0-10 with a note), then
  capped by plain answer facts (skipped / very short answers). Shown under "How communication was judged".
- **Level:** questions and scoring follow the candidate's years: fresher (<1), junior (1-3), mid (3-6), senior (6-10), lead (10+); the requirement's
  experience range is used when the profile has none. Stored on the result (`scores.level`) and shown as a badge.
- **Two more weighted parameters:** problem solving and experience fit (does the answer match the claimed years and level).
- **Reference sites:** setting `use_reference_sites` + `reference_sites` (default w3schools.com, javatpoint.com, max 5 domains). When the questions are
  written the AI may use the Anthropic web search tool limited to those domains (`allowed_domains`, 3 searches) to get syntax and definitions right;
  it writes its own questions and never copies from the pages. If the tool is not available for the key / model the same request is sent again
  without it. **Not verified against the live API** (needs the production key with web search enabled).
- Migrations `20261113100000_ai_interview_weights_and_reference_sites` and `20261113110000_ai_interview_marks_defaults` (additive; only the defaults of NEW
  settings rows change).

## Flow check 2026-11-03 (HR and candidate, end to end) and fixes
- **Re-take:** a finished interview (scored / needs review) now offers **Send again (re-take)** on the card (`POST /ai-interviews` with `retake: true`, confirmed, audited as `retake_ai_interview`). The first result stays in the list as "Replaced" and stays readable; a plain invite on a finished interview is still refused.
- **Candidate stuck:** an interview started before recording was switched on (`recording_on` false) no longer waits for a camera that is never started (the page used the company setting, not the interview's own); the wait for the first recording chunk now offers "try again" after 30 s.
- **Link copy:** the HR card no longer fails when the browser clipboard is unavailable; it shows the link instead.
- **A section the AI does not score** is marked "Not scored", left out of the total and flagged (it used to count as 0); if nothing was scored the interview goes to a person (pending review).
- Checked with Playwright on a local stack (fake AI, fake camera): send link, candidate answers all questions, result with marks sheet, re-take, resend, restart, recording switched on mid-way, reload and resume, recorded interview with copy / paste / tab-switch rules.

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
weights (knowledge / communication / depth / aptitude), auto-reject on/off, recording on/off + retention days, time per question,
tab switches allowed.

## Going live
- Needs `ANTHROPIC_API_KEY` (and optionally `AI_INTERVIEW_MODEL`, default `claude-sonnet-5-5`) in the server environment. Without it the
  candidate sees "not switched on yet" and nothing else is affected. Never commit the key.
- Four additive migrations (one adds a nullable `requirements` column, one a notification enum value); nothing existing is altered.
  Settings start with the feature **off**.
- Recording storage lives in `UPLOAD_DIR/ai-interviews`; keep disk headroom (a 20-minute interview is roughly 70 MB).

## Difficulty and marking (2026-11-04)
Average candidates were scoring below average, so both are now admin settings (Hiring setup > AI interview > Interview), default **Easy + Lenient**
(migration `20261117100000_ai_interview_difficulty`: `ai_interview_settings.difficulty` easy|medium|hard, `marking` lenient|balanced|strict; existing companies get the defaults).
- **Question difficulty**: Easy = everyday-work questions a competent average person at the level can answer, even difficulty, one thing per question, no trick questions;
  Medium = typical for the level; Hard = upper end of the level, rising difficulty, probing edge cases. The level (fresher ... lead) still follows the candidate’s years, one step easier than before.
- **Marking**: tells the scorer where an average competent candidate should land: Lenient 6-7 (about 60-70%, passes), Balanced 5-6, Strict 4-5. The rubric now says what 9-10 / 7-8 / 6 / 4-5 / below mean,
  no longer "use the full range", and does not mark down short spoken answers, wording or details nobody asked about. Depth, Problem solving and Experience fit were softened (a bonus, not a requirement).
- Aptitude questions are easy (school-level arithmetic, simple series), about a minute each.
- Pass mark (60) and the borderline range (10 points) are unchanged and still editable.

## Still manual / known limits
- Needs the Anthropic key and a real run on staging with a real camera + mic. Playwright with a fake camera (2026-11-02) covered the
  start gating, countdown, auto-submit on timeout, recording, copy / paste / right-click blocks and the tab-switch warning and ending;
  speech-to-text and the "camera turned off mid-interview" box were not exercised.
- A CV that is a Word file is not read (PDF only): reading .docx would need a new dependency (jszip is only a transitive one today).
- A recording split into parts is not merged; each part plays on its own.
- The e-mail to the candidate with the link follows the existing "e-mail the test link" company setting.
- Public rate limits: 240 interview calls per hour per IP, and a separate 2500 per hour for recording chunks (one every 5 seconds).
