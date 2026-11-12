# Speak Up – Confidential Reporting

Delphic Global (the master workspace). Internally the module, tables and API are called `whistleblower` / `whistle_*`; everything people see is "Speak Up". Built 2026-10-30. **Off for every company until an admin switches it on** (Speak Up > Settings), so shipping it changes nothing for anyone.

Any employee can raise a complaint in confidence, or anonymously, and follow it by its reference number. It goes to the people an admin set as handlers for its category. It is a separate record: nothing here is read by attendance, payroll, leave, HR records or reports, and nothing is written to the change log.

## What an employee does
| Step | How |
| --- | --- |
| Pick the category | The 20 starting categories (POSH, favouritism, bullying, financial fraud, retaliation ...), each with examples. Admin-editable. |
| Describe the incident | Title, description, date, location (office), department, individuals involved (pick colleagues and/or write names). People picked as involved never see or receive the complaint, even if they are handlers. |
| Add evidence | Up to 5 files (images, PDF, Word, Excel, text), 10 MB each, at submission and later. |
| Get a reference number | `SU-2026-0001`, unique per company, counts up. |
| Track it | Confidential: Speak Up > My complaints (also searchable by reference number). Anonymous: Speak Up > Track a complaint with the reference number **and** the tracking code (shown once; only its SHA-256 hash is stored). |
| Add information later | A reply box with attachments on both views. A reply on a closed complaint reopens it. |

Confidential = the handlers see the name, nobody else does. Anonymous = no person is stored at all (`reporter_membership_id` is null, events and messages carry no actor), and the tracking requests are sent without a login token. An admin can switch anonymous complaints off.

The application logs (`middleware/requestLogger.js`, `errorHandler.js`) leave out the user id for every Speak Up path, so a log reader cannot tie a person to a complaint. Network-level logs of the web server or proxy are outside the application and are not covered.

## Who sees what (admin-editable per category)
- Each category has handlers (people). **No handler named: the company admins** receive it, so nothing is lost.
- A **restricted** category (POSH and retaliation by default) is seen only by its named handlers and the group admin, not by every admin. With no handler named the admins receive it.
- A non-restricted category is seen by its handlers and by the admins (and anyone holding Speak Up > View).
- The person assigned to a case can always see and handle it. Anyone named as involved never can, and cannot be assigned.
- A person who may not see a case gets "not found", not "forbidden".
- Reporters never see handler names or internal notes. Handlers can add internal notes and reply to the reporter, change the status (New, In review, Investigating, Action taken, Closed; closing needs a written resolution), and assign.
- A complaint nobody touched for `sla_days` (default 7) shows as **Overdue** in the inbox and the dashboard card.

## Where
- Menu: Speak Up (shown only while it is on, or to the admins who set it up). Tabs: Raise a complaint, My complaints, Track a complaint, Complaints to handle (handlers), Settings (admins).
- Dashboard card: raise a complaint, my open complaints, and for handlers new / open / overdue.
- Settings: on/off, allow anonymous, overdue days, categories (rename, reword, restrict, switch off, add) and their handlers.
- Notifications: in-app bell only, never by email, and never with the title, the text or the reporter's name ("New complaint received", "SU-2026-0001 - <category>").

## Permissions
`basic.whistleblower` is a default basic access item (everyone, removable per person). Catalogue module `whistleblower`: `view` (see non-restricted complaints), `update` (reply, status, assign), `manage` (settings, categories, handlers). Route rules in `lib/access/routeRules.js`.

## Data (migrations `20261106100000_whistleblower_notification_types`, `20261106100100_whistleblower`, additive)
`whistle_settings`, `whistle_categories`, `whistle_cases`, `whistle_messages`, `whistle_events`, `whistle_attachments` (no uploader column), plus notification kinds `whistleblower_new`, `whistleblower_update` and entity `whistle_case`. No foreign keys to people, on purpose. Files are stored in the upload folder and are served only through `GET /whistleblower/attachments/:id`, which checks who may see the case.

## API (`/api/v1/whistleblower`, master workspace)
Everyone: `GET /meta`, `GET /summary`, `GET /mine`, `GET /mine/:id`, `POST /mine/:id/messages`, `POST /cases`. Handlers: `GET /cases`, `GET /cases/:id`, `POST /cases/:id/messages`, `PATCH /cases/:id`, `GET /attachments/:id`. Settings: `GET|PUT /settings`, `GET|POST /categories`, `PATCH /categories/:id`. Public (no login, rate limited): `POST /api/v1/public/whistleblower/track`, `/reply`.

## Not built / limits
- Delphic Global only; the other company workspaces keep their own role systems and do not have it yet.
- No automatic escalation job or email: overdue is shown, not pushed.
- An anonymous reporter's attached files are listed but cannot be downloaded back by them (the download needs a sign-in).
- Cases are never deleted, only closed.

## Tests
`cd server && npx jest --runInBand tests/whistleblower.test.js` (16 tests: off by default, routing, restricted, involved people, replies and internal notes, overdue, anonymous, files, categories, change log). `tests/access-model.test.js` covers the route table.
