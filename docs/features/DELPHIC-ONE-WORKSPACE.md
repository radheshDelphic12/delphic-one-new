# Delphic One workspace (the company that sells the product)

Built 2026-11-11, local. Migrations `20261211120000_delphic_one_workspace` (tables) and `20261211130000_delphic_one_company_registration` (the company row only; same pattern as Valterra: creates the org `delphic-one` with module `delphic_one` and gives the group Super Admin(s) access; no data; safe to run twice; does nothing on a database without the Delphic company).

## What it holds
* **Overview**: recurring revenue of active customers, customers by status, users on the product, open leads and follow-ups due, still to collect, overdue, invoice follow-ups due, unpaid invoices with no due date, leads by stage, trials ending in 7 days. Each tile opens the matching list.
* **Customers** (`dox_customers`): company, contact, GSTIN, status (trial, active, read-only, churned), plan, users, recurring revenue per 30 days, trial end, notes, and what they owe.
* **Leads** (`dox_leads`, `dox_lead_notes`): source, stage (new, contacted, demo, trial, won, lost), expected value, follow-up date, a history of notes (each stage move is written down). **Convert to customer** (the only way to win a lead) creates a customer on a trial (days editable) and links both ways.
* **Invoices** (`dox_invoices`, `dox_invoice_payments`): amount before GST, GST %, total, automatic number `DO/<FY>/<n>` (editable, unique), due date, part payments, cancel with a reason (not after a payment).
* **Collections**: the same follow-up log as Finance invoices and Book Keeping (`invoice_followups`, kind `dox_invoice`): next follow-up date and a note per chase; filters Unpaid, Overdue, Follow-up due, No due date, Paid. Paying an invoice in full clears its follow-up date.

## Access
Routes `/api/v1/delphic-one/*`, module `delphic_one` on the active company. Org-membership role decides: `admin` everything; `sales` and `bda` customers, leads and read-only invoices; everyone else nothing. The company's sidebar and home are its own (like Zephyr / Valterra); Hiring and Settings stay shared.

## Not in this version
Linking a customer to a real tenant of the product (no multi-tenant product yet; see the SaaS launch plan), invoice PDFs and email, a website early-access form feeding leads (the existing website forms flow can be pointed at `dox_leads` later), a company logo and theme, group-dashboard finance for this company (it shows on the group dashboard as an ordinary company with no books until it has some), roles other than admin / sales.

Tests: `server/tests/delphic-one-workspace.test.js`.
