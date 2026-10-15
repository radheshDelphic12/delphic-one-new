# Career apply form: validation, CV upload, duplicates

Requested by Diksha (HR), 2026-10-15. Applies to the public apply form (`/<org>/career/<job>`), served by
`server/src/modules/careerPages`.

## The five changes

| # | Request | What we did |
|---|---|---|
| 1 | Phone must be exactly 10 digits | Form: numeric, max 10 digits. Server: `screening.normalizePhone` accepts `+91` / `0` prefixes, requires `^[6-9]\d{9}$`, stores the 10 digits. |
| 2 | Only a LinkedIn URL | `screening.isLinkedInUrl`: host `linkedin.com` or `*.linkedin.com`, path `/in/...` or `/pub/...`. Company pages and other sites are rejected. Applies to every screening form (public, referral, recruiter). |
| 3 | CV attachment instead of Drive link | Public form has a file input (PDF / DOC / DOCX, max 5 MB), sent as multipart. Stored in `UPLOAD_DIR`, columns `cv_file` + `cv_file_name`. Recruiters download it from Pipeline > Applicants (`GET /applicants/:id/cv`, authenticated). `cv_url` stays for old rows and the recruiter's manual form. The file is optional. |
| 4 | Last field label | "Anything you would like to add" -> "Why you are fit for this role" (still optional; stored in `notes`). |
| 5 | Same person must not apply again | Match per requirement on email, phone (last 10 digits) **or LinkedIn profile**. The check and the insert run under a per-requirement advisory lock so two quick clicks cannot both pass. |

## Decisions made without asking (change if wrong)

- India-only phone numbers (10 digits, starts 6-9).
- "Why you are fit" stays optional; the CV file is optional.
- No DB unique index (old rows may already hold duplicates); the advisory lock closes the race instead.
- Duplicate scope is one requirement. Re-publishing a job as a *new* requirement lets the person apply again.

## Files

- `server/src/modules/applicants/screening.js` - phone + LinkedIn rules
- `server/src/modules/applicants/applicants.service.js` - duplicate check, `cvFile`
- `server/src/modules/publicJobs/publicJobs.service.js`, `careerPages/careerPages.routes.js` - multipart apply
- `server/src/modules/careerPages/careerPages.views.js`, `assets/career.js` - the form
- migration `20261016110000_applicant_cv_file`
- `client/src/pages/pipeline/ApplicantPoolBoard.jsx` - "CV" download
- tests: `server/tests/career-pages.test.js`
