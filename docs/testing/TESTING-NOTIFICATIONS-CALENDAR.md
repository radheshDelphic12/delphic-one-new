# Testing guide — Notifications + Interview Calendar

Manual click-through for [features/RD-NOTIFICATIONS-AND-CALENDAR.md](../features/RD-NOTIFICATIONS-AND-CALENDAR.md).
Branch `feature/notifications-calendar`. Automated coverage: `notifications.test.js`,
`interviews-calendar.test.js`, `interview-reminders.test.js` (all green).

---

## 0. Setup

| | |
|---|---|
| Client | http://localhost:5173 |
| API | http://localhost:4000 |
| Start | `npm run dev:server` + `npm run dev:client` (DB container must be up on `:5434`) |

**You need two sessions side by side** — the actor is *never* notified of their own
action, so every check is "user A does X → user B sees the bell". Use two browsers,
or one normal + one incognito window. The login page has one-click role buttons
(Admin / BDA / Sales / Recruiter); password for typed logins is `Password123!`.

Seeded users (dev seed):

| Role | Emails |
|---|---|
| admin | `admin@delphic.in`, `biswajit.dey@delphic.in`, `paras.gulati@delphic.in` |
| sales | `tanvi.saxena@delphic.in`, `chahak.pandya@delphic.in` |
| bda | `dheeraj.kumar@delphic.in` |
| recruiter | `nikhil.yadav@delphic.in`, `shivani.sinha@delphic.in`, `sarthak.solanki@delphic.in` |

**How to read the bell:** unread count badge (caps at `9+`) refreshes within **60 s**
of a poll, or immediately when you switch back to the tab. Opening the popover or
clicking a row marks it read. "Mark all read" is in the popover header and on
`/notifications`.

**Reset between runs (optional):** to clear the notification noise for one user,
open their bell → **Mark all read**, or as any user hit `POST /api/v1/notifications/read-all`.

---

## Part A — Role-based notification matrix

Who is eligible for each event is set by `ROLE_EVENT_MATRIX` in
`server/src/lib/notifications/eventCatalog.js`; who actually receives it is the
recipient resolver for that event. This part walks the whole matrix.

> Convention below: **Actor** = who performs the action, **Expect bell** = who
> should get a row, **No bell** = who should *not* (usually the actor, or a role
> not in the matrix).

> **Admins get a copy of _every_ event** — every check in A1–A10 also lands in the
> bell of every active admin who isn't the actor and hasn't muted that type in
> **Settings → Notifications**. So when you run these with an admin window open on
> the side, expect that admin's badge to tick up on *every* step. To verify the
> admin path explicitly: log in as a second admin (`biswajit.dey`), keep them out
> of every participant role, and confirm they still receive A2 (`requirement_created`),
> B1 (`interview_scheduled`), D (`interview_reminder`), etc. An admin who performs
> the action gets nothing for that action; an admin who toggles a type off in
> Settings stops receiving it.

### A1. Account activated → `account_activated`

Matrix roles: bda, sales, admin · Recipients: account owner + "brought by" + all admins.

1. **Actor: BDA** (`dheeraj.kumar`). Accounts → open a client account at stage
   `meeting_scheduled` (or move a lead through `meeting_scheduled` first) → move
   stage to **active**.
2. **Expect bell:** every **admin**; the account owner / brought-by BDA *if that
   is not Dheeraj*.
3. **No bell:** Dheeraj (he's the actor); any **recruiter**.
4. Click the admin's row → lands on `/accounts/:id`, row goes read, badge drops by 1.

### A2. Requirement created → `requirement_created`

Matrix roles: bda, sales, admin · Recipients: account owner + sales owner + admins.

1. **Actor: Sales** (`tanvi.saxena`). Requirements → **Create** on an **active client**
   account → save.
2. **Expect bell:** the **BDA who owns that account**; every **admin**.
3. **No bell:** Tanvi (actor); recruiters.

### A3 / A4. Recruiter assigned / unassigned → `requirement_assigned` / `requirement_unassigned`

Matrix roles: recruiter, sales, admin · Recipient: just the target user.

1. **Actor: Sales** (`tanvi.saxena`, owns the requirement). Requirements list →
   row **⋯ → Assign recruiter** (or the requirement detail → Assignments) →
   pick `shivani.sinha` → confirm.
2. **Expect bell (Shivani):** "You were assigned to a requirement" → click →
   `/requirements/:id`.
3. **No bell:** Tanvi; other recruiters; BDA.
4. Now **unassign** Shivani from the same requirement.
5. **Expect bell (Shivani):** "You were removed from a requirement".

### A5. Requirement status changed → `requirement_status_changed`

Matrix roles: all · Recipients: sales owner + account owner + active recruiter assignees.

1. Make sure the requirement from A3 still has **Shivani assigned**.
2. **Actor: Sales** (`tanvi.saxena`). Requirement detail → change **Status**
   (e.g. `open → on_hold`), give a reason if asked.
3. **Expect bell:** **Shivani** (assignee) and the **BDA** who owns the account.
4. **No bell:** Tanvi (actor).
5. Repeat as **Actor: Admin** changing the status → now **Tanvi** *and* Shivani
   *and* the BDA get it (admin is the actor, so admin gets nothing).

### A6. Candidate submitted to client → `candidate_submitted_to_client`

Matrix roles: sales, bda, admin · Recipients: sales owner + account owner.

1. **Actor: Recruiter** (`shivani.sinha`). Take a submission she created from
   `internal_screening` → **Move to submitted to client**.
2. **Expect bell:** the **sales owner** (Tanvi) and the **BDA** account owner.
3. **No bell:** Shivani (actor, and recruiter isn't in this matrix anyway).

### A7 / A8. Candidate rejected / backed out → `candidate_rejected` / `candidate_backout`

Matrix roles: recruiter, sales, admin · Recipients: submission recruiter + sales owner + all admins.

1. **Actor: Sales or Admin.** Move a live submission → **Rejected** (reason
   required) — or **Backout**.
2. **Expect bell:** the **recruiter** who submitted the candidate; the **sales
   owner**; every **admin**.
3. **No bell:** whoever performed the move (actor); the **BDA**.
4. The row body includes the rejection / backout reason; click → `/submissions/:id`.

### A9. Offer sent → `candidate_offer`

Matrix roles: recruiter, sales, bda, admin · Recipients: submission recruiter + sales owner + account owner.

1. Drive a submission to `interview_result` with all rounds resolved, then
   **Actor: Recruiter or Admin** → move to **offer_sent**.
2. **Expect bell:** sales owner + BDA account owner (+ the recruiter if they
   weren't the actor).

### A10. Interview feedback submitted → `interview_feedback_submitted`

Covered in Part C4 (submitting from the calendar) — recipients are the submission
recruiter + sales owner.

**Matrix negative checks (should produce _no_ row):**

- A **recruiter** never gets `account_activated`, `requirement_created`, or
  `candidate_submitted_to_client` (not in those matrices) even if they're somehow
  a participant.
- A **BDA** never gets `requirement_assigned` / `interview_feedback_submitted`.
- The **actor** never gets their own event on any of the above.

---

## Part B — Interview scheduling → notifications

### B1. Schedule an internal round → `interview_scheduled`

1. **Actor: Recruiter** (`shivani.sinha`) on a submission she owns at
   `submitted_to_client` or later. Open the **Interview rounds** panel →
   **+ Add round** → round type **Internal Round 1** → set **Interview date & time**
   ~2 days out → **Interviewers**: pick `sarthak.solanki` → Save.
2. **Expect bell:**
   - `sarthak.solanki` (assigned interviewer) — "Interview scheduled … for <candidate>".
   - the **sales owner** of the requirement.
3. **No bell:** Shivani (actor).
4. Adding the first round on a `submitted_to_client` submission also bumps its
   stage to `interview_scheduled` (existing behaviour — no extra notification).

### B2. Schedule a client round as Sales → `interview_scheduled`

1. **Actor: Sales** (`tanvi.saxena`, owns the requirement). Same panel →
   **+ Add round** → **Client Round 1** → date → free-text interviewer name →
   Save. (Sales can only add client-facing rounds — internal types are hidden.)
2. **Expect bell:** the **recruiter** who submitted the candidate; assigned
   interviewers if any.
3. **No bell:** Tanvi (actor).

### B3. Reschedule → `interview_rescheduled`

1. **Actor: Recruiter.** Interview rounds panel → **Edit** the B1 round → change
   **only the date/time** → Save.
2. **Expect bell:** the assigned interviewer (`sarthak.solanki`) + sales owner —
   "Interview rescheduled … moved to <new time>".
3. Editing anything *other* than the time (e.g. meeting link) → **no**
   `interview_rescheduled` row.

### B4. Record a result from the panel → `interview_feedback_submitted`

1. **Actor: Recruiter.** Edit the round → set **Result = pass**, add **Feedback**
   text, **Rating** → Save.
2. **Expect bell:** sales owner (recruiter is the actor).
3. Round now shows `completed` status wherever it renders.

---

## Part C — Calendar

Open **Calendar** in the left nav (visible to every role). Route `/calendar`.

### C1. Views + toolbar

1. **Month view** (default on ≥ md screens): current month grid, Monday-start,
   today's date is a filled blue circle. Days with interviews show up to 3
   **pills** ("HH:MM · Candidate"), then **"+N more"**.
2. Click **"+N more"** → a side drawer lists that day's events.
3. Toggle **Agenda** → day-grouped cards with sticky "Today / Tomorrow / <date>"
   headers. The choice **persists across reload** (`localStorage`
   `delphic_calendar_view`).
4. **‹ / Today / ›** step months (Agenda shows a rolling 60-day window and the
   stepper label reads "Next 60 days").
5. **Legend** row: Internal / Client / HR-CxO / Cancelled dots. Pill left-border
   colour matches the round-type group.
6. Shrink the window below `md` → month grid is replaced by the agenda list, month
   toggle hidden.

### C2. Role scoping — who sees which events

Seed at least: one round where **recruiter X** submitted the candidate, one where
**recruiter Y** did, one with **sarthak** as an internal interviewer.

| Log in as | Scope toggle | Should see |
|---|---|---|
| **admin** | All | every round in the visible range |
| **sales** (`tanvi`) | All | rounds on requirements **she owns** + any where she's an interviewer |
| **bda** (`dheeraj`) | All | rounds on requirements against **accounts he owns** |
| **recruiter** (`shivani`) | All | rounds on submissions **she created** + where she's an interviewer |
| **recruiter** (`sarthak`) | My interviews | only rounds where he's an **assigned interviewer** |

- **My interviews vs All**: `mine` restricts to *submitted-by-me OR I'm an
  interviewer*. Recruiter defaults to `mine`, everyone else to `all`.
- **Status filter**: `scheduled / completed / cancelled / all`.
- A round dated outside the visible month (Month) or outside 60 days (Agenda)
  must **not** appear.

### C3. Event detail drawer

1. Click a pill (Month) or **Open details** (Agenda) → drawer with when / status /
   candidate (links to `/submissions/:id`) / requirement / account / interviewers /
   **Join meeting** button (only if a link is set and not cancelled) / feedback
   preview if present.
2. Drawer tone is **info**, or **danger** when the round is cancelled.

### C4. Submit feedback from the calendar → `interview_feedback_submitted`

1. Seed a round whose **scheduled time is in the past** and **not cancelled**,
   with `sarthak.solanki` as interviewer.
2. **Log in as `sarthak`.** Calendar → that event → **Submit feedback** (button
   only shows when the round has started, isn't cancelled, and you're allowed) →
   set Result / Rating / Feedback → Submit.
3. Success toast, drawer closes, calendar refetches. Result badge updates; status
   flips to **completed** for `pass/fail/no_show`.
4. **Cross-check:** open the candidate's submission → **Interview rounds** panel →
   the same values are there (it's the *same* `InterviewRound` row) and closure
   progress reflects it.
5. **Expect bell:** the **recruiter** who submitted the candidate + **sales owner**
   get `interview_feedback_submitted`. `sarthak` (actor) gets nothing.
6. **Negative:** log in as an unrelated recruiter → open the same event → **no
   "Submit feedback" button**; hitting `POST /api/v1/interviews/:id/feedback`
   directly returns **403**.

### C5. Cancel from the calendar → `interview_cancelled`

1. Seed a **future**, non-cancelled round.
2. **Log in as a manager** for it (the submitting recruiter, the sales owner for a
   client round, or an admin). Calendar → event → **Cancel interview** → type a
   **reason** → **Confirm cancel**.
3. **Month view:** the pill is now **struck-through + dimmed** with a small
   calendar-x icon, still clickable.
4. **Agenda view:** the card is dimmed with a red **"Cancelled — <reason>"** strip.
5. **Expect bell:** interview-round participants — submitting recruiter + sales
   owner + interviewers — get `interview_cancelled` (reason in the body). Actor
   excluded.
6. **Negative:** an unrelated user has **no Cancel button**; `POST
   /api/v1/interviews/:id/cancel` → **403**.

---

## Part D — Reminder cron → `interview_reminder`

The job runs in-process every 15 min (`ENABLE_JOBS`, default on). For testing,
invoke it directly instead of waiting.

1. Create / edit a round so `scheduled_at` is **~24 h from now** and status is
   `scheduled` (not cancelled).
2. Run once:
   ```bash
   cd server && node -e "require('./src/jobs/interviewReminders').run().then(r=>console.log(r))"
   ```
   → prints `{ sent: <n> }`.
3. **Expect bell** for every participant (submitting recruiter + sales owner +
   interviewers): "Upcoming interview … <time>".
4. **Run it again** → `{ sent: 0 }`, **no new rows** (deduped via
   `reminder_sent_at`).
5. Set another round to **~1 h out** and re-run → a fresh batch (T-1h window,
   `reminder_1h_sent_at`).
6. **Cancelled rounds are skipped** — set a ~24 h round to `cancelled`, run → not
   included in `sent`.

---

## Part E — Notification preferences

Route `/notifications/preferences` (bell popover footer → **Settings**).

1. The list shows **only event types relevant to your role** (e.g. a recruiter
   sees `requirement_assigned`, `interview_*`, `candidate_rejected/backout/offer`,
   … but not `account_activated`).
2. Each row: human label + description, an **In-app** toggle, and a **disabled
   Email** toggle with a "soon" badge.
3. Turn **`interview_reminder`** (or `requirement_assigned`) **off** → **Save** →
   success toast.
4. Re-trigger that event with this user as a recipient (e.g. re-run Part D, or
   have someone assign them) → **no bell row** for that type; other types still
   arrive.
5. **Reset to defaults** (button, top-right) → the override is deleted, the toggle
   returns to the role default, and the event delivers again.

---

## Quick regression checklist

- [ ] Bell badge appears, caps at `9+`, updates within 60 s / on tab focus.
- [ ] Clicking a notification marks it read (badge −1) and lands on the right record.
- [ ] "Mark all read" (popover + `/notifications`) zeroes the badge.
- [ ] `/notifications` — Unread / All filter, day grouping, **Load more**.
- [ ] Actor is never notified of their own action (spot-check 3 events).
- [ ] Role matrix: recruiter gets no `account_activated` / `requirement_created`;
      BDA gets no `requirement_assigned` (non-admin roles only).
- [ ] **Every active admin gets a copy of every event** — a non-participant admin
      still receives `requirement_created`, `interview_scheduled`, `interview_reminder`,
      etc.; an admin-actor is not self-notified; an admin who muted a type in
      Settings stops receiving it.
- [ ] Preference `in_app:false` suppresses exactly that type; Reset restores it.
- [ ] Calendar Month ⇄ Agenda toggle persists across reload.
- [ ] Calendar role scoping matches the table in C2; out-of-range rounds hidden.
- [ ] Cancelled round: struck-through pill (Month) + red strip (Agenda), still openable.
- [ ] Feedback from the calendar writes the same row shown in `InterviewRoundsPanel`.
- [ ] `Cancel` / `Submit feedback` buttons hidden for users who can't use them;
      the API returns 403 for them.
- [ ] Reminder job: one batch at T-24h, idempotent on re-run, skips cancelled.
- [ ] Notification fetch failure never shows a red page banner (kill the API mid-session).
