# Group Travel > Client deployments

Built 2026-11-04 from the "Group Travel Module - Client Onsite Travel & Long-Term Resource Deployment Management" spec. The old **Trips** screen
is unchanged; **Client deployments** sits beside it (Group Dashboard > Travel, `?section=travel&sub=deployments`).

## What a deployment is
A record of its own (not a trip): `group_deployments` with `kind` visit / assignment / deployment (short, medium, long term), client, client
location, client-side supervisor, optional Project Management project (`pm_project_id`, never mandatory), purpose, start / expected end /
actual end, working arrangement (client office / remote / hybrid), reporting manager, project / delivery manager and the company whose people go.
Status: `draft -> pending_approval -> approved -> active -> closed` (or `cancelled`). Codes are `DEP-0001`, numbered per group.

| Table | Holds |
|---|---|
| `group_deployment_people` | who is deployed (any company or an outsider), role, own arrangement, dates, `active / released / replaced`, release reason, `replaces_id` |
| `group_deployment_budget_lines` | the estimate: category (tickets, accommodation, food, local conveyance, other), amount, one-time or monthly, funding (company / client / shared + client % / client-reimbursable), billable |
| `group_deployment_travel` | flight, train, bus, local transport, accommodation: from / to, dates, vendor, booking ref, estimated cost, planned / booked / completed / cancelled |
| `group_deployment_events` | the history of everything below |
| `group_deployment_requests` + `_request_steps` | approval requests (deployment, extension, change of people, budget revision, spend over budget) and their ordered steps |
| `group_deployment_expenses` | actual expenses with bill, verification, settlement and client recovery |
| `group_deployment_logs` | the deployed person's daily onsite log: where (client office / remote), hours, activities, deliverables, pending tasks (one row per person per day) |
| `group_deployment_reviews` | weekly progress review (dated to its Monday) and monthly client feedback (dated to the 1st) |
| `group_deployment_settings` | per group: the approval chain and its rules (admin-editable) |

Migration `20261118100000_group_deployments` (additive, 11 tables). Maths lives in `deployments.calc.js` (pure, unit tested).

## Budget maths
- Months = 30-day blocks of the deployment, at least one. A **monthly** line counts for every month, a **one-time** line once.
- Estimate total = one-time + monthly x months. Split three ways: **company bears** (company-funded + its share of shared lines), **client pays directly**
  (client-funded + its share), **to recover** (reimbursable lines the company pays first). Also billable vs non-billable.
- Actual = every expense that is not rejected. Variance = estimate - actual (negative = over budget). Month by month: budget (monthly lines, plus
  the one-time lines in the first month) against actual.
- An expense's `client_amount` is the client's part (client = all, shared = its %, reimbursable = all). **Pending client recovery** =
  client part of verified / settled expenses minus what has been recovered.

## Approvals (configurable)
Settings (Travel > Client deployments > Approval settings): the chain in order (reporting manager, project / delivery manager, Finance,
Administration - reorder, remove, add), emergency allowed, extension needs approval, change of people needs approval, spend-over-budget tolerance %,
"ending soon" days. Defaults: all four steps, everything needs approval, 0 % tolerance, 14 days.
- **Submit** needs at least one person and a budget (an **emergency** submit needs a reason instead and may **start before approval is complete**).
  A manager step with nobody named is skipped. With an empty chain the deployment is approved at once.
- Steps run in order; only the next step can be decided. The reporting / delivery manager step is decided by the person named on the deployment,
  Finance by someone holding Finance work (same rule as payments), Administration by a company admin; **a group admin may decide any step**.
  A rejection needs a reason and sends a deployment back to draft.
- Once submitted, an **extension** of the end date, a **change of people** (add / replace / release early) and a **budget revision** are requests that
  apply only when approved (draft: immediate). An expense that takes the total past the estimate (plus tolerance) is flagged **over budget** and opens a
  Finance + Administration request; Finance cannot verify it until that is approved.

## Who does what
- **Group admin** (Group Dashboard > Travel > Client deployments): dashboard, list, create / edit, submit, start, extend, close, cancel, people, budget,
  travel, expenses, reviews, approvals queue, Finance queue, settings. API under `/super-dashboard/group/deployments`.
- **Deployed people / managers / Finance** (Time & Attendance > Client deployments, shown only to people who have something there): log the day (office or
  remote, hours, activities, deliverables, pending), submit expenses with a bill, see their approval steps, managers read team logs and write weekly
  reviews / client feedback and submit expenses for their people, Finance verifies, settles and records client payments. API under `/deployments`.
- A bill is a protected upload (`deployment-*` files): readable by the group admin, Finance, who submitted it and the deployment's managers.

## Dashboard (every count opens the records behind it)
Active deployments, people deployed, ending soon, draft / waiting, estimated budget, actual spend, client still owes, waiting for approval, billable
and client-funded spend, expenses to verify, over budget; client-wise, project-wise and company-wise resources (deployments and people counts);
upcoming end dates; month by month budget vs actual; pending client recoveries; recent history. Tiles open the filtered list, the approvals queue
or the Finance queue; rows open the deployment on the right tab.

## Not built (and why)
- No notifications / e-mails on approval steps yet (people see their steps under Client deployments).
- Attendance here is the deployment's own daily log; it does not write to the company attendance or pay.
- Costs are not posted to the project P&L automatically; the project link is for allocation and the dashboard's project-wise view.
