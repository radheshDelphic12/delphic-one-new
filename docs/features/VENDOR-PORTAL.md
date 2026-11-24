# Vendor portal

A separate page and login (`/vendor-portal`) for a vendor's own people. Built 2026-11-24.

## What a vendor can do
- Sign in with a **vendor portal login** (never a company user). Token is signed with `JWT_ACCESS_SECRET::vendor-portal`, so a company token is rejected by the portal and the reverse.
- See only the **requirements the team shared** with their company (open / in progress). No client name, no budget, no billing detail.
- **Put a candidate forward** (details + CV file or link). It stays a *vendor submission*; **no Profile exists until approved**.
- See **their resources with the vendor rate only** (what we pay), never what a client is billed.
- **Send invoice files** (month, number, amount, file). Files are stored privately and shown in Finance as *Uploaded by vendor*. An upload never creates an invoice.

## What the company does
| Where | What |
|---|---|
| Accounts > a vendor > "Vendor portal" card | add / switch off logins, reset password; resources with **both** rates (vendor rate and the client billing rate) |
| Requirements > a requirement > "Vendors" | choose which vendors can see it |
| Pipeline > Submissions (top of the page) | "Candidates from vendors": **Approve** (creates a normal Profile, source `vendor`, CV copied as a profile document; an existing profile with the same email is reused) or **Reject** with a reason the vendor sees |
| Finance > Vendor Invoices > Uploaded by vendor | open the file, Accept or Reject (reason) |

Who may approve: anyone holding `vendor_portal.review`, or the **point of contact** (the owner of the vendor account) with no permission needed. Without either, the inbox shows only the vendors one is in charge of.

## Permissions (module `vendor_portal`)
`view` (see activity, both rates, uploaded invoices), `share` (share requirements; sales too in the old role model), `manage` (create logins, review invoices), `review` (approve / reject any vendor's candidates).

## Data (all separate from company tables)
`vendor_portal_users`, `vendor_requirement_shares`, `vendor_submissions`, `vendor_portal_invoices` (migration `20261226100000_vendor_portal`). Files: `uploads/vendor-cv`, `uploads/vendor-invoices` (read only through the routes).

## API
Portal: `/api/v1/vendor-portal/*` (own auth). Company: `/api/v1/vendor-portal-admin/*` (company login + permission; see `lib/access/routeRules.js`).

## Added later (2026-11-24)
- **Notification:** when a vendor puts a candidate forward, the owner of the vendor account (the point of contact; the admins when it has none) gets a bell notification that opens Pipeline > Submissions. It can be muted in notification preferences (type `vendor_candidate_submitted`).
- **Forgot password:** the portal sign-in has "Forgot your password?". It emails a one-hour link (`/vendor-portal?reset=...`); only a hash of the token is stored, the answer never says whether the email exists, and a used or expired link is refused. An admin can still reset a password from the vendor card.

Related, in Finance: Vendor Invoices has a Collection filter (Overdue / Follow-up due / No due date set), and the Payment Tracker has a per-resource "This resource paid" column (Mark paid with date and note, Undo; table `vendor_resource_payments`).

## Not built (yet)
Linking an approved profile directly to a pipeline submission.

Tests: `server/tests/vendor-portal.test.js` (15).
