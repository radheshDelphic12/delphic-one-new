# Job IDs, job search, referral tracking (2026-10-23)

Migration `20261023090000_job_ids_referrals` (additive, no DROP). Tests: `server/tests/job-ids-search-referrals.test.js` (12) plus the updated career-pages, public-jobs, internal-jobs-offices, website suites.

## What changed

- **Job ID** `DLP-0001`: `website_job_postings.job_code`, drawn from sequence `website_job_code_seq` by a column default (every insert path gets one), unique, and a trigger refuses any change. Existing postings are numbered by age. Shown on public cards, the job page, the apply confirmation, Internal Jobs cards (with Copy Job ID / Copy job link / Copy my referral link), the Refer form, Pipeline > In-progress jobs, the requirement page and the Applicants table. `/delphic/career/DLP-0001` redirects (302, query string kept) to the slug page; slug URLs are unchanged.
- **CV** stays a **mandatory Google Drive link** on the public apply form, Refer someone and Apply myself (decision 2026-10-23: no file upload; the older `cv_file` download route is untouched).
- **Referral tracking** (`job_applicants.referrer_id / referrer_name / referrer_code / referrer_text`): Refer someone saves the employee; the employee link `<job link>?ref=<employee id or code>` credits the application automatically (self-referral ignored, unknown ref ignored); the public form has an optional "Referred by" (an employee email is credited, other text is kept as typed). `origin` = Referral / Direct / Internal / Added by recruiter. Applicants: Job ID column, "Referred by" column, filters Job ID / Referred by / Source, search also matches Job ID and referrer. Employees: Internal Jobs > My referrals (`GET /internal-jobs/my-referrals`).
- **Search** (server side, `modules/jobs/jobSearch.js`, shared by `/<org>/career/jobs.json` and `GET /internal-jobs`): rank = exact Job ID > partial Job ID > exact title > phrase in title > all words in title > words in skills / department / location / description (every word must match). Case and extra spaces ignored. Combined with Department / Location filters, sort (best match / newest / oldest / title), paging of 20 with Load more, `?q=` kept in the address, 250 ms debounce, live count, empty state. The open set is cached 10 s in memory (not in tests).
- **Data rules**: department required (publish form + API), employment type one set (Full-time / Part-time / Contract / Internship) stored as enum `employment_kind` with the label in `employment_type`, titles lose trailing punctuation and ALL CAPS. The migration backfilled all of it; postings with no department anywhere become **"General"** (an admin can change it from the listing).
- **Apply myself looked disabled** because it is only for employees on the bench or serving notice (by design). It now stays visibly locked, explains why on click and in the tooltip, and still lets the employee refer.

## How to test

1. Publish a job (Pipeline > In-progress jobs): it gets the next `DLP-nnnn`; department is required.
2. Open `/delphic/career/`: type a Job ID, "data engineer", a skill; tick filters; scroll to Load more; reload with `?q=`.
3. Employee > Internal Jobs: same search, copy buttons, Refer someone (Drive link required), My referrals.
4. Open `/delphic/career/<slug>?ref=<employee id>` and apply: Applicants shows "Referred by <employee>"; filter by Job ID and Referred by.

Not done: DB-level NOT NULL on department (the column stays nullable; the API enforces it); trigram/full-text index (the in-memory ranking is enough for several hundred jobs).
