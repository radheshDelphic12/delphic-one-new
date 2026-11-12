# Bench profile can skip the first interview round

Built 2026-10-30. Live on staging and production (main). One additive migration.

If the profile tagged on a submission is one of our own **bench** profiles (`profiles.source = 'direct'`, shown as "Bench"), the **first
round** of the submission's interview plan gets a **Skip round** button.

## Behaviour
- The first round = the template round with the lowest `sort_order` (for the seeded templates: "Screening + Behavioural + Reasoning,
  Aptitude & Mind Test"). Only that round, only while it has no round record, only for a Bench profile. Vendor and Market profiles never
  get it.
- Click -> a drawer with an optional reason -> an `interview_rounds` row is created: `status = completed`, `result = skipped`,
  `feedback = <reason>` (default "Skipped: bench profile"), `completed_at = now`, `scheduled_by = who skipped`.
- The plan shows "Skipped (bench profile)", hides Edit / Give feedback for that round, opens the next round (`can_start`), and the offer gate
  (`mandatoryRoundsDone`) counts it as done. No score, so it can never be "below pass mark".
- Who: anyone who may manage that round (`canManageInterviewRound`): admin, or the recruiter who owns the submission; sales cannot skip a
  Delphic round (403).
- Reports: skipped rounds are excluded from the interview report counts / turnaround (`summarizeInterviewRounds`). In the Hiring funnel a
  skipped round is an **assumed pass** ("Not held").

## Code
- Migration `20261107100000_interview_round_skipped`: `ALTER TYPE "RoundResult" ADD VALUE IF NOT EXISTS 'skipped'` (additive).
- `server/src/modules/submissions/submissions.service.js` `skipFirstRound`; route `POST /api/v1/submissions/:id/interview-rounds/skip`
  (`{ template_round_id, reason? }`, same permission as scheduling a round); error codes `skip_bench_only`, `skip_first_round_only`,
  `round_already_exists`, `forbidden`.
- `interviewTemplates.service.js`: `DONE_RESULTS` includes `skipped`; `getPlan` returns `plan.bench_profile` and `step.can_skip`.
- Client: `InterviewPlanPanel.jsx` (button + drawer, `data-testid=skip-first-round`), `interviewRounds.js` and `Badge.jsx` labels.
- Tests: `server/tests/interview-templates.test.js` (3 added). Playwright on staging (`pw/verify-skip.js`) all pass; it creates a dummy
  "ZZ PW Skip <ts>" bench profile + submission (no delete endpoint for submissions, so they stay on staging).

## Not done / notes
- No "undo skip" action. Deleting the round record is a database-level fix.
- Only the first round; a later round or a second skip returns 400.
