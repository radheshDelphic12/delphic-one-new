# Zephyr real-estate and construction business - implementation plan

Status: **phases R0-R9 built and tested locally on 2026-10-06 (not pushed to staging yet)**. Section 8 is the work log; sections 1-7 are the plan the build followed. Source: the 44-section Zephyr requirement brief from the product owner. Builds on the finished standalone workspace in [ZEPHYR-INFRASTRUCTURE.md](ZEPHYR-INFRASTRUCTURE.md) (phases Z0-Z8, `Zx*` tables, `/api/v1/zephyr`, `client/src/pages/zephyr`). Test guide for the current build: [../testing/TESTING-ZEPHYR.md](../testing/TESTING-ZEPHYR.md).

## 0. Decisions (confirmed by the product owner, 2026-10-06)

1. **Zephyr leads stay Zephyr's own** (`ZxLead`). They are not linked to Delphic leads and Delphic's leads module is never used.
2. **Delphic's finance / expense concept is reused as a concept** inside the Zephyr module (not by sharing Delphic tables or code): finance categories, expense claims with an approval step (submitted -> approved -> posted), **group expenses** (one shared cost split across several projects / properties / units, like Delphic's group charges), and **calculation locking with snapshot + change detection** (lock a month, later changes flag it instead of rewriting it - already built as `ZxPeriodClose`). Zephyr keeps its own `Zx*` tables and `/api/v1/zephyr` routes.
3. **The UI and screens built in Z0-Z8 were a sample.** The look (theme, sidebar, drawers, tables) is kept because it is good, but screens, fields, sections and navigation are reshaped to this requirement. Existing Zephyr demo data and tests are adapted as needed, not preserved for their own sake.

4. **Confirmed 2026-10-06:** phase order R0-R9 and the sidebar below are approved; the old lead "self project / client project / basis" fields are dropped in favour of service type.

Shared platform pieces stay shared: login, org membership, `enabled_modules`, roles, UI kit.

**Sidebar (workflow order):** Home, Leads, Client / Vendor, Projects, Properties (new; tabs Units, Tenants & leases, Rent, Finance, Timeline), Rent (new; due / collected / pending / overdue), Revenue & Profit, Employee / Contractor, Tasks (new), Financials, Zephyr setup.

## 1. What exists today (Zephyr, built Z0-Z8)

| Brief section | Exists in Zx | Gap |
|---|---|---|
| Client / Vendor (2) | `ZxParty` (kind client/vendor/both, GSTIN, PAN, docs, CSV import, statement) | company name, state, country, `hold` status, interested services (client), vendor category + materials/services |
| Leads (3-5) | `ZxLead`, activities, follow-ups, board, summary, convert once | service type, stage set, assigned contractor, expected start/end, expected margin, additional details, filters by service/date/location |
| Lead -> Project (6) | `projects.createFromLead`, `lead.project_id` | carry service type + details; one lead -> one project already enforced |
| Projects (7-10) | `ZxProject` + milestones + work orders (vendor allocation) + assignments + money tab | service type, common fields (actual end, agreement ref, expected/actual profit), service-specific sections, property link, statuses |
| Employee / Contractor (27) | `ZxPerson` (employee/contractor, assignments, salaries) | operational tasks |
| Finance (22-26) | `ZxLedgerEntry` (revenue/expense, actual/planned), categories, overview P&L, plans, projection, `ZxPeriodClose` (close, stale flag, reopen with reason), statements (Excel/PDF/CSV) | no property/unit/service dimension, no rent/sale/commission postings, no unrealized vs realized split |
| Audit (35) | `ZxAudit` via `writeAudit` | extend to new entities |
| Roles (36) | admin / manager / staff capability map in `access.js` | finance-only role, contractor scope for tasks |
| Dashboard (29) | Home dashboard (FY KPIs, trend, pipeline, attention) | property, rent, service panels |
| Property, units, tenants, leases, rent, loans, valuation, trading, consulting, tasks (11-21, 27-28, 33-34) | **nothing** | all new |

## 2. Design decisions

1. **Service type** is a master, not an enum scattered in code: table `ZxServiceType` seeded per org with the five services (civil_construction, interior_design, property_management, property_trading, real_estate_consulting); label and active are editable by admin (admin-editability rule), keys are fixed because logic depends on them. Leads, projects, ledger entries and parties (interested services) reference the key.
2. **One Project entity + service sections.** Common columns on `ZxProject`; per-service data in a `details` JSON column validated by a zod schema per service (civil: phases, estimated construction cost; interior: scope, property; consulting: desired type, budget, property value, commission %, deal date; management/trading: property link). No five tables.
3. **Property is independent of Client projects** (Zephyr may own it). `ZxProject.property_id` is an optional link. A property can be managed and traded at once; the lifecycle lives at unit level.
4. **Money never duplicated.** Rent receipts, property sales, consulting commission and property expenses each create/own a `ZxLedgerEntry` (new nullable columns `service_type`, `property_id`, `unit_id`, `source_type`, `source_id`). P&L, overview, plans, statements and month close keep reading the one ledger.
5. **Realized vs unrealized.** Valuation and appreciation are stored on the property (and valuation history) and reported as "Unrealized appreciation"; they never create ledger rows. Only a recorded sale posts realized trading revenue (sale value) and cost (total investment + selling costs).
6. **Locking = the existing month close.** Rent payments, sales, property expenses and commission postings are ledger-backed, so a closed month already flags/locks them; rent and sale edits dated in a closed month are refused for non-admins and flag the month stale for admins (same rule as ledger today). Valuation and loan edits are audited, not period-locked (they are not period transactions).
7. **Rent dues are generated, not typed.** A lease defines amount, due day (1-28, not hard-coded), start/end; `ZxRentDue` rows are generated per month idempotently; "overdue" is computed from due date vs today and payment status, never stored as a flag.
8. **Config over code:** lead stages and project statuses stay a fixed, documented set per the existing known-gap note, extended to the brief's sets; service types, expense categories, property types, unit statuses and payment methods are data/constants in one file each (`serviceTypes.js` etc.) shared by server validation and client labels.

## 3. Data model (new / changed)

Changed: `ZxParty` (+company_name, state, country, interested_services text[], vendor_category, materials_services; status +hold). `ZxLead` (+service_type, assigned_person_id, assigned_contractor_id, expected_start, expected_end, expected_margin_pct, details Json, property_ref; stage set below). `ZxProject` (+service_type, actual_end, agreement_ref, expected_profit, property_id, assigned_person_id, assigned_contractor_id, details Json; status set below). `ZxLedgerEntry` (+service_type, property_id, unit_id, source_type, source_id). `ZxPerson` unchanged.

New (all `org_id`, soft delete, registered in `config/db.js`):
- `ZxServiceType`
- `ZxProperty` (identification, type, address, area, current_use, status, acquisition cost lines, total_invested derived, valuation, valuation_date, valuation_notes)
- `ZxPropertyUnit` (property, floor/building text, name, area, status available|rented|sold|held|under_construction|under_renovation|vacant, valuation)
- `ZxPropertyLoan` (type, lender, amount, outstanding, emi, frequency, rate, start/end)
- `ZxPropertyValuation` (history rows; latest mirrors onto the property)
- `ZxPropertyEvent` (timeline: purchase, construction, valuation, rent, sale, loan, note)
- `ZxTenant`, `ZxLease` (tenant, unit, start/end, rent, deposit, due_day, payment method, status), `ZxRentDue` (lease, month, amount, due_date, status pending|paid|partial|waived), `ZxRentPayment` (due, amount, date, method, reference, collected_by_person_id, ledger_entry_id)
- `ZxPropertySale` (property or unit, sale value/date, selling costs, buyer party, ledger entry ids)
- `ZxTask` (person, property, unit, project, type, description, due, priority, status, amount, completed_on, rent_payment_id)

Stages/statuses: lead = new, in_discussion, negotiation (Proposal/Negotiation), won, closed, dropped, on_hold (existing contacted/site_visit/proposal map to in_discussion/negotiation via migration; lost -> dropped). Project = planned, active, on_hold, completed, cancelled, closed (existing planning -> planned).

Formulas (one pure module, `property.calc.js`, unit tested): total_investment = purchase + brokerage + documentation + registration + construction + renovation + other; appreciation = valuation - total_investment; appreciation_pct = appreciation / total_investment x 100; trading_profit = sale_value - total_investment - selling_costs; cash_flow = rent_collected - operating_expenses - EMI; consulting_revenue = transaction_value x commission_pct / 100.

## 4. Phases (each ends with tests, lint, build, docs, PROGRESS line)

| Phase | Scope | Brief sections |
|---|---|---|
| R0 | Service-type master + constants; migrate lead stages / project statuses; party fields (company, state, country, hold, interested services, vendor category); seed; Settings screen for service labels | 1, 2, 38 |
| R1 | Leads: service type, assignee (employee + contractor), opportunity fields, details, filters (service, stage, employee, date, location), pipeline per stage and per service, convert carries service + details | 3-6 |
| R2 | Projects: common fields, service sections (civil, interior, consulting form), actual vs estimated revenue/cost/profit from ledger, filters | 7-10, 20-21 |
| R3 | Property master: properties, units (floor/building), acquisition costs, financing, manual valuation + history, appreciation, timeline | 11-14, 32-34 |
| R4 | Tenants, leases, rent due generation, overdue, rent payments (collector), ledger posting, property cash flow | 15-19 |
| R5 | Property trading: sale at property or unit, realized profit, holding period, unit status updates | 14, 25 |
| R6 | Consulting: commission %, auto amount, deal/closing dates, revenue posting | 20-21, 41 |
| R7 | Finance integration (Delphic concept, Zephyr tables): ledger dimensions, expense claims with approval, group expenses split across projects/properties/units, P&L by service/property/client/vendor, unrealized appreciation shown apart, month-close coverage, statements | 22-26, 31 |
| R8 | Operational tasks for employees/contractors, link to rent collection | 27-28 |
| R9 | Zephyr dashboard (pipeline, projects by service, portfolio, finance, property finance, rent), service-wise reports with drill-down, role finish (finance role, contractor scope), full audit coverage, test pass, docs | 29-31, 35-36 |

## 5. API and UI additions

Server (under `/api/v1/zephyr`, same `zxAuthorize` caps pattern): `service-types`, `properties` (+`/units`, `/loans`, `/valuations`, `/events`, `/summary`), `tenants`, `leases`, `rent` (`/due`, `/generate`, `/payments`, `/overdue`), `sales`, `tasks`; extended `leads`, `projects`, `parties`, `ledger`, `overview`, `financials` filters. New capabilities in `access.js`: `properties`, `rent`, `tasks`, `propertyFinance`; finance role added.

Client (existing UI kit, theme and `SectionTabs`/`Drawer`/`Pill`): new sidebar sections **Properties** (list, property detail with Units / Tenants & leases / Rent / Finance / Timeline tabs) and **Tasks**; extended Leads, Projects, Client/Vendor forms; Home dashboard panels; Revenue & Profit gets service and property filters and an "Unrealized appreciation" card.

## 6. Testing impact

New jest files, run two at a time: `zephyr-services`, `zephyr-property`, `zephyr-rent`, `zephyr-trading`, `zephyr-consulting`, `zephyr-finance-links`, `zephyr-tasks`. Required cases: every formula in section 3; rent generation idempotent and overdue by date; closed-month lock on rent/sale/expense edits; appreciation never in P&L until a sale; lead -> project carries service and details; org isolation and role walls on every new route; stage/status migration maps old rows. Existing 71 Zephyr tests must keep passing (stage and status renames update their fixtures in R0). Shared-infra suites (erp-verticals, workspace-isolation, auth, uploads-auth) re-run once at the end because of migrations and `config/db.js`.

## 7. Risks and conflicts with existing behaviour

- Renaming lead stages and project statuses touches seeded demo data, tests, board columns and `projectMeta.js`; done once in R0 with a data migration, demo seed updated.
- Ledger gains nullable columns only; existing rows and the current P&L stay valid (`service_type` null = "Unassigned" until backfilled from the project).
- Delphic org data is untouched; Zephyr tables are org-scoped and gated by `enabled_modules`.
- Migrations on the Neon staging DB run on deploy (`prisma migrate deploy` at boot); each phase's migration must be additive. Staging demo data is re-seeded by hand (see TESTING-ZEPHYR.md section 5).
- Very large scope: phases are independent releases so staging can be shown after each one.

## 8. Work log

- 2026-10-06 - Plan written and saved. Owner confirmed the section 0 decisions, the phase order and the sidebar, and said to proceed.
- 2026-10-06 - **R0 + R1 + R2 built.** Migration `zephyr_services_leads_projects`. `ZxServiceType` master (five fixed keys, admin renames / hides in Zephyr setup > Services). Lead stages are now new, in_discussion, negotiation, on_hold, won, closed, dropped (old contacted / site_visit -> in_discussion, proposal -> negotiation, lost -> dropped; self-project fields removed from the UI). Leads gained a code (ZL-0001), service, company, address / city / state, assigned employee and contractor (roster people of the matching kind), expected start / end / profit, property reference, description and a free-form "deal details" list; filters by service, stage, employee, contractor, location, created date; pipeline by stage and by service. Projects gained a service, statuses planned / active / on_hold / completed / cancelled / closed, actual end, agreement reference, expected profit, assignees, description, a property link and a per-service `details` section (civil: site, units, phases; interior: scope and cost lines; consulting: property value, commission % with the amount computed on the server; management / trading: scope). Actual revenue, cost and profit come from the ledger. Client / vendor gained company, state, country, hold status, interested services (client) and vendor category / materials (vendor).
- 2026-10-06 - **R3 + R4 + R5 built.** Migration `zephyr_real_estate` (also carries the R6-R8 tables and the ledger columns). Properties with units (building / floor optional), acquisition costs, manual valuation with history, loans (monthly cost per frequency), a timeline and documents; money fields, valuation and loans are admin / finance only (`propertyFinance`). Tenants, leases (due day 1-28, no overlap), rent dues generated per month, overdue computed from the due date, payments with method, reference and collector posting a "Rental income" ledger entry, waiver with reason, reversal, lease end that frees the unit. Property cash flow = rent - operating expenses - EMI with a positive / negative status. Property trading: sale of a whole property or one unit books sale value, cost of the property sold and selling costs through the ledger, so realized profit reaches the P&L only then; unit cost basis = its allocated cost, else its area share of total investment; reversal by an admin with a reason.
- 2026-10-06 - **R6 + R7 built.** Consulting commission booked once as revenue ("Consulting commission") on the closing date. Ledger entries carry service, property and unit (a project lends its service); rent receipts, sales, commissions and shared expenses are system entries that can only be changed at their source. **A closed month is now a hard lock** for every actual entry, rent payment, waiver, sale and import (an admin reopens the month with a reason); the stale flag remains for pay-slip changes. Group (shared) expenses split one cost equally, by percent or by fixed amounts across projects, properties and units. P&L by service, property and client / vendor with filters (overview and statements, Excel / PDF / CSV); unrealized appreciation is shown beside the P&L, never inside it. Not built: an expense-claim approval flow like Delphic's ExpenseClaim (group expenses and the period lock were taken from Delphic's finance concept; claims were out of the brief's scope).
- 2026-10-06 - **R8 + R9 built.** Tasks (ZT-0001) for employees and contractors with property / unit / project links, priority, due date, amount; a staff member sees and moves only their own tasks; completing a rent task can record the rent payment credited to the collector. New `finance` roster role (property finance, rent, full ledger, shared expenses, P&L; no leads, people pay, settings or month closing). New dashboard API (`/dashboard`) and service-wise report (`/reports/services`), new Home dashboard, Properties, Rent and Tasks screens, an Overview with service / property / client filters, a "By service" report tab and a Shared expense form in the ledger. Demo seed rebuilt for the new model (`ZEPHYR_RESET=1` clears and rebuilds the demo business; a fourth login `finance@zephyrinfra.in`).
- 2026-10-06 - **UI polish after the first browser check (no API or schema change).** One shared `FilterBar` (`components/zephyr/FilterBar.jsx`): a search box, a single Filters button holding the dropdowns, removable chips for what is on, Clear all, page actions on the right. Used by Client / Vendor, Leads (service and stage became dropdowns with counts, the two strips were removed), Projects and Properties; Rent, Tasks, People and Revenue & Profit still use their old filter rows. Add and edit drawers on Client / Vendor close after a successful save. Zephyr theme is softer (`theme.css`: dimmer page and sidebar, off-white `bg-white` surfaces). Home was simplified: a greeting card with five quick tiles, Needs your attention, money this financial year in plain words, 12-month chart, Leads and Rent, Properties and a By service table; the Workspaces cards, nav buttons and valuation cards were removed. Header title of Home is now Dashboard. `StatCard` got a `tone` (warning / danger) so overdue and loss cards are amber or red instead of the brand green.
- 2026-10-06 - **Admin can edit everything: gaps closed after a browser pass (Playwright).** Found by clicking through every section as admin: a manual valuation, a manual timeline entry, a rent payment, a property sale, a shared expense, a lead activity, a lease, a rent due amount, a milestone (name, due date, weight, billing) and the lead / property / task code prefixes could be added or removed but not edited. New API: `PATCH /properties/:id/valuations/:vid`, `PATCH|DELETE /properties/:id/events/:eid` (manual entries only; system entries answer 409), `PATCH /rent/payments/:id` (reverse and re-record, ledger rebuilt), `PATCH /properties/:id/sales/:sid` (reverse and re-record), `PUT /ledger/group-expenses/:gid` (new split created, old one dropped), `PATCH|DELETE /leads/:id/activities/:aid`, settings now also take `lead_prefix`, `property_prefix`, `task_prefix`. Every edit keeps the money rules (future dates, balance cap, closed month, system entries). A failed edit of a payment or a sale restores the original. Also fixed: the Tasks page asked for rent dues with an empty `status` and got a 422 (the collect-rent picker was always empty), and a duplicate `future_actual` key in the routes. Tests: `zephyr-admin-edits` (new). Browser pass: client / vendor, leads, projects, properties, rent, tasks, people, ledger, financials and settings flows verified as admin.
- Open items: expense-claim approval flow (see above); lead / project / unit status sets are fixed lists; commission is booked by a button, not automatically; browser click-through by a person; staging needs the two new migrations (applied on deploy) and a `ZEPHYR_RESET=1` re-seed to show the new demo.
