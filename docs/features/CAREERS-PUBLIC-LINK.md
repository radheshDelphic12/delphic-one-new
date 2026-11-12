# Public job link, source tracking, Offices and Internal jobs (2026-10-14)

Status: built and committed locally; not pushed. Migration `20261016090000_job_public_link` (additive).

## 1. Public link for every published job (built end to end)

- Publishing a job (Pipeline > In-progress jobs > Publish, or the requirement page) creates a **slug**: the title plus 4 hex characters (`senior-react-developer-3fa9`), stored on `website_job_postings.slug` (unique). Existing postings are back-filled by the migration.
- (Superseded by section 6: the address is now `/delphic/career/<slug>`.) The link `/careers/<slug>?src=<source>` opens **without login**: the job (public copy only: title, department, location, type, description) and an apply form. `/careers` lists every open job. Page: `client/src/pages/public/CareerJobPage.jsx`.
- **Copy link** (next to a published job in In-progress jobs) has a source dropdown: LinkedIn, Website, WhatsApp, Naukri, Referral, Other. The source is the `src` of the link.
- The application goes into the normal Applicants pool (`job_applicants`, source `website`) with the new `channel` column (`linkedin`, `website`, `whatsapp`, `naukri`, `referral`, `internal`, `other`; no `src` = `website`, an unknown `src` = `other`). In-progress jobs shows "LinkedIn 3 · Website 1" per job; the Applicants list shows the channel.
- API (no login): `GET /api/v1/public/jobs`, `GET /api/v1/public/jobs/:slug`, `POST /api/v1/public/jobs/:slug/apply` (20 applications per hour per IP, a hidden honeypot field, the same person cannot apply twice to one job: 409).
- A link stops working (404 "This job is no longer open") when the posting is closed or the requirement leaves `in_progress`.
- (Superseded by section 6: the base is the server setting `PUBLIC_CAREERS_BASE`.)
- Not done: the existing `delphic.in/career` page (its code is not in this repo) still lists jobs from the Sheet; it can link each job to `<app domain>/careers/<slug>`.

## 2. Offices tab (base only)

Left menu **Offices** (`/offices`): one card per office location (Ahmedabad, Gurgaon, Indore ... from Settings > Locations) with people count. Each card has **CCTV** and **Biometric check-in / check-out** rows that read "Not connected yet". API `GET /api/v1/orgs/locations/overview` already returns `cctv` / `biometric` objects (`status`, `cameras` / `devices`) so the real integration only has to fill them. Needs hardware details (camera brand / stream, biometric device API) before it can be built.

## 3. Internal jobs (base only)

Left menu **Internal Jobs** (`/internal-jobs`, Delphic Global employees): the jobs open on the website. **Refer someone** (name, email, phone, experience, why) creates an applicant with source and channel `referral` (notes "Referred by ..."); **Apply myself** creates one with source and channel `internal`. Both land in the recruiters' Applicants pool, the same person is never added twice to one job. API `/api/v1/internal-jobs` (+ `/:slug/refer`, `/:slug/apply`). Not done: suggesting jobs to people whose project is ending (Capacity & Allocation already knows who is free soon) and referral rewards.

Tests: `server/tests/public-jobs.test.js` (4), `server/tests/internal-jobs-offices.test.js` (3).

## 4. Screening questions and filters (2026-10-14)

Migration `20261016100000_applicant_screening` (additive; old applicants keep the new columns empty).

- **What the candidate answers** (public apply page, `ScreeningFields.jsx`): LinkedIn link (required), link to the CV (optional), working somewhere (yes / no), immediate joiner (yes / no / serving notice), notice period (Immediate / 15 / 30 / 60 / 90 / Other days), last working day (required when serving notice), current and expected CTC in LPA, how they can join (remote / on-site / hybrid), other skills. Phone is required too. Required on the public form: phone, LinkedIn, working yes/no, joiner status, notice period, both CTCs, work mode. CV link and skills are optional.
- The same questions are available, but optional, when a recruiter uses "Add applicant" and when an employee refers someone (behind "Add more details"). Server rules: `server/src/modules/applicants/screening.js` (valid links, last working day while serving notice, an immediate joiner gets notice 0, skills stored lower-case).
- Stored on `job_applicants`: `linkedin_url, cv_url, currently_working, joiner_status, notice_period_days, last_working_day, current_ctc_lpa, expected_ctc_lpa, work_mode, extra_skills`. When a recruiter claims the applicant, the new Profile gets them (CTC converted from lakh to rupees, CV link as resume, skills as secondary skills).
- **Filters** (Pipeline > Applicants > Filters, server side, live with the 20 s refresh): joiner status, working now, notice period up to, last working day on or before, work mode, expected CTC from / to, current CTC up to, experience from / to, skill. A person who did not answer a question never matches a filter on it. The table has a Screening column (joiner, notice, LWD, CTC now -> expected, work mode, skills, LinkedIn / CV links).
- HR role does not see the Applicants tab (it was not visible before); unchanged.
- Tests: `server/tests/applicant-screening.test.js` (4).

## 5. Reports filters fix (same day)

BDA reports: the account **type** filter now narrows every table (it only narrowed "Accounts brought"): meetings scheduled / converted use the account's type, requirements are client-only, and the drill-downs repeat the same filter. Every open report now refreshes itself every 30 seconds and when the browser tab is shown again (no spinner, a failed refresh keeps the numbers on screen). Checked by partition audits against the local data: the person, account, type, source and sourcer filters of the BDA, Sales, Recruiter and HR reports and Time-to-submit add up to the unfiltered totals. Test: `reports-bda-sales.test.js` (account type case).

## 6. Careers pages on the website address (2026-10-15)

Decision (Paras and Mamoon): candidates see **delphic.in/career/...**, and every application is taken by Delphic One. The first version of the link (`/careers/<slug>`, a page of the React app) is replaced by server-rendered pages that can be shown on the website through a **rewrite** (a proxy, not a redirect).

- **Pages** (`server/src/modules/careerPages`): `GET /<org>/career/` (list), `GET /<org>/career/<slug>` (job and apply form), `POST /<org>/career/<slug>/apply` (JSON), `GET /<org>/career/assets/<file>` (css, js, logo). For Delphic Global the address is `/delphic/career/`. Plain HTML, CSS and JS, no build step; everything from the database is escaped.
- **Everything is relative** (links, stylesheet, script, form target), so `delphic.in/career` + `X` can map to `one.delphic.in/delphic/career` + `X` with no other change. The list lives at `.../career/` and a job at `.../career/<slug>`; wrong forms are fixed with relative redirects, so the visitor never leaves their own domain.
- **Per-visitor limit** (20 applications an hour) uses the first `X-Forwarded-For` address, because behind the website's proxy our nginx only sees that proxy. Plus an overall limit of 600 an hour.
- **Old links:** `/careers` and `/careers/<slug>` in the app move to the new pages (full page load). The JSON API `/api/v1/public/jobs...` is unchanged.
- **Routing:** `/delphic/career` is forwarded to the API by `client/nginx.conf` (production), the Dockerfile nginx (Render staging) and the Vite dev proxy.
- **Copy link / canonical:** `PUBLIC_CAREERS_BASE` (server env, no trailing slash, e.g. `https://delphic.in/career`) is what "Copy link" gives and what the canonical link points at. Leave it **empty until the website rewrite is live**; until then the links use the Delphic One address. `docker-compose.yml` passes it through.
- **Website team:** `docs/guides/CAREER-PAGE-REWRITE.md` (rewrite rules, examples, checks, rollback).
- Tests: `server/tests/career-pages.test.js` (8). Browser check: the pages were opened through a local stand-in for the website that rewrites `/career/*` to the API; all addresses stayed on the website address and nothing leaked to the ERP address.
