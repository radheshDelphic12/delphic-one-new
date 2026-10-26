# Company career portals, Group debt management, Acconcy portfolio companies

Built 2026-10-26 (local, not pushed). Three additive migrations: `20261026100000_acconcy_investees`, `20261026110000_group_debt`, `20261026120000_company_jobs`.

## 1. Career portals for every company (Hiring)
- Delphic Global keeps publishing jobs from recruitment requirements (WebsiteJobPosting). Every other company has no requirements, so it gets its own `CompanyJob` and `CompanyJobApplication`.
- Public pages: the existing `/<org-slug>/career/` pages (server-rendered, relative links) now work for any active company. Header shows the company name (and logo when `logo_url` is a public http(s) link). An unknown company is a 404 (it used to show an empty list).
- nginx (client/nginx.conf, Dockerfile) and the Vite proxy forward `^/[a-z0-9-]+/career` instead of only `/delphic/career`.
- `jobSearch.loadOpen(orgSlug)` also loads the company's published jobs, so the list, search, filters, Job ID redirect and jobs.json work unchanged. `publicJobs.apply` hands a company job to `hiring.recordApplication` (same checks as Delphic's form; duplicate email per job = 409).
- Job ID: first three letters of the company slug + a per-company counter (`ZEP-0001`, NxCounter key `company_job`).
- Admin screen: sidebar "Hiring" (company admins, and the group superadmin inside a company) at `/hiring`: Jobs (create, publish, close, edit, delete, public link) and Applications (filters, paging, status pipeline new/shortlisted/interview/offered/hired/rejected, notes, Excel). API `/api/v1/hiring/*`, admin only; Delphic Global gets 409.
- Code: server/src/modules/hiring, client/src/pages/hiring/HiringPage.jsx. Tests: server/tests/company-hiring.test.js (+ career-pages updated for the 404).

## 2. Group Dashboard > Debt Management (next to Logs)
- Tables `group_loans`, `group_loan_installments` (one row per EMI: due date, principal, interest, balance after, paid or pending), `group_debt_settings` (max loan ratio %, basis valuation/assets/revenue; default 30% of valuation).
- A loan is entered with start date, tenure, rate and "EMIs already paid"; the reducing-balance schedule is generated (pure maths in superDashboard/groupDebt.calc.js). Marking an EMI paid also marks earlier ones; undoing one undoes later ones. A rate change on a loan rebuilds only what is still to pay; other money terms rebuild the schedule and keep the same number of EMIs paid. Credit limits have no schedule (drawn amount, sanctioned limit).
- Overview: outstanding, EMIs a month, weighted rate, interest paid / to pay, overdue EMIs, next EMI, breakdown by type / company / lender, 12-month repayment line chart, all loans, the loan ratio card (debt against valuation, assets or revenue from Group Finance totals, headroom, interest cover). Zephyr property loans are included read only.
- API `/super-dashboard/group/debt*` (group superadmin). Code: groupDebt.service.js, GroupDebtTab.jsx. Tests: server/tests/group-debt.test.js.

## 3. Acconcy portfolio companies
- Investments > "Portfolio companies": `ax_investees` (stage discussion, committed, funded, taken_over, exited, dropped; proposed amount and stake, expected return %, valuation, contact, notes, optional lead and deal). Each funding round is an ordinary `ax_investments` row (type venture, `investee_id`), so cost, current value and cash coming back (dividend with cost 0, part sale, exit) keep the existing arithmetic and ledger posting.
- Company-wise roll-up: invested, current value, returned, gain/loss %, multiple, stake; pipeline totals (proposed amount, expected yearly return). "Fund this company" records a round and moves the stage; "Record return" posts a realisation.
- Code: acconcy/investees.service.js, AcconcyInvesteesTab.jsx. Tests: server/tests/acconcy-investees.test.js.

## Assumptions (user did not answer the open questions)
Portal: same apply form as Delphic, applications seen by company admins and the group superadmin. Debt: ratio against group valuation, limit 30%, editable. Investments: returns come from dividends and sales (realisations); valuation changes stay unrealised.

## 4. Group Dashboard > Headcount & Hiring (2026-10-26)
One table for the whole group, next to Org Chart: every company with its teams, columns Current, New hires, Open positions, Target (current + open), a total row per company and a "Complete group" total, four KPI tiles, a company filter and a CSV export. It reads the group org chart data (`/org-chart/group`) and the same `teamCounts` the Org Chart's team table uses (exported from OrgChartPage.jsx), so the numbers match each company's Org Chart > Team View. Current and New hires include people in no team and contractors; Open and Target come from the teams. Client only: client/src/pages/groupOverview/GroupHeadcountTab.jsx.

## 5. Offices: headcount filters (2026-10-26)
The Offices page (`/offices`, group superadmin) has filters for Work mode (on-site / remote / hybrid / not set), Employee status (working now by default, active, serving notice, on leave, new hire, exited, all), User type (employee / contractor) and Department; the "people" count on every office card and a total follow them. API: `GET /orgs/locations/overview?work_mode=&status=&user_type=&department_id=` (orgs.service.js `officePeopleWhere`; the department is the membership's, else the person's). Test: internal-jobs-offices.test.js.
