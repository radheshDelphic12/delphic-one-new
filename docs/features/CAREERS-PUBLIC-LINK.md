# Public job link, source tracking, Offices and Internal jobs (2026-10-14)

Status: built and committed locally; not pushed. Migration `20261016090000_job_public_link` (additive).

## 1. Public link for every published job (built end to end)

- Publishing a job (Pipeline > In-progress jobs > Publish, or the requirement page) creates a **slug**: the title plus 4 hex characters (`senior-react-developer-3fa9`), stored on `website_job_postings.slug` (unique). Existing postings are back-filled by the migration.
- The link `/careers/<slug>?src=<source>` opens **without login**: the job (public copy only: title, department, location, type, description) and an apply form. `/careers` lists every open job. Page: `client/src/pages/public/CareerJobPage.jsx`.
- **Copy link** (next to a published job in In-progress jobs) has a source dropdown: LinkedIn, Website, WhatsApp, Naukri, Referral, Other. The source is the `src` of the link.
- The application goes into the normal Applicants pool (`job_applicants`, source `website`) with the new `channel` column (`linkedin`, `website`, `whatsapp`, `naukri`, `referral`, `internal`, `other`; no `src` = `website`, an unknown `src` = `other`). In-progress jobs shows "LinkedIn 3 · Website 1" per job; the Applicants list shows the channel.
- API (no login): `GET /api/v1/public/jobs`, `GET /api/v1/public/jobs/:slug`, `POST /api/v1/public/jobs/:slug/apply` (20 applications per hour per IP, a hidden honeypot field, the same person cannot apply twice to one job: 409).
- A link stops working (404 "This job is no longer open") when the posting is closed or the requirement leaves `in_progress`.
- `VITE_PUBLIC_JOBS_BASE` (client build env, optional) sets the domain used when copying links; without it the app's own origin is used.
- Not done: the existing `delphic.in/career` page (its code is not in this repo) still lists jobs from the Sheet; it can link each job to `<app domain>/careers/<slug>`.

## 2. Offices tab (base only)

Left menu **Offices** (`/offices`): one card per office location (Ahmedabad, Gurgaon, Indore ... from Settings > Locations) with people count. Each card has **CCTV** and **Biometric check-in / check-out** rows that read "Not connected yet". API `GET /api/v1/orgs/locations/overview` already returns `cctv` / `biometric` objects (`status`, `cameras` / `devices`) so the real integration only has to fill them. Needs hardware details (camera brand / stream, biometric device API) before it can be built.

## 3. Internal jobs (base only)

Left menu **Internal Jobs** (`/internal-jobs`, Delphic Global employees): the jobs open on the website. **Refer someone** (name, email, phone, experience, why) creates an applicant with source and channel `referral` (notes "Referred by ..."); **Apply myself** creates one with source and channel `internal`. Both land in the recruiters' Applicants pool, the same person is never added twice to one job. API `/api/v1/internal-jobs` (+ `/:slug/refer`, `/:slug/apply`). Not done: suggesting jobs to people whose project is ending (Capacity & Allocation already knows who is free soon) and referral rewards.

Tests: `server/tests/public-jobs.test.js` (4), `server/tests/internal-jobs-offices.test.js` (3).
