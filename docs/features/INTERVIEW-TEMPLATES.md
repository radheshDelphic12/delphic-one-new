# Interview templates, skill ratings and assessments

Built 2026-10-28 (local, not pushed). Migrations `20261028150000_interview_templates`, `20261028170000_assessments`.

## Service type -> template

| Requirement type | Template (seeded, admin-editable) |
|---|---|
| Internal Hiring - Technical | Screening+Test, Developer 1, Developer 2, CTO Round, MD Round |
| Internal Hiring - Non-Technical | Screening+Test, VP HR / Sales, CEO Round, MD Round |
| Managed Services / Recruitment / Project | Screening+Test, Client Round 1 (mandatory), Client Round 2-4 (optional), MD Round |

- The template is picked when the requirement is created (`requirements.interview_template_id`). Changing the type later re-picks it only while no template interview exists.
- Requirements created before this change have no template and keep the older rounds (`internal_r1`, `client_r1` ...).
- Minimum pass %: the template's default (60), overridden per requirement (`requirements.pass_percentage`).

## Rules

- A mandatory round must be finished (result pass/fail) before the next round can be scheduled. Optional rounds can be skipped.
- Finishing a round needs feedback. Delphic rounds marked "rating required" also need skill ratings: free-text skill names, each rated 1-10. Overall % = sum / (skills x 10). Client rounds and the MD round need feedback only.
- A score under the pass mark does not reject the candidate; the round is flagged `below_pass` and the manager decides. "Tell candidate feedback is coming" queues an email (`POST /submissions/:id/candidate-feedback-message`).
- The offer stage needs every mandatory template round done (`mandatory_rounds_pending`).

## Assessments (Behavioural / Reasoning / Aptitude / Mind)

- The team writes questions (Hiring Setup > Question bank): each option carries marks, the best option is the question's full marks (right/wrong = 1/0, behavioural = graded).
- A test = ordered questions + pass % + optional time limit.
- From the screening step of a candidate's plan, "Send a test" creates a public link `/assessment/<token>` (valid 7 days, one submission) and emails it when the profile has an email. The candidate needs no login; marks are never sent to the browser. Scored on submit, `passed` vs the pass mark on the day it was sent.

## Where

- Hiring Setup page (`/hiring-setup`): templates editor (admin), question bank, tests.
- Candidate (submission) page: interview plan with schedule, feedback + skill-rating form, test sending.
- API: `/interview-templates`, `/assessments/*`, `/public/assessments/:token`, `/submissions/:id/interview-plan`.

## Internal hiring and the careers pool

Internal Hiring requirements use the same flow as any other: publish from Website (career page), applicants land in the Pipeline applicant pool, a recruiter claims them, they become a profile + submission and follow the Internal Hiring template. The other companies' own Hiring module (`/hiring`) is unchanged.

## Open

- A requirement still needs an active client account; for Internal Hiring use a "Delphic (Internal)" account.
- Round reminders/calendar still label template rounds by the generic "Interview Round"; the round name is shown beside it.
