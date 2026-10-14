# Website forms -> Delphic One (contact, career, secure)

Status: documents the code in `server/src/modules/website/*` and `server/src/jobs/websiteSync.js` as of 2026-10-13. The delphic.in frontend and its Apps Script code are NOT in this repo (see `PLATFORM-INTEGRATION.md` in the website repo); the website side below is inferred from what the server expects.

## Flow

1. A visitor submits a form on delphic.in: `contact`, `career` or `secure` (Delphic Secure). Each form has its own Apps Script web app that writes a row into a Google Sheet with a "Submission ID" and a blank "Platform Status".
2. Delphic One pulls rows whose Platform Status is blank, every 10 minutes (`websiteSync.js`, needs `ENABLE_JOBS` not false) or with the sync button on the Website page. They are stored in `website_submissions` (Delphic Global workspace, status `new`) and the sheet row is marked `Imported`.
3. When handled, the status becomes `converted` or `dismissed` and the sheet shows `Converted` / `Dismissed` (failed writes are retried by the next sync).

## What each form becomes

| Form | Action (Delphic Global admin only) | Result |
|---|---|---|
| contact, secure | Convert to lead | Lead, stage `new`, source `Website: contact form` / `Website: Delphic Secure`. Name = company (else person); contact name, email, phone, message (+ Team Members for secure). **Owner = the admin who clicked convert**; nothing is auto-assigned. |
| career | Auto-route during sync | If the Role equals (case-insensitive) the title of a published website posting whose requirement is `in_progress`: goes straight into the Applicants pool, source `website`. Same email/phone cannot apply twice to one requirement. |
| career | To applicant (manual) | Admin picks an in-progress requirement; same result as auto-route. |
| career | Convert to profile (manual) | Admin enters experience + primary skills; creates a Profile (source `direct`), or links an existing one with the same email. |
| any | Dismiss | Status `dismissed`. |

## Assignment

The Applicants pool is first come, first served (conditional update, so two simultaneous clicks give one winner and one 409). A claim creates or reuses the Profile (match by email or phone) and adds the recruiter to the requirement. An admin may hand an applicant to a chosen recruiter; release returns the person to the pool.

## Known quirks

- Profiles created on claim get source `linkedin` even for website applicants (`findOrCreateProfile` in `applicants.service.js`), so source reports count them as LinkedIn.
- Auto-route matches the job title only; any difference other than letter case leaves the submission `new` for an admin.
- `WEBSITE_CAREERS_URL` is not read by any code.

## Configuration

Five variables: `WEBSITE_SCRIPT_SECRET` (must equal the `PLATFORM_SECRET` script property on each Apps Script), `WEBSITE_JOBS_SCRIPT_URL`, `WEBSITE_CONTACT_SCRIPT_URL`, `WEBSITE_CAREER_SCRIPT_URL`, `WEBSITE_SECURE_SCRIPT_URL`. All five are needed; with any missing the feature is off (routes answer 503, the sync does nothing).

- `npm run dev` (no Docker): `server/.env` (git-ignored). Restart the API.
- Docker / VPS: root `.env` (`/opt/delphic/.env` on the EC2 box). **`docker-compose.yml` passes these through its explicit `environment:` list (commit c545abe); a variable not listed there never reaches the container.** After editing `.env`, redeploy with `./start-delphic.sh --prod` (a plain `restart` does not pick up new values). Verify without printing secrets: `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec server sh -c 'env | grep -c "^WEBSITE_"'` should print 5.
- `NOTIFICATIONS_*` and `MS_GRAPH_*` are not in the compose pass-through list either.
- The secret was pasted into a chat on 2026-10-13; rotate it (`.env` + every script's `PLATFORM_SECRET`) if that chat is shared.
- Locally the feature is on and talks to the real sheets, so a local sync can import real submissions.
