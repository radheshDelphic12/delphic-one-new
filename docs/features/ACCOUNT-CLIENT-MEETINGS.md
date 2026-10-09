# Meetings with active clients / vendors (2026-10-09)

Accounts that are **Active** (client or vendor) can have any number of extra tracked meetings after onboarding. They never change the account stage (no stage_history row); the onboarding meeting (`accounts.meeting_*`) is untouched.

- UI: Account detail > **Meetings** (only when stage = active and not a project). Schedule meeting: title, online / in person, date + time, duration, location (in person) or link (online), notes, attendees. Row actions: Done, Cancel, Reopen, Edit, Delete. `client/src/pages/accounts/AccountClientMeetings.jsx`.
- Calendar: they join the interviews feed (`kind: client_meeting`, id `cm-<id>`, status scheduled / completed / cancelled, honours status / mine / audience filters). `interviews.service.js` (`listFollowUpMeetings`).
- API: `GET|POST /accounts/:id/meetings`, `PATCH|DELETE /accounts/:id/meetings/:meetingId`. Write = admin + BDA (like other account edits); 409 when the account is not active; 400 offline without a location.
- Schema: additive migration `20261009090000_client_meetings` (`client_meetings`, `client_meeting_attendees`, enum `ClientMeetingStatus`).
- Tests: `server/tests/accounts-client-meetings.test.js` (4). Staging click-through done with Playwright (BDA `dheeraj.kumar@delphic.in`).

Related, same day: sales users get a **My requirements / All requirements** pill on Requirements and the Job pipeline (`GET /requirements?scope=all`; others' requirements are read-only). Test: `tests/requirements-sales-scope.test.js`.
