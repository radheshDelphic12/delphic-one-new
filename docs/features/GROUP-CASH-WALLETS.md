# Group Cash: bank accounts, wallets, transfers (Phase 1)

Group Dashboard > **Book Keeping** (brief called it "Cash Position"; Paras asked for the plain word) (group superadmin only). Built locally on branch `super_admin_branch`, not pushed.
Brief: Phase 1 of 4 (Phase 2 payment hooks, Phase 3 invoice generator, Phase 4 not now). Stop for review after each phase.

## Decisions (agreed 2026-10-15)

- **"Delphic" and "Delphic Global" are one org** in this app (org slug `delphic`, the master workspace). So there are **2**
  seeded legal entities (Delphic Global, Gulati Industries). A third entity can be added any time under Setup (workspace
  link is optional); revisit if Paras wants a separate Delphic entity.
- **Paras (group superadmin) is the admin of every company**, so every write is superadmin-only. Company admins get only a
  read-only API for their own wallets (`/api/v1/wallets/mine`); no company-side screen yet.
- **Soft delete** for entries and transfers (`deleted_at`); every create / edit / delete goes to `wallet_audit` with
  before / after. Deleting one side of a transfer deletes the whole transfer; editing one side edits both.
- Wallet purpose is a fixed list (general / salary / travel / unallocated), the name is free text.
- INR and USD only (CHECK constraint + validation). A cash account has no bank name / last 4.

## Model (migration `20261016120000_group_cash_wallets`, additive)

`legal_entities`, `bank_accounts`, `wallets`, `wallet_transactions`, `wallet_transfers`, `bank_reconciliations`, `wallet_audit`.
Nothing stores a balance: wallet = opening + live entries, account = sum of its wallets. DB CHECKs: exactly one wallet
owner, positive amounts, direction in/out, transfer kind, two different wallets, type / currency / purpose lists.

- Every account auto-gets an **Unallocated** wallet (owned by the legal entity), opened with the declared opening balance.
  The wallets' opening balances should add up to the declared one: a warning with the difference, never a block.
- Transfer = one `wallet_transfers` row + two `wallet_transactions` (out, in), in one DB transaction.
  `reallocation` (same account) / `bank_transfer` (different accounts); `is_intercompany` when the owners differ.
  Unallocated money of an entity linked to a workspace counts as that workspace's (not intercompany).
  Different currencies are refused. Transfers are not receipts or income.
- Negative wallet balance: warning in the response, not a block. Switching off a wallet / account with money: blocked.

## API (`server/src/modules/cashPosition/`)

Group superadmin, `/api/v1/group-cash`: `GET /position` (filters: legal_entity_id, workspace_id, type, currency),
`GET /options`, entities (`GET/POST /entities`, `PATCH /entities/:id`, `POST /entities/seed-defaults`), `POST/PATCH /accounts`,
`POST/PATCH /wallets`, `GET /wallets/:id/entries?from&to&format=json|csv|pdf`, `POST /wallets/:id/transactions` (multipart,
optional `file`), `PATCH/DELETE /transactions/:id`, `POST/PATCH/DELETE /transfers`, `GET /receipts` (json / csv),
`GET /reconciliations`, `POST /reconciliations/preview`, `POST /reconciliations`, `GET /audit`.
Workspace admin, `/api/v1/wallets`: `GET /mine`, `GET /mine/:id/entries` (own workspace's wallets only; parent account
name, never its total).
Attachments live in `UPLOAD_DIR` as `wallet-*`; `/uploads/:file` serves them to the group superadmin or an admin of the
owning workspace (`cash.service.canReadAttachment`).

## UI (`client/src/pages/groupOverview/GroupCashTab.jsx`)

Bank view (entity > account > wallets), Fund view (company > wallets; entity-owned wallets under "<entity> (entity)"),
Receipts, Reconciliation, Setup. Checkboxes at account and wallet level with a live total (`lib/cashSelection.js`: whole
paise integers, INR and USD apart, a wallet inside a ticked account counts once). Wallet drawer: date range, running
balance, split by mode, CSV / PDF, edit / delete.

## Try it

1. Start the API + client ([[local-dev-startup]] flow), log in as the group superadmin, open Group Overview > Book Keeping > Setup.
2. "Create Delphic Global and Gulati Industries", add a bank account (the Unallocated wallet appears), add wallets for companies.
3. Money in / out, Transfer (same account = reallocation, other account = bank transfer), tick boxes, open a wallet, export.
4. Reconciliation: pick an account, a date, a statement balance, compare, save.

Tests: `cd server && npx jest --runInBand tests/group-cash.test.js` (19 tests; use an isolated `TEST_DATABASE_URL`).

## Phase 2: payment hooks (built)

- Setting: Book Keeping > Setup > **Go-live date** (`GET/PUT /group-cash/settings`, table `group_cash_settings`). Empty = off.
- A **client invoice** (sent -> paid), **vendor payment** (pay), **expense** (reimburse) or **salary** (Payroll > Salary Payments > paid)
  whose record was **created on or after** the go-live date must name a wallet + mode (`wallet_payment: { wallet_id, mode, date? }`
  in the request). Without it the API answers 422 "Choose the wallet...". Older records are untouched and need no wallet.
- The wallet must belong to that company (or to its linked legal entity), be active and be in the payment's currency;
  the group superadmin may use any wallet of the group.
- The wallet entry (`reference_type` = invoice / vendor_payment / expense / salary_run, `reference_id` = the record) is written
  in the same DB transaction as the paid status. Receipts are `in`, the others `out`.
- Un-marking: salary "not paid" removes the entry; deleting an invoice or an expense claim removes its entry (soft delete + audit).
  A salary re-saved with a new amount updates the same entry. Invoices, vendor payments and reimbursements cannot be un-paid today.
- UI: one reusable dialog (`components/cash/useWalletPayment.jsx`) asks for the wallet when the server says it is needed. It is wired into
  Live Analytics invoices, Finance > Invoicing, Expenses (reimburse), Vendor payments and Salary Payments.
- Not hooked: the vertical workspaces' own ledgers (Zephyr, Gulati, Acconcy, Zklyrera, Valterra, Foundation) and the older vendor-commission payments.

## Phase 3: invoice generator (built)

Existing flow reviewed: Delphic's `ClientInvoice` is built from timesheet billing, numbered `INV-YYYY-nnn` by scanning existing rows
(not gap-safe), belongs to a workspace and has no PDF. The new generator is a separate module (`server/src/modules/groupInvoices/`),
issued by a **legal entity**, so nothing in the billing flow changed. Reused: pdfkit, the wallet / audit tables, the Account-style fields.

- Types: **GST** (CGST+SGST inside the entity's state, IGST between states; HSN/SAC on every line; seller GSTIN + state required;
  buyer GSTIN optional but validated), **non-GST**, **USD export** (USD wallet, bank + SWIFT lines from the account or the invoice, LUT note).
  GST rates 0 / 0.25 / 3 / 5 / 12 / 18 / 28. Tax is summed per invoice and rounded once (half up); CGST/SGST split loses no paisa.
- Numbers: `<prefix>/<financial year>/<4 digits>`, e.g. `DG/2026-27/0001`. One series per entity per April-March year, from a locked
  counter row in the same transaction as the invoice: gap-safe, never reused, a cancelled invoice keeps its number, a failed one burns none.
- An invoice names its **receiving wallet** (inside the issuing entity's own bank account, matching currency). Payments (part or full,
  never more than is due) are posted to that wallet in the same transaction; removing a payment takes the receipt back.
- Issued invoices cannot be edited (cancel and re-issue); the seller's details are frozen on the invoice. Cancel only with no payments.
- PDF: seller name / GSTIN / PAN / address (+ logo when it is a PNG/JPEG in the upload folder), buyer, lines, tax split, totals, payment details.
- API: `/api/v1/group-cash/invoices` (list with filters + totals per currency, create, get, `/pdf`, `/cancel`, `/payments`).
  UI: Book Keeping > Invoices; entity prefix / state / GSTIN / address / LUT and the bank account's payment lines are edited under Setup.

Tests: `group-cash.test.js` (19), `group-cash-hooks.test.js` (6), `group-cash-invoices.test.js` (9). Ran with the affected billing,
expenses, salary-payment and invoice-record suites (all green). Migrations: `20261016120000_group_cash_wallets`,
`20261016130000_group_cash_invoices_settings`.

## Open items

- No company-admin screen (read API only); Phase 4 (inter-company settlement, INR/USD conversion, month-end close) is not built, but
  transfers carry `is_intercompany` and every entry has its currency, so the data supports it.
- Invoice logo: SVG logos are skipped in the PDF (upload a PNG/JPEG as the entity logo to see it).
- Prod: run both migrations, then Setup > "Create Delphic Global and Gulati Industries", fill each entity's prefix / GSTIN / state, add the
  bank accounts and wallets, then set the go-live date. Nothing is seeded automatically.
