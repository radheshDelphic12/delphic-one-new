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

## Test link management, JD skill prefill and analytics (2026-10-28)

### One live test per submission and round
- A test attempt is **live** when it is not deleted and not superseded. There is at most one live attempt per submission and screening round.
- Sending a new test **replaces an unopened link** (the old one is marked replaced and stops working). It is **refused** while the candidate is mid-test, and while a scored result exists. An admin deletes the scored result to allow a **retake**.
- Admins can **delete** any link or result (confirmation drawer, optional reason; recorded in `audit_logs` with who, when and a snapshot) and **extend** an unfinished link by 7 days. Deleted attempts disappear from lists and every count.
- Each attempt shows status (not opened, in progress, scored with % and pass/fail, expired, replaced), created date and created by.

### Attempt limit
- `orgs.assessment_max_attempts` (default **3**, `0` = no limit), edited in Hiring setup > Tests. Counted **per submission** (not per email), every attempt sent and not deleted, replaced links included, so re-sending cannot dodge it. Deleting an attempt frees a slot. An admin can send past the limit on purpose (confirmation); others cannot.

### Skill ratings from the JD
- A round with "skill ratings required" opens its feedback panel with the requirement's `primary_tech_stack` then `secondary_tech_stack` as rows (repeats and blanks dropped). Ratings are 0-10 and start unrated; every row left must be rated before saving. Rows can be removed; other skills are picked from the dropdown (JD skills, candidate skills, skills rated before, catalog) or typed. A new skill saved on a round joins the dropdown. An empty stack shows just "+ Add skill".

### Tests & interviews analytics (Hiring setup > Tests & interviews)
- Counting rule: only **live** attempts count, so a retake replaces the deleted result. Tests are dated by the day sent, interviews by interview time. Completed interview = pass/fail recorded; cancelled interviews are shown separately and are not in "scheduled". Filters: date range, requirement, recruiter (who submitted the candidate), client. Drill-down lists the individual records.
- API: `GET /assessments/analytics/summary | records | filters`, `GET/PUT /assessments/settings`, `DELETE /assessments/attempts/:id`, `POST /assessments/attempts/:id/extend`, `GET /interview-templates/skill-options`. Migration `20261031100000_assessment_attempt_management` (additive; retires old unopened duplicate links).
