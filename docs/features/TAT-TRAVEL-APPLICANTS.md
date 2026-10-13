# Requirement TAT, Group Travel, In-progress jobs and Applicant pool (2026-10-13)

Status: built and committed locally on `super_admin_branch` (not pushed). Three additive migrations: `20261014090000_requirement_tat`, `20261014100000_group_travel`, `20261014110000_job_applicants`.

## 1. Requirement TAT (Delphic Global)

- `requirements.tat_hours` + `tat_ends_at`. A new requirement defaults to **24 hours**; Sales types a number plus Hours/Days in the create/edit form (right-side drawer). Changing the value on an existing requirement restarts the clock; saving with the same value does not. Older requirements have no TAT (no tag).
- Tag while the clock runs: **Super Active**; in the last quarter of the window (min 1 hour): **Expiring soon**. After it ends the requirement stays open but leaves the TAT tab and the tag disappears. Not-open requirements carry no tag.
- Recruiters: Requirements list has a **TAT Active** tab (count badge). That tab lists every running-TAT requirement (not only the assigned ones) so a recruiter can pick it up; the normal list stays "assigned to me". An unassigned recruiter cannot open the detail page (peek hides the links).
- Sales / admin can **extend** (`POST /requirements/:id/tat/extend {hours}`; +12h / +1d / +2d buttons on the detail page): counted from the end of the current window, or from now when it already ran out.
- Code: `requirements.service.js` (`tatInfo`, `extendTat`), `TatTag.jsx`, tests `server/tests/requirement-tat.test.js`.

## 2. Group Dashboard > Travel (next to Tasks & Weekly plan)

- Tables `group_travel`, `group_travel_travelers`, `group_travel_meetings`. A trip: title, from/to, dates, company (or whole group), purpose, **one total budget** (+ optional actual spent, over-budget flag), status planned/completed/cancelled, travellers (people of any company, IT or non-IT, or a typed guest).
- Meetings stay on the Delphic Global calendar; a trip links to them by calendar event id (`cm-<uuid>` follow-up meeting, `meeting-<uuid>` account meeting). From the trip you can **link an existing calendar meeting** or **add a new in-person meeting** with an active Delphic Global client (creates a real `ClientMeeting`, travellers become attendees). Unlinking never deletes the meeting.
- Calendar shows a **Travel · <destination>** tag on linked meetings (card + detail drawer).
- Delphic Global meetings only for now; budget is separate from finance (decided with the user). Super Admin only. Code: `groupTravel.service.js`, `GroupTravelTab.jsx`, test `group-travel.test.js`.

## 3. Pipeline > In-progress jobs and Applicants

- **In-progress jobs** view: every in-progress requirement with what a website post would carry (experience, budget if set, work mode, JD yes/no), applicant counts, "Add applicant" and a **Publish on website** button.
- **Applicants** view: pool (everyone unclaimed) and **My candidates**. "Assign to me" is **first come, first served** (conditional update, so two simultaneous clicks give one winner and one 409). Claiming creates or reuses the candidate **Profile** (match by email or phone, so one person applying to two requirements stays one Profile) and adds the recruiter to the requirement. Release puts the person back in the pool; admin can hand an applicant to a chosen recruiter. Same email/phone cannot apply twice to one requirement.
- **Stubs on purpose** (another developer builds the website side end to end with app scripts): `server/src/utils/websiteIntegration.js` (`publishRequirementToWebsite`, `unpublishRequirementFromWebsite`, `ingestWebsiteApplication` all throw "not connected"); `POST /applicants/requirements/:id/publish-website` returns 501 and the UI shows "Website not connected". The intake from the website must end by calling `applicants.service.addApplicant(user, body, { source: 'website' })`. LinkedIn sharing and the internal referral system are not built (phase 2).
- Code: `server/src/modules/applicants/*`, `ApplicantPoolBoard.jsx`, `WebsiteJobsBoard.jsx`, capability `viewApplicants` (admin, sales, recruiter), test `job-applicants.test.js`.

## 4. Also fixed: Capacity & Allocation

Signed (active) projects whose start date is still ahead now count as allocated ("Not started · starts in Nd") in Team Capacity; before, they and their people were left out (`allocations.service.js`, commit eaaaf81).

## Release notes

Nothing is pushed. Migrations apply automatically on Render boot; for production run `prisma migrate deploy`.
