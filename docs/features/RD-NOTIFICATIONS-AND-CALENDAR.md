# RD — In-Platform Notifications + Interview Calendar

> **Status:** Built (branch `feature/notifications-calendar`), pending full test run + manual QA. This is the canonical design + build spec; see §10 for as-built notes.
> **Owner:** TBD · **Created:** 2026-09-03 · **Built:** 2026-09-04
> Related: [API-Spec-and-Build-Plan.md](../architecture/API-Spec-and-Build-Plan.md) (v2 rows: email notifications, in-app bell, calendar integration), [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md).

---

## 1. Overview & goals

The platform (Express + Prisma backend, React + Vite frontend; roles `bda` / `sales` / `recruiter` / `admin` + an `is_superadmin` flag) today has **no notification system, no calendar, no job scheduler, and no realtime layer**. Stage transitions are audited only via `StageHistory` rows written inline inside `prisma.$transaction` service functions. Interviews (`InterviewRound`, a child of `Submission`) are only ever viewed nested inside a single submission — there is no "my interviews" view, and an assigned interviewer cannot record feedback unless they also hold a manager role.

This feature adds:

1. **Per-user, role-aware in-app notifications** for lifecycle events: account goes active, requirement created / assigned / unassigned / status-changed, interview scheduled / rescheduled / cancelled / reminder / feedback-submitted, candidate submitted-to-client / rejected / backout / offer.
2. **A Calendar page** (month grid + agenda) showing every user their scheduled and upcoming interviews with time, meeting link, candidate name, requirement/account and interviewers. Cancelled interviews are shown, marked **Cancelled**.
3. **A feedback mechanism** on the calendar that writes straight to the candidate's existing `InterviewRound` result / feedback / rating — the same data rendered in `InterviewRoundsPanel` and folded into closure progress. Assigned interviewers **and** managers may submit.
4. **Notifications to interviewers** on schedule / reschedule / cancel, plus **T-24h and T-1h reminders** via an in-process `node-cron` job.
5. **A per-user preferences table + settings UI** to toggle event types on/off.

Everything is structured so that **email and MS Teams calendar** are drop-in later: one dispatch choke point with a channel interface, a reserved `email` flag on preferences, and reserved `online_meeting_provider` / `external_event_id` columns on `InterviewRound`.

---

## 2. Decisions (confirmed)

| Question | Decision |
|---|---|
| Interview reminders | **Add `node-cron` now** — in-process scheduler, env-flagged off in tests. |
| Calendar UI | **Month grid + agenda**, both views. Cancelled interviews shown as **Cancelled**. |
| Notification preferences | **Per-user preferences table + settings UI** (not just a static code matrix). |
| Interview feedback access | **Assigned interviewers + managers** (recruiter / sales / admin who can today). |

---

## 3. Data model — one Prisma migration

Edit `server/prisma/schema.prisma`, then `cd server && npm run migrate` to generate the migration and commit it. Production applies it via `prisma migrate deploy` on deploy.

### `Notification` (new) — polymorphic link, like `Comment` / `Document`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid | recipient, `onDelete: Cascade` |
| `type` | `NotificationType` | see enum below |
| `title` | String | |
| `body` | String | |
| `entity_type` | `NotificationEntityType?` | link target kind |
| `entity_id` | uuid? | link target id |
| `actor_id` | uuid? | who triggered it (optional relation) |
| `metadata` | Json | `@default("{}")` — e.g. `{ submission_id }` for interview_round links |
| `read_at` | DateTime? | null = unread |
| `created_at` | DateTime | `@default(now())` |

Indexes: `@@index([user_id, read_at])`, `@@index([user_id, created_at])`, `@@map("notifications")`.

```prisma
enum NotificationType {
  account_activated
  requirement_created
  requirement_assigned
  requirement_unassigned
  requirement_status_changed
  interview_scheduled
  interview_rescheduled
  interview_cancelled
  interview_reminder
  interview_feedback_submitted
  candidate_submitted_to_client
  candidate_rejected
  candidate_backout
  candidate_offer
}

enum NotificationEntityType {
  account
  requirement
  submission
  interview_round
  profile
}
```

### `NotificationPreference` (new)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | `onDelete: Cascade` |
| `type` | `NotificationType` | |
| `in_app` | Boolean | `@default(true)` |
| `email` | Boolean | `@default(false)` — reserved for the future email channel |
| `created_at` / `updated_at` | DateTime | |

`@@unique([user_id, type])`, `@@map("notification_preferences")`.

**Semantics:** no row ⇒ fall back to the `ROLE_EVENT_MATRIX` default for the user's role. A row overrides.

### `InterviewRound` additions (all nullable / defaulted — no backfill)

| Field | Type | Purpose |
|---|---|---|
| `status` | `InterviewRoundStatus @default(scheduled)` | `scheduled` / `completed` / `cancelled` — orthogonal to `result`; drives the calendar "Cancelled" badge and reminder eligibility |
| `cancelled_at` | DateTime? | |
| `cancellation_reason` | String? | |
| `reminder_sent_at` | DateTime? | T-24h cron dedupe |
| `reminder_1h_sent_at` | DateTime? | T-1h cron dedupe |
| `online_meeting_provider` | String? | reserved for MS Teams (`manual` / `ms_teams`) |
| `external_event_id` | String? | reserved for MS Teams calendar event id |

```prisma
enum InterviewRoundStatus {
  scheduled
  completed
  cancelled
}
```

### Other model changes

- **`User`** — add back-relations for `Notification` (recipient + actor) and `NotificationPreference`.
- **`server/tests/helpers.js`** — add `notifications`, `notification_preferences` to the `cleanDatabase()` `TRUNCATE ... RESTART IDENTITY CASCADE` list; add a `createInterviewRound` helper if absent.

---

## 4. Backend

### 4.1 Dispatch layer — `server/src/lib/notifications/` (new)

A single choke point. Defensive: **never throws** — a notification bug must not roll back a business `$transaction`.

| File | Responsibility |
|---|---|
| `eventCatalog.js` | `ROLE_EVENT_MATRIX` — `{ [NotificationType]: { roles: [...], defaultInApp: true } }` (which roles are eligible for each event by default). `renderNotification(type, ctx)` → `{ title, body, entity_type, entity_id, metadata }` — plain string templates; email templates reuse the same `ctx` later. |
| `recipients.js` | Resolvers taking a Prisma client (`tx` or `prisma`): `admins(client)`, `requirementParticipants(client, requirementId)` (sales owner + active recruiter assignees + account owner), `submissionParticipants(client, submissionId)`, `interviewRoundParticipants(client, roundId)` (internal interviewer user_ids + submission recruiter + sales owner), `accountParticipants(client, accountId)`. Plus `isAssignedInterviewer(client, roundId, userId)`. |
| `dispatch.js` | `notify(client, { type, actorId, recipientIds, context })` — see algorithm below. |
| `index.js` | Re-exports `notify` + resolvers. |

**`notify` algorithm:**

1. Dedupe `recipientIds`; **fold in every active admin** (admins get a copy of every event, participant or not); drop `actorId` unless `context.notifySelf` (never notify someone of their own action).
2. One query for recipients' `role`; keep admins plus roles listed in `ROLE_EVENT_MATRIX[type].roles`.
3. Load `NotificationPreference` rows for `(remainingUserIds, type)`; skip any user whose row has `in_app === false` (this still lets an admin mute a type for themselves).
4. `renderNotification(type, context)` → `client.notification.createMany({ data: rows })`.
5. Wrap the whole body in `try/catch` → `logger.error('notification_dispatch_failed', { type, err })` and return.

**Channel interface (future):** in-app is channel #1. `emailChannel.send(envelope, user)` and `teamsChannel.send(envelope, user)` slot in at step 4, keyed off `pref.email` / a future `pref.teams`. Keep `renderNotification`'s output shaped as a generic "envelope" so channels can format from it.

Reuses `server/src/config/db.js` (Prisma singleton) and `server/src/config/logger.js`.

### 4.2 Call sites

Insert `await notify(tx, { ... })` immediately after the existing entity write / `stageHistory.create`, passing the same transaction client. Functions that use bare `prisma` pass `prisma`.

| Event | File · function | Recipients | `NotificationType` |
|---|---|---|---|
| Account → active | `accounts.service.js` · `changeStage` (guard `to_stage === 'active'`) | `accountParticipants` | `account_activated` |
| Requirement created | `requirements.service.js` · `create` (bare `prisma`) | account owner + admins + sales owner | `requirement_created` |
| Requirement assigned / unassigned | `requirements.service.js` · `assign` / `unassign` | the target user | `requirement_assigned` / `requirement_unassigned` |
| Requirement status changed | `requirements.service.js` · `changeStatus` | `requirementParticipants` | `requirement_status_changed` |
| Interview scheduled | `submissions.service.js` · `addInterviewRound` (after interviewers synced) | `interviewRoundParticipants` | `interview_scheduled` |
| Interview rescheduled | `submissions.service.js` · `updateInterviewRound` (only when `scheduled_at` changed) | `interviewRoundParticipants` | `interview_rescheduled` |
| Interview feedback submitted | `updateInterviewRound` + new `submitFeedback` (when result / feedback / rating set) | submission recruiter + sales owner | `interview_feedback_submitted` |
| Interview cancelled | new `cancelRound` | `interviewRoundParticipants` | `interview_cancelled` |
| Candidate submitted to client | `submissions.service.js` · `changeStage` `to_stage === 'submitted_to_client'` | sales owner + account owner | `candidate_submitted_to_client` |
| Candidate rejected / backout | `changeStage` `to_stage` in `rejected` / `backout` | submission recruiter + sales owner + admins | `candidate_rejected` / `candidate_backout` |
| Candidate offer | `changeStage` `to_stage === 'offer_sent'` | recruiter + sales owner + account owner | `candidate_offer` |

### 4.3 Notifications API — `server/src/modules/notifications/` (new, 4-file pattern)

Follow the `modules/comments` shape: `asyncHandler`, Zod `.parse`, a local `ERROR_STATUS` map, `ok` / `created` from `utils/response.js`. `router.use(authenticate)`. Mount `app.use('/api/v1/notifications', notificationsRoutes)` in `server/src/app.js`.

Routes (all scoped to `req.user.id`):

| Method + path | Behaviour |
|---|---|
| `GET /` | `?unread=1&limit=20&cursor=<iso>` — keyset on `created_at desc`. |
| `GET /unread-count` | `{ count }`. |
| `POST /read` | `{ ids: [uuid] }` — mark those read (filtered to `user_id`). |
| `POST /read-all` | Mark all the user's notifications read. |
| `GET /preferences` | Effective prefs: matrix defaults merged with rows, one entry per `NotificationType` relevant to the user's role. |
| `PUT /preferences` | `{ items: [{ type, in_app, email }] }` — upsert `NotificationPreference` rows for the current user. |

`notifications.service.js`: `list`, `unreadCount`, `markRead`, `markAllRead`, `getPreferences`, `setPreferences`, `serialize(row)`.

### 4.4 Interviews / Calendar API — `server/src/modules/interviews/` (new)

Mount `app.use('/api/v1/interviews', interviewsRoutes)`. `router.use(authenticate)`.

**`GET /`** — calendar feed. Query: `from`, `to` (ISO; default = current month), `mine` (`1`), `status`, `result`.

`interviews.service.js · listForCalendar(user, opts)`:

- Base `where`: `scheduled_at: { gte: from, lte: to }`.
- Role scoping mirrors `server/src/lib/entityAccess.js` + dashboard rules:
  - `admin` → all
  - `sales` → `submission.seat.requirement.sales_owner_id === user.id`
  - `bda` → `…requirement.account.owner_id === user.id`
  - `recruiter` → `submission.submitted_by === user.id`
  - **plus** every role also sees rounds where `interviewers.some(user_id === user.id)`
- `mine=1` → restrict to `submission.submitted_by === user.id` OR assigned interviewer.
- `include`: `submission → profile(name)`, `submission → seat → requirement(id, title) → account(name)`, `interviewers → user(id, name)`.
- `serializeCalendarEvent` → `{ id, submission_id, scheduled_at, duration_minutes, ends_at, status, round_type, round_type_label, round_name, result, meeting_link, candidate_name, requirement_id, requirement_title, account_name, interviewers: [{id,name}], interviewer_name, interviewer_email, can_submit_feedback }`. Use `ROUND_TYPE_LABELS` from `submissions/stageMachines.js`.

**`POST /:id/feedback`** — `{ result, feedback, rating, completed_at? }`.
Permission: `canManageInterviewRound(...)` (exported from `submissions.service.js`) **OR** the user is in `interview_round_interviewers`.
Updates only `result` / `feedback` / `rating` / `completed_at`; sets `status='completed'` when `result ∈ {pass, fail, no_show}`. Emits `interview_feedback_submitted`. Writes the **same `InterviewRound` row** shown in `InterviewRoundsPanel` and `utils/closureProgress.js`.

**`POST /:id/cancel`** — `{ reason }`.
Permission: `canManageInterviewRound`. Sets `status='cancelled'`, `cancelled_at`, `cancellation_reason`. Emits `interview_cancelled`.

Also add the reschedule `notify` call inside the existing `updateInterviewRound` so `PATCH /interview-rounds/:id` (used by `InterviewRoundsPanel`) stays consistent.

### 4.5 Reminder cron job

- Add dependency **`node-cron`** to `server/package.json`.
- `server/src/config/env.js` — add `jobs: { enabled: process.env.ENABLE_JOBS !== 'false' }` and a reserved `notifications: { email: {…}, msGraph: {…} }` placeholder. Document `ENABLE_JOBS` in `server/.env.example` and root `.env.example`. Set `ENABLE_JOBS=false` in `server/tests/env.setup.js`.
- `server/src/jobs/index.js` — `startJobs()`; called from `server/src/index.js` after `app.listen`, guarded by `env.jobs.enabled`.
- `server/src/jobs/interviewReminders.js` — export `run()`; `cron.schedule('*/15 * * * *', run)`:
  - **T-24h:** `status='scheduled'`, `scheduled_at` in `[now+23h45m, now+24h15m]`, `reminder_sent_at IS NULL` → `notify(prisma, { type: 'interview_reminder', recipientIds: interviewRoundParticipants(...), context })`, then set `reminder_sent_at`.
  - **T-1h:** same with `reminder_1h_sent_at` and a ~1h window.
  - Per-round `try/catch`; log a summary count.

**Single-instance caveat:** the current deploy is one server container (see [DEPLOY-RUNBOOK.md](../guides/DEPLOY-RUNBOOK.md)), so a plain in-process cron is safe. If the API is ever scaled horizontally, move this to a single-runner (leader election, a dedicated worker, or a real queue).

---

## 5. Frontend

### 5.1 UX principles (apply to every screen)

- **Match the existing design system exactly.**
  - Panels: `rounded-2xl border border-tertiary-100 bg-white shadow-card`.
  - Section headers: `border-b border-tertiary-100 px-4 py-3 font-heading text-sm font-semibold text-tertiary-900`.
  - Lists: `divide-y divide-tertiary-100` rows with `hover:bg-tertiary-50/80` and a trailing `<ChevronRight className="h-4 w-4 text-tertiary-400" />`.
  - Buttons: `btn-primary` / `btn-secondary` / `btn-ghost`. Slide-overs: the existing `Drawer` with a `tone`.
  - Status pills: reuse `components/ui/Badge.jsx` (extend `COLOR_MAP` with `scheduled`, `completed`, `cancelled`).
  - Motion: the `cardMotion` variant used in `DashboardPage.jsx`. Icons: `lucide-react` only.
- **Zero dead ends.** Every notification and every calendar event links to the underlying record. Every empty state uses `EmptyState` with a next action ("No interviews this week — schedule one from a submission").
- **Read state is obvious and cheap.** Unread = left accent bar + tinted row (`bg-primary-50/40`) + a dot; opening or clicking marks read; "Mark all read" is always one click away; the bell badge caps at `9+`.
- **Never block the page on notifications.** All notification fetches are non-critical — failures are swallowed (no red banner); the bell shows its last-known state.
- **Respect role + permissions in the UI**, but the server stays source of truth. Hide "Cancel" / "Submit feedback" / "All interviews" controls the user cannot use, mirroring how `InterviewRoundsPanel` hides the Edit button via `canManageInterviewRound`.
- **Responsive.** The bell dropdown becomes a full-width sheet under `sm`; the calendar month grid collapses to the agenda list under `md` (month toggle hidden), matching the mobile-drawer pattern in `AppLayout`.
- **Accessibility.** Bell button: `aria-haspopup="menu"`, `aria-expanded`, live `aria-label={"Notifications, N unread"}`. Dropdown `role="menu"`; Esc closes. Calendar day cells are real `<button>`s with an `aria-label` date. Focus returns to the trigger on close.

### 5.2 State — `client/src/lib/notifications/notificationsContext.jsx`

`NotificationsProvider` + `useNotifications()` → `{ items, unreadCount, loading, reload, markRead, markAllRead, loadMore, hasMore }`.

- On mount (when `user`): `GET /notifications?limit=20` + `GET /notifications/unread-count`.
- Poll `GET /notifications/unread-count` every 60s via `setInterval`, cleared on unmount. Pause while `document.hidden`; refetch immediately on `visibilitychange` back to visible. A comment marks this as the SSE / WebSocket swap-in point.
- Optimistic `markRead` / `markAllRead` (update local state first, reconcile on response).
- When the unread count rises between polls, `pushInfo` via `useAlerts` once ("You have new notifications") — not one toast per item.
- Add `<NotificationsProvider>` to `client/src/main.jsx` just inside `AuthProvider` (so it can read `user`), wrapping `AlertProvider` / `App`.

### 5.3 Bell — `client/src/components/notifications/`

- **`NotificationBell.jsx`** — trigger button (lucide `Bell`, `h-5 w-5`) with an unread-count badge (`absolute -top-1 -right-1 rounded-full bg-danger-600 text-white text-[10px]`, shows `9+`). Opens a `framer-motion` popover reusing the exact pattern from `AppLayout.jsx`'s account menu (`role="menu"`, outside-click ref, `initial` / `animate` / `exit` y-fade). Panel: max `h-[70vh]`, `w-[min(100vw,22rem)]`, sticky header ("Notifications" + "Mark all read"), scrollable body of `NotificationItem`s (latest 20), sticky footer with two links — "View all" → `/notifications`, "Settings" → `/notifications/preferences`.
- **`NotificationItem.jsx`** — icon chip by `type` (assignment → `UserPlus`; interview / rescheduled → `CalendarClock`; cancelled → `CalendarX`; reminder → `AlarmClock`; rejected / backout → `UserX`; offer → `BadgeCheck`; account_activated → `Building2`; feedback → `MessageSquareText`; default → `Bell`), title (semibold), one-line body (`line-clamp-2`), relative time (`formatRelative` helper — "2h ago", "Yesterday"). Unread: `bg-primary-50/40` + `border-l-2 border-l-primary-600` + a `bg-primary-600` dot. Click → `markRead([id])` then `navigate(entityLink(item))` and close.
- **`notificationLinks.js`** — `entityLink({ entity_type, entity_id, metadata })`: `account` → `/accounts/:id`; `requirement` → `/requirements/:id`; `submission` → `/submissions/:id`; `profile` → `/profiles/:id`; `interview_round` → `/submissions/${metadata.submission_id}#interview-rounds` (add an `id="interview-rounds"` to the panel `<section>` in `InterviewRoundsPanel.jsx`). Also used by `/calendar` and `NotificationsPage`.
- **Placement:** `AppLayout.jsx` `<header>`. Turn the current title block into a `flex items-start justify-between` row — title / subtitle on the left, a right-aligned actions cluster holding `<NotificationBell />` (with room for future help / settings icons per [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md)). On mobile, keep the bell in the same top row as the `Menu` button so it is reachable one-handed.

### 5.4 Notifications pages — `client/src/pages/notifications/`

- **`NotificationsPage.jsx`** (route `/notifications`) — full history. Header row: title + a **Unread / All** segmented control (reuse `FilterChip` styling) + "Mark all read". Body: `NotificationItem` rows in a `divide-y` panel, grouped by day with sticky sub-headers ("Today", "Yesterday", "Mar 12"). `loadMore` button (or intersection observer) driving `?cursor=`. `EmptyState` ("You're all caught up") when empty.
- **`NotificationPreferencesPage.jsx`** (route `/notifications/preferences`, also reachable as a tab on the notifications page) — one `rounded-2xl` panel; a row per user-relevant `NotificationType` (only types whose `ROLE_EVENT_MATRIX` includes the user's role). Left: human label + one-line description. Right: an **In-app** toggle switch and a disabled **Email** toggle with a small "Soon" `Badge`. "Save" is explicit (`btn-primary`, disabled until dirty) → `PUT /notifications/preferences`; success toast. "Reset to defaults" (`btn-ghost`) deletes overrides.
- **`components/ui/Toggle.jsx`** (new, generic) — peer-checked Tailwind switch; none exists today.

### 5.5 Calendar — `client/src/pages/calendar/`

Route `/calendar`. Add a `NAV_ITEMS` entry `{ to: '/calendar', label: 'Calendar', icon: CalendarDays }` in `client/src/components/layout/navItems.js` (no `capability` — every role, interviewers included). Add title / subtitle mappings in `client/src/components/layout/headerTitle.js`.

- **`CalendarPage.jsx`** — owns state:
  - `view` — `month` | `agenda`, persisted in `localStorage` key `delphic_calendar_view`.
  - `anchor` — first day of the visible month.
  - `scope` — `mine` | `all`; default `mine` for `recruiter`, else `all`; the toggle is hidden for a pure interviewer who has no "all".
  - `statusFilter` — `all` | `scheduled` | `completed` | `cancelled`.
  - Fetches `GET /interviews?from&to&mine&status` for the visible month (agenda view fetches a rolling 60-day forward window). Loading → `Skeleton` rows; error → inline `EmptyState` with Retry (never a page-blocking crash).
  - **Toolbar** (one `flex flex-wrap items-center gap-2` bar, styled like `ListToolbar`): `‹` / `Today` / `›` month stepper with the month label as an `<h2>`; a **Month | Agenda** segmented toggle (`Columns3` / `List` icons); a **My interviews | All** segmented toggle (when allowed); a status `SearchableSelect`; a small legend (colored dots: internal, client, HR/CxO, cancelled).
- **`monthGrid.js`** — pure helpers, native `Date` only (no date lib, matching the codebase): `buildMonthMatrix(anchor)` → 6×7 array of `{ date, inMonth, isToday }` (Monday-start); `sameDay(a, b)`; `groupEventsByDay(events)` → `Map<yyyy-mm-dd, event[]>` sorted by time; `formatTimeRange(start, durationMin)`.
- **`CalendarMonthView.jsx`** — CSS `grid grid-cols-7`. Weekday header row. Each day cell: `min-h-28`, date number (today = `bg-primary-600 text-white` circle), then up to 3 event pills + "+N more" (opens that day's agenda in a `Drawer`, tone `info`). Pill = **`EventPill.jsx`**: `truncate` "HH:MM · Candidate", left border color by `round_type` group. **Cancelled** pill: `line-through`, `opacity-60`, a tiny `CalendarX` icon; still clickable. Click pill → `EventDetailDrawer`.
- **`CalendarAgendaView.jsx`** — day-grouped list (sticky day sub-headers like the notifications page). Each event = **`EventCard.jsx`**:
  - Line 1: time range (`09:00–09:45`) · `round_type` `Badge` · status `Badge` (Scheduled / Completed / **Cancelled**) · result `Badge` when not pending.
  - Line 2: **candidate name** (bold, links to `/submissions/:submission_id`) · requirement title · account name.
  - Line 3: interviewers (`AvatarStack` of internal `interviewers`, or the free-text `interviewer_name`) · a **Join** `btn-secondary` opening `meeting_link` in a new tab (hidden if no link) · relative time ("in 2 days", "3h ago").
  - Actions row (only what the user may do): **Open candidate** (always); **Submit feedback** (round is past / started, not cancelled, `can_submit_feedback`); **Reschedule** (managers → navigate to the submission's `InterviewRoundsPanel` edit flow, or a shared drawer); **Cancel** (managers, future-dated → confirm `Modal` with a reason field).
  - Cancelled card: whole card `opacity-70`, a `bg-danger-50 text-danger-700` "Cancelled" strip with the `cancellation_reason`.
- **`EventDetailDrawer.jsx`** — `Drawer` (`size="md"`, tone `info`, or `danger` when cancelled). All fields, a large **Join meeting** button, the same actions as the agenda card, and a compact **feedback preview** (result, rating stars, feedback text) when present.
- **`FeedbackDrawer.jsx`** — `Drawer` tone `edit`. Fields: **Result** select (`pending` / `pass` / `fail` / `no_show`), **Rating** 1–10 (reuse the numeric input style from `InterviewRoundsPanel`), **Feedback** textarea. Submit → `POST /interviews/:id/feedback` → success toast, close, refetch calendar. Validation mirrors `InterviewRoundsPanel` (`runValidations`, `fieldErrorClass`).
- **Shared:** extract the round-type color / label map from `InterviewRoundsPanel.jsx` into **`client/src/lib/interviewRounds.js`** and import it from the panel, the calendar, and pipeline chips. Reuse `client/src/lib/submissionStages.js` (`roundTypeLabel`, `canManageInterviewRound`).

### 5.6 Dashboard widget (small — include if low effort)

Add a "My upcoming interviews" panel to `DashboardPage.jsx` for every role: a `divide-y` list of the next 5 events from `GET /interviews?mine=1&from=now&to=+14d`, each row "Tomorrow 10:00 · Candidate · Client R1" linking to `/submissions/:id`, with a footer link "Open calendar →". Styled exactly like the existing `StuckLeadsPanel`.

### 5.7 Routing

In `client/src/app/App.jsx`, add as children of the protected `AppLayout` route: `/calendar`, `/notifications`, `/notifications/preferences`. No new `RequirePermission` wrappers (all roles).

---

## 6. Extension points for email + MS Teams

| Concern | Where it plugs in |
|---|---|
| Email delivery of any notification | `lib/notifications/dispatch.js` step 4 — add `emailChannel.send(envelope, user)` keyed off `NotificationPreference.email`. `renderNotification` already returns a channel-agnostic envelope. |
| Per-user email opt-in UI | `NotificationPreferencesPage` — enable the currently-disabled Email toggle column. |
| MS Teams online meeting on schedule | `submissions.service.js · addInterviewRound` / `updateInterviewRound` — call MS Graph, store the returned join URL in `meeting_link`, set `online_meeting_provider='ms_teams'` and `external_event_id`. |
| MS Teams / Outlook calendar events for interviewers | Same call sites — create/patch/delete calendar events using `external_event_id`; delete on `cancelRound`. |
| Config | `server/src/config/env.js` `notifications: { email, msGraph }` placeholder block; document new vars in `.env.example` files. |
| Reminders at scale | Replace the in-process cron with a single-runner / queue (see §4.5 caveat). |

---

## 7. Test plan (`server/tests/`, Jest + supertest against the test DB)

- **`notifications.test.js`** — assign a requirement → the assignee gets a row; reject a submission → recruiter + sales get rows; the actor is never notified of their own action; `GET /`, `/unread-count`, `/read`, `/read-all`; a `NotificationPreference` with `in_app:false` suppresses that type.
- **`interviews-calendar.test.js`** — rounds seeded across dates / owners: `GET /interviews?from&to` returns only in-range + role-scoped rows; `mine=1` filters to assigned interviewer / recruiter; a cancelled round returns `status:'cancelled'`; `POST /interviews/:id/feedback` is allowed for an assigned interviewer, `403` for an unrelated user, and writes `result` / `feedback` / `rating` and flips `status`; `POST /interviews/:id/cancel` sets the fields and creates notifications.
- **`interview-reminders.test.js`** — call `interviewReminders.run()` directly: a round ~24h out → reminder notifications created once, `reminder_sent_at` set; a second run is a no-op.
- Update `server/tests/helpers.js` — truncation list + a `createInterviewRound` helper if absent.

---

## 8. Rollout checklist / sequencing

- [x] **0. Docs** — this file + `docs/features/README.md`; wire `docs/AGENTS.md` (Docs-layout table + Features section), `docs/progress/TODO.md` backlog block, and mark the three v2 rows in `docs/architecture/API-Spec-and-Build-Plan.md`.
- [x] **1. Schema** — Prisma models + enums + `InterviewRound` columns; `npm run migrate` (`20260903110804_notifications_and_calendar`); `helpers.js` truncate list + `createInterviewRound` helper.
- [x] **2. Dispatch layer** — `lib/notifications/` (`eventCatalog` / `recipients` / `dispatch` / `index`) + `modules/notifications` API + mount.
- [x] **3. Call sites** — accounts `changeStage`; requirements `create` / `assign` / `unassign` / `changeStatus`; submissions `addInterviewRound` / `updateInterviewRound` (reschedule + feedback) / `changeStage`.
- [x] **4. Interviews API** — `modules/interviews` (`GET /`, `POST /:id/feedback`, `POST /:id/cancel`) + mount; feedback permission = manager **or** assigned interviewer.
- [x] **5. Cron** — `node-cron` dep + `jobs/index.js` `startJobs()` + `jobs/interviewReminders.js` + `env.jobs.enabled` (`ENABLE_JOBS`) + `index.js` wiring; `ENABLE_JOBS=false` in `tests/env.setup.js`.
- [x] **6. Frontend shared bits** — `client/src/lib/interviewRounds.js`; `components/ui/Toggle.jsx`; `Badge.jsx` `COLOR_MAP` += `scheduled`/`completed`/`cancelled`; `id="interview-rounds"` on the panel section.
- [x] **7. Frontend features** — `NotificationsProvider` (in `main.jsx`, inside `AlertProvider`) + bell + `/notifications` + `/notifications/preferences`; `/calendar` (page → `monthGrid.js` → month / agenda views → `EventDetail` / `Feedback` drawers); routes; `Calendar` nav item + header title/subtitle. Dashboard widget: deferred (optional).
- [x] **8. Tests + finalize docs** — `notifications.test.js`, `interviews-calendar.test.js`, `interview-reminders.test.js`; as-built notes below; boxes ticked; dated `PROGRESS.md` entry; bell noted in `UI-UX-JIRA.md`; `ENABLE_JOBS` in `DEPLOY-RUNBOOK.md`. **Full `server` test run + browser QA still pending** (local Docker DB was down at build time).

---

## 9. Verification

- `cd server && npm run migrate` then `npm test` — all suites green, including the three new ones.
- Manual (`bash start-platform.sh`), logging in as different roles:
  - **sales** — create a requirement on an active client → assign a recruiter → the recruiter's bell shows "You were assigned…".
  - **recruiter** — add an interview round with an internal interviewer → the interviewer's bell + `/calendar` (Month and Agenda) show it; reschedule → "rescheduled" notification.
  - **from calendar** — cancel a future round → "Cancelled" pill + `interview_cancelled` notifications.
  - **interviewer** — open an event → "Submit feedback" → the value appears in the candidate's `InterviewRoundsPanel`, and the recruiter gets `interview_feedback_submitted`.
  - **UI** — bell badge updates within 60s; clicking a notification marks it read, closes the panel, and lands on the right record; the Month ⇄ Agenda toggle persists across reloads; a cancelled interview is struck-through in Month view and has a red "Cancelled" strip in Agenda; the calendar collapses to agenda-only under `md`.
  - **any** — reject a candidate → recruiter + sales + admins notified.
  - **preferences** — turn off `interview_reminder` in-app, re-run the cron job → that user is skipped.
  - **reminders** — set a round `scheduled_at` ~24h out, run `node -e "require('./src/jobs/interviewReminders').run()"` → one reminder notification per participant; re-run → no-op.

---

## 10. As-built notes (2026-09-04)

Built on branch `feature/notifications-calendar` (server WIP commit `5fb7741`, `main` merged in, frontend commit follows). Follows the spec; deltas below.

**Backend**

- Migration `20260903110804_notifications_and_calendar` — `notifications` + `notification_preferences` tables, `NotificationType` (14) / `NotificationEntityType` (5) / `InterviewRoundStatus` (3) enums, `interview_rounds` gains `status` + `cancelled_at` + `cancellation_reason` + `reminder_sent_at` + `reminder_1h_sent_at` + `online_meeting_provider` + `external_event_id`, plus a `@@index([status, scheduled_at])`.
- `lib/notifications/` — `eventCatalog.js` (`ROLE_EVENT_MATRIX` + `NOTIFICATION_LABELS` + `eventsForRole` + `renderNotification`), `recipients.js`, `dispatch.js` (`notify` — try/catch around the whole body, `logger.error('notification_dispatch_failed')` on any failure), `index.js` re-exports. `notify(client, …)` takes the caller's Prisma client (`tx` or the singleton).
- **Admins get everything (2026-09-07):** `notify()` folds every active admin into the recipient set for *every* event type, independent of `ROLE_EVENT_MATRIX` and the per-event recipient resolvers. Actor-exclusion still applies (an admin who performed the action is not self-notified) and an admin can still mute a type via `NotificationPreference`. `admin` stays in every `roles` list purely so the preferences UI offers admins the full set of toggles. Costs one extra `user.findMany({ role: 'admin' })` per dispatch.
- `modules/notifications/` — `GET /`, `GET /unread-count`, `POST /read`, `POST /read-all`, `GET /preferences`, `PUT /preferences`, **`DELETE /preferences`** (reset-to-defaults; not in the original route list). Keyset pagination on `created_at desc` via `?cursor=<iso>`; responses carry `has_more` + `next_cursor`.
- `modules/interviews/` — `GET /` (role scoping mirrors `entityAccess` + assigned-interviewer OR-clause; `mine=1`; `from`/`to` default to the current month), `POST /:id/feedback`, `POST /:id/cancel`. `serializeCalendarEvent` includes `can_submit_feedback`. Reschedule + feedback `notify` calls were added to `submissions.service.updateInterviewRound` (so `PATCH /interview-rounds/:id` stays consistent), not duplicated in the interviews module.
- Cron — `env.jobs.enabled = NODE_ENV !== 'test' && ENABLE_JOBS !== 'false'`. `interviewReminders.run(now?)` scans two windows (T-24h ±15m via `reminder_sent_at`, T-1h 45–75m via `reminder_1h_sent_at`), per-round try/catch, returns `{ sent }`. `schedule()` wires `*/15 * * * *`. `env.notifications` reserved block (`email` / `msGraph`) added; nothing reads it.

**Frontend**

- `NotificationsProvider` sits **inside** `AlertProvider` in `main.jsx` (the spec said "wrapping AlertProvider", but the provider calls `useAlerts().pushInfo` for the "new notifications" nudge, so it must be a child of `AlertProvider`). Still inside `AuthProvider`, reads `user`.
- 60s `unread-count` poll, paused while `document.hidden`, immediate refetch on `visibilitychange`. Every notification fetch swallows errors and keeps last-known state.
- `lib/interviewRounds.js` — the round-type list/colors were lifted out of `InterviewRoundsPanel.jsx` verbatim and re-imported there; added `group` + `ROUND_GROUP_BORDER` + `ROUND_GROUP_LEGEND` for the calendar.
- Calendar month view collapses to the agenda list under `md` (rendered inline, not a separate route). "All / My interviews" scope toggle is always shown (defaults `mine` for recruiter, `all` otherwise) rather than hidden for pure interviewers.
- Dashboard "My upcoming interviews" widget — **not built** (spec marked it optional / low-effort-only).

**Pending**

- Full `cd server && npm test` (local Docker Postgres on `:5434` was down at build time; targeted suites — submissions / interviews / accounts / requirements — were green pre-merge).
- Browser click-through per §9.
