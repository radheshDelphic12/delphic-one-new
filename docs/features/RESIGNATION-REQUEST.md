# Employee resignation request - proposal for discussion

Status: proposal only, nothing built. Written for discussion with Paras. Updated with the decisions from the first discussion (section 2).

## 1. Problem

An employee cannot resign from their own panel. Today only HR/Admin (permission `people.update`) can record a resignation:

1. People > employee profile > Edit.
2. Set **Employment status** to "Serving notice" (`notice_period`).
3. Fill **Notice given on** (`notice_start_date`) and **Last working day** (`notice_end_date`).

Source: `client/src/pages/people/EmployeeProfilePage.jsx` (edit drawer), `client/src/lib/employeeOptions.js`.

After the last working day (LWD), the nightly job `server/src/jobs/lwdExit.js` moves the person to "Exited" (`terminated`), sets `left_at`, and starts the Full & Final settlement (`ensureFnf`).

What is missing:
- No way for the employee to submit a resignation.
- No manager conversation / retention step, no approval step, no reason of leaving.
- No exit checklist (assets, clearance).

## 2. Decisions so far

1. **Where:** employee's own panel > **Settings > Account** section, with a "Resign" button.
2. **Manager retention call first.** Before HR acts, the reporting manager talks to the employee (exit-interview style: what is the problem, why leaving, try to retain). The manager marks a **"Meeting done" checkbox** and records their input and the final update on it (retained / not retained).
3. **No automatic F&F.** After HR approves, HR gets an option to move the person into the F&F process. F&F only happens after the notice period, so the **LWD is selected at approval** and F&F is started by HR with that action.
4. Everything else as in the earlier proposal: the employee never changes `employment_status` directly; the old HR Edit drawer keeps working.

## 3. Proposed flow

```
Employee: Settings > Account > "Resign" (reason, proposed LWD)
        |  status = submitted, reporting manager notified
        v
Manager: retention call
        - ticks "Meeting done" (date of meeting)
        - records the employee's problem / reason, what was offered
        - final update: Retained (employee withdraws) or Not retained
        |  manager's update is visible to HR
        v
HR/Admin: sees employee reason + manager's input
        - Approve (selects the final LWD) or Reject with remarks
        |  on approve
        v
OrgMembership: employment_status = notice_period,
               notice_start_date, notice_end_date (= selected LWD) set
        |
        v
HR action "Move to F&F" becomes available (not automatic)
        |  starts the existing F&F process for that LWD
        v
Existing exit: nightly job -> terminated + left_at (see open question 1)
```

Key rule: **the employee never changes `employment_status` directly.** Only HR approval does, and it performs the same update the HR Edit drawer does today.

## 4. What stays untouched

- HR Edit drawer (HR can still set notice/exit directly).
- Payroll, attendance, leave, org chart queries that depend on `employment_status`.
- F&F calculation itself (`server/src/lib/fnf.js`, `payroll/fnf.service.js`). Only the way it is started for a resignation changes (section 5.3).

## 5. Backend design

### 5.1 New model `ResignationRequest` (new migration, no existing table altered)

| Field | Notes |
|---|---|
| id, org_id | standard, org-scoped like other models |
| membership_id | the employee (`OrgMembership`) |
| reason, reason_category | employee's reason (better opportunity, personal, relocation, other) |
| proposed_lwd | date the employee asks for |
| status | `submitted`, `manager_reviewed`, `approved`, `rejected`, `withdrawn`, `retained` |
| manager_id | reporting manager at the time of submit |
| meeting_done, meeting_date | the manager's checkbox and date |
| manager_notes | problem / reason found in the call, retention offered |
| manager_outcome | `retained` or `not_retained` |
| manager_updated_at | when the manager filled it |
| approved_lwd | the LWD HR selects on approve |
| reviewed_by, reviewed_at, review_remarks | HR decision |
| fnf_started_at, fnf_started_by | set when HR uses "Move to F&F" |
| submitted_at | timestamp |

### 5.2 Endpoints (new module, e.g. `server/src/modules/resignations`)

- Employee: submit, withdraw (while not yet approved), get my request.
- Manager: list requests of direct reports, `PUT :id/manager-review` (meeting_done, date, notes, outcome).
- HR: list (filter by status), `POST :id/approve` (needs `approved_lwd`), `POST :id/reject`, `POST :id/start-fnf`.

### 5.3 Approve and Move to F&F

- **Approve** reuses the same membership update the Edit drawer performs (status `notice_period`, `notice_start_date`, `notice_end_date` = approved LWD). One transaction with the request status change. Extract a shared helper if that update is inline today.
- **Start F&F** is a separate HR action, enabled only after approval. It calls the existing `ensureFnf(prisma, org_id, membership_id, lwd)`.
- Today `lwdExit.js` calls `ensureFnf` automatically when someone exits. To honour "not automatic" for resignations this needs one decision (open question 1).

### 5.4 Validation / guards

- Employee can act only on their own record; manager only on their direct reports; HR via permission.
- One open request per membership; not allowed if already `notice_period` or `terminated`.
- Approve is blocked until the manager has recorded the retention call, unless HR explicitly overrides (open question 3). Retained outcome closes the request.
- LWD on/after today and on/after the joining date.
- Approve and Start F&F are idempotent-safe (second call is an error/no-op, not a second update).

### 5.5 Permissions

- Employee: no admin permission, own record only.
- Manager: derived from the reporting line, not a role.
- HR approve/reject/start F&F: `people.update`, or a new `people.resignation` permission. Must be registered in the central route table (roles/permissions restructure) and covered by the permission-matrix test.
- Per-company on/off switch.

### 5.6 Notifications

- Submit: reporting manager (and HR informed).
- Manager review saved: HR.
- Approve/reject/retained: employee. Start F&F: employee and finance, if wanted.
- Reuse the existing notification mechanism (to confirm which one the Project Management module used).

## 6. Frontend design

- **Employee: Settings > Account.** A "Resignation" section with a "Resign" button. States: none, submitted (waiting for manager), under HR review, approved (LWD shown), rejected (remarks), retained. "Withdraw" until approved.
- **Manager:** "Resignation requests" list for their team. Each opens a panel with the employee's reason, the **"Meeting done" checkbox + date**, notes, and the final update (retained / not retained).
- **HR:** list under People with a pending-count badge. Detail shows employee reason and the manager's input side by side. Approve dialog has a mandatory LWD picker (shows the resulting notice days). After approval a **"Move to F&F"** button appears.
- Profile peek already shows the LWD once the status is `notice_period`.

## 7. Admin-editable settings (per standing rule)

- Default notice period in days (to suggest the LWD), per company.
- Reason categories list.
- Whether the manager step is mandatory before approval.
- Feature on/off per company.

## 8. Phasing

**Phase 1:** model + migration, employee button, manager retention step, HR approve/reject with LWD, Move to F&F action, notifications, tests.

**Phase 2 (optional):** resignation letter upload, exit checklist (assets, access, clearance), structured exit-interview form, notice buyout / shortfall in F&F.

## 9. Tests (targeted only)

- Submit; duplicate blocked; withdraw.
- Manager review: only the reporting manager can save; retained closes the request.
- Approve: membership becomes `notice_period` with the selected LWD; reject leaves membership unchanged.
- Start F&F: only after approval, once only, calls `ensureFnf` with the LWD.
- Guards: already on notice, already terminated, other employee's id, past LWD.
- Permission matrix entry; existing `lwd-exit` test still green.

## 10. Open questions for Paras

1. **F&F start:** the nightly job currently creates the F&F automatically on exit. For resignations, should it (a) stop auto-creating and wait for HR's "Move to F&F", or (b) keep auto-creating at exit, with "Move to F&F" only allowing HR to start it earlier?
2. Can HR start F&F before the LWD, or only on/after it?
3. Can HR approve without the manager's retention update (override), or is it strictly blocked until the manager fills it?
4. If the employee has no reporting manager, who does the retention call?
5. If the manager does not act, should it escalate to HR after N days?
6. Default notice period: one value, or by role/company/employment type? Contractors too?
7. Which companies first (Delphic only, or all)?
8. Is the employee's proposed LWD binding, or only a suggestion?
9. Notifications: in-app only, or email as well?
