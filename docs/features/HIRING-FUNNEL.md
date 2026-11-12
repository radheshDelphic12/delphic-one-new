# Hiring funnel (Reports > Hiring funnel)

Built 2026-10-30. Live on staging and production (main `b9f039c`). Read-only: **no migration, no new table**.

A funnel report for the recruiter team: profiles **sourced** in the chosen dates, followed round by round through the Internal hiring and
Client hiring funnels, with a recruiter-wise breakdown, a week / month trend, the average time from sourcing to joined, and Excel / PDF
export. Every count opens the profiles behind it.

## Rule that drives everything: the cohort
- **Cohort = profiles whose sourcing date (`profiles.created_at`) is inside the chosen dates** (the same anchor as HR reports >
  Sourcing; bench people, `on_bench = true`, are left out like there).
- What happens to them later, even after the end date, is counted. Their finalising date is ignored. 100 profiles sourced 1-30 Oct
  are one cohort, however many finish in November.

## What the screen shows
- **Summary cards** (all clickable): Sourced (+ "n not submitted anywhere"), Submitted, First round cleared, Reached a client round,
  Selected / joined, Dropped / In progress, Avg time sourcing -> joined (with median and joiner count).
- **One funnel per track** (bar chart + table). Stages by position, named from the interview templates:
  - Client hiring: Sourced -> Screening -> Submitted to client -> Client Round 1..n -> MD round -> Offer sent -> Selected / Joined.
  - Internal hiring: Sourced -> Screening -> L1, L2, L3 (the template's Delphic interviews in order, names shown under the label) -> MD round -> Offer sent -> Selected / Joined.
  - Per stage: Came, Passed, Not held, Dropped, In progress, Data unavailable, Pass rate, Avg days from sourcing.
  - **Client Round 1** has its own call-out with the pass-through rate.
- **Recruiter-wise table** (sourced, submitted, first round cleared, reached a client round, selected, dropped, in progress, first round % /
  client round % / selected %, avg days to join, plus a "Whole team" row; cells below the team rate are amber).
- **Week-wise / Month-wise table** by sourcing date (or no breakup).
- **Assumptions** panel (returned by the API, so the UI and the export say the same thing).
- Filters: Today / This week / This month / Last month / This quarter / Last quarter / YTD / Custom, recruiter (profile's `added_by`),
  client (requirement's account), service type (Client hiring vs Internal hiring), breakup, and the checkbox
  **"Count rounds that were not held as passed"** (on by default; the numbers are the same, unticking only splits them out and highlights
  the stages with rounds that were not held).

## Definitions (decisions taken when the owner said "go ahead" without answering the open questions; change them in `hiringFunnel.service.js`)
| Term | Rule |
|---|---|
| Unit | A **profile**. A profile submitted to several requirements counts once per funnel, at its furthest submission in that funnel. |
| Passed | `InterviewRound.result = 'pass'`. |
| Dropped | The round result is `fail`, or the submission is `rejected` / `backout` while waiting at that stage (counted at the first stage not yet cleared). A candidate who simply has not moved on is **In progress**, not dropped. Round `fail` never moves the submission by itself. |
| Not held (assumed pass) | An optional template round with no record although the candidate moved on, or a round with result `skipped` (bench skip, see BENCH-SKIP-FIRST-ROUND.md). Counted as Passed while the checkbox is on. |
| Data unavailable | A **mandatory** round with no record although the candidate moved on, and old submissions without round records. Not counted as a pass. |
| Not applicable | A round the requirement's own template does not have (e.g. L3 on the non-technical template) is left out for that candidate. |
| First round cleared | Screening outcome is Passed, Not held **or Data unavailable** (they moved on past it). Never lower than "reached a client round", so no rate is above 100%. |
| Reached a client round | Has any outcome at Client Round 1 (including pending / dropped there). |
| Selected / Joined | The submission reached `closed` (stage history). Offer sent = history `offer_sent` / `bgv` / `closed`. |
| Days to join | Sourcing date -> first `closed` in stage history. Avg + median over joiners. |
| Old rounds | internal_r1 = Screening, internal_r2 = L1 (Internal) or Screening (Client), client_r1-3 = Client Round 1-3, hr_cto_ceo = MD round. |

## Backend
- `server/src/lib/funnel.js` - **generic, recruiting-free helpers** (`tallyFunnel`, `average`, `median`, `daysBetween`, `bucketOf` for IST
  weeks / months). Outcomes per stage: `passed | assumed | dropped | pending | unavailable`. **Reuse this for the planned Sales funnel**
  (requirement created -> meetings -> submitted -> closed): define the stages and the per-entity outcomes, call `tallyFunnel`.
- `server/src/modules/reports/hiringFunnel.service.js` - `loadCohort` (profiles -> submissions -> rounds + stage history + templates,
  chunked by 5000), `hiringFunnel` (numbers), `hiringFunnelDetails` (profiles behind a count, max 1000 rows).
- Routes in `reports.routes.js` (same guard as HR reports: admin, or `reports.hr` on a permission-mode company):
  - `GET /api/v1/reports/hiring-funnel?date_from&date_to&sourcer_id&client_id&service_type=internal|client&group_by=none|week|month`
  - `GET /api/v1/reports/hiring-funnel/details` - same filters plus `metric` (sourced, submitted, not_submitted, first_round_cleared,
    reached_client_round, selected, dropped, in_progress) **or** `track` + `stage` + `outcome` (reached | passed | assumed | dropped | pending
    | unavailable, comma separated), optional `bucket`.
  - `GET /api/v1/reports/export?report=hiring-funnel&type=xlsx|pdf` - sheets: Summary, one per funnel, By recruiter, Trend, Assumptions.
- `server/src/lib/access/routeRules.js`: `/reports/(hr|hiring-funnel)` -> `['reports.hr']`.
- `reports.validation.js`: `hiringFunnelSchema`, `hiringFunnelDetailsSchema`.

## Frontend
- `client/src/pages/reports/HiringFunnel.jsx` (its own screen like `MonthlyReview.jsx`: loads its own data, owns the FilterBar and the export
  buttons), wired in `ReportsPage.jsx`; `reportViews.js` entry `hiring-funnel` (admin, permission `reports.hr`).
- Counts are `Count` buttons (zero stays plain text) that open `DetailsDrawer` (candidate -> profile link, sourced on, recruiter, client /
  requirement, status, result at that stage, days from sourcing, submission link).
- Recharts stacked horizontal bars; no new dependency.

## Tests
- `server/tests/hiring-funnel.test.js` (4 tests: funnel numbers, assumed / unavailable, filters + access + export, details lists equal the
  report counts). `client/src/pages/reports/reportViews.test.mjs` expects the new `hiring-funnel` entry.
- Playwright on staging (scripts in the session scratchpad `pw/verify-funnel.js`, `verify-funnel-click.js`): report opens, API numbers equal the
  screen, toggle highlights exactly the stages with assumed passes, filters re-query, week breakup, Excel + PDF download, every count equals
  its list, recruiter count shows only that recruiter, no browser errors. All pass.
- Run locally: `cd server && npx jest --runInBand tests/hiring-funnel.test.js` with `TEST_DATABASE_URL` set to an isolated, migrated DB.

## Bugs found by testing (fixed)
1. Client round % was 194% on staging: candidates reached a client round with no screening record, so they were not counted as having cleared
   the first round. Fix: moving past a stage counts as clearing it (the gap still shows under Data unavailable).
2. CI lint: `react/no-unescaped-entities` for an apostrophe in a table note (`&apos;`). ESLint is not installed in this checkout, so lint
   only runs in CI; scan new JSX text for raw `'` before pushing.

## Release
Commits: `564cd7b` (report), `12dea78` (first-round fix), `20ba5a0` (lint), `b9f039c` (clickable counts) on `super_admin_branch`, `staging`, `main`.
No migration.

## Open / ideas
- [CONFIRM] "Selected" = `closed`; if offer accepted should count, change `joined` evidence in `evaluate`.
- Drill-down lists are capped at 1000 rows (latest sourced first); add an Excel export of a list if asked.
- A submission-level view (instead of per profile) if the owner wants it.
- Sales funnel on `lib/funnel.js`.

## Hiring panels (added 2026-11-09, default view of Reports > Hiring funnel)
One table per interview template (Client Hiring, Internal Technical, Internal Sales / HR / Operations ...; whatever Hiring setup holds), laid out
as in the owner's `Hiring Funnel.pdf`: No, Layer, Since First, Layer by Layer, Bucket, Scheduled, Attended, Decision Pending, Rejected, Passed, Skipped.
The earlier stage funnel (recruiter-wise, trend) stays under the "Stage funnel & recruiters" tab.
- Each template round is a layer, in the template's order. Unit = a submission, picked by the **date of submission** (not the sourcing date).
- **Bucket**: layer 1 = every submission in the panel; later layers = passed + skipped of the layer before. Since First = bucket / layer 1 bucket;
  Layer by Layer = bucket / previous bucket.
- Scheduled = a round / test / AI interview was set up. Attended = a result is in, or the time has passed (no-show and cancelled are not attended).
  Decision pending + Rejected + Passed = Attended. Skipped = round marked skipped, an optional round moved past, or a gap in the records while the
  candidate moved on; flows to the next bucket like a pass.
- Layer 1 (the screening round) combines the screening interview, the screening test and the AI interview: the best result wins.
- Filters: vendor, team, date of submission, recruiter, client, sales owner, sales brought (client's origin owner), profile type (Vendor / Market / Bench).
- Every count opens the candidates behind it. Excel / PDF export: one sheet per panel.
- API: `GET /reports/hiring-panels`, `GET /reports/hiring-panels/details` (`template_id`, `layer`, `metric`), `GET /reports/export?report=hiring-panels`.
  Code: `server/src/modules/reports/hiringPanels.service.js`, `client/src/pages/reports/HiringPanels.jsx`. Test: `server/tests/hiring-panels.test.js`. No migration.
