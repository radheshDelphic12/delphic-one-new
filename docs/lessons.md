# Lessons

## 2026-09-07: Calendar My interviews / All identical for recruiters

**Root cause:** `listForCalendar` applied the same OR for recruiter `mine=1` and recruiter All (`submitted_by` OR interviewer). All never included `RequirementAssignment`, so the toolbar toggle did nothing for recruiters. BDA All was also narrowed to `account.owner_id` while the rest of the app treats BDA like admin for requirement visibility.

**Failure symptoms:** Switching My interviews ↔ All on `/calendar` showed the same events for recruiters; role-scoped “All” felt broken for BDA/recruiter.

**Fix details:** Mine is always personal (`submitted_by` OR assigned interviewer). All is role-scoped: admin/bda = unrestricted; sales = owned requirements; recruiter = own submissions + interviewer + assigned requirements. Added Jest coverage for sales and recruiter Mine vs All.

**Consulted sources:** `interviews.service.js`; `requirementScope.js`; `RD-NOTIFICATIONS-AND-CALENDAR.md`; `interviews-calendar.test.js`.

**Prevention guidance:** When adding Mine/All (or similar) toggles, assert Mine ⊊ All for each role in tests; never reuse the personal OR clause as the role-scoped All filter.

## 2026-08-31: Docker CI login smoke used stale @delphic.local email

**Root cause:** Team seed was switched to real `*@delphic.in` addresses (`team-roster.js`), but `.github/workflows/ci.yml` docker-smoke still POSTed `admin@delphic.local` / `Password123!`. Curl `-f` treats the 401 as exit 22.

**Failure symptoms:** CI step `Login smoke` failed with `Error: Process completed with exit code 22` on the `RESP=$(curl -sf -X POST …/auth/login …)` line after a successful seed.

**Fix details:** Point CI login + client-proxy smoke at `admin@delphic.in`. Updated README / AGENTS seeded-user examples to match.

**Consulted sources:** `.github/workflows/ci.yml`; `server/prisma/team-roster.js`; curl man page (exit 22 = HTTP error with `-f`).

**Prevention guidance:** When changing seed emails or passwords, grep the repo (especially CI workflows and smoke scripts) for the old credentials in the same change.

## 2026-08-31: PipelineFilters inline fields array caused API request storm / 429


**Root cause:** Job/Candidate/Lead boards passed `fields={[...]}` inline. `PipelineFilters` keyed `useMemo`/`useEffect` on that array reference, so every parent re-render re-fetched `/users` and `/accounts`, which tripped `express-rate-limit` (and browser `ERR_INSUFFICIENT_RESOURCES`). Login 429s were a separate tight `max: 5/min` cap.

**Failure symptoms:** Flood of `users?role=recruiter` and `accounts?type=client` in Network; 429 on login and after login.

**Fix details:** Stabilize filter field lists with a content `fieldsKey`; skip `onChange` when API params JSON is unchanged; raise login limit to 30/min and API to 1200/min.

**Consulted sources:** Browser Network panel; `server/src/app.js` rate limiters; `PipelineFilters.jsx` effect deps.

**Prevention guidance:** Never put an inline array/object in a React effect dependency without a stable content key; prefer module-level constants for prop lists.

## 2026-08-21: ChangePasswordModal wrong relative imports broke Docker client build

**Root cause:** `ChangePasswordModal.jsx` lives under `client/src/components/`, but imported `apiClient` as `../../lib/apiClient` (resolves outside `src`) and `Modal` as `../ui/Modal.jsx` (one level too high). Sibling components correctly use `../lib/apiClient.js` and `./ui/Modal.jsx`.

**Failure symptoms:** `docker compose up -d --build` failed on client Vite build: `Could not resolve "../../lib/apiClient" from "src/components/ChangePasswordModal.jsx"`.

**Fix details:** Changed imports to `../lib/apiClient.js` and `./ui/Modal.jsx`. Local and Docker client builds then succeeded (923 modules).

**Consulted sources:** Vite/Rollup error output; sibling imports in `NotesPanel.jsx` / `UnlockButton.jsx`.

**Prevention guidance:** When adding a file under `src/components/`, match existing component import depths; run `npm run build --workspace client` before relying on Docker image build.
