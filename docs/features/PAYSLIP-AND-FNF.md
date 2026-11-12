# Payslip fixes and the FnF statement / documents package

Built 2026-11-09, local, not pushed.

## Payslip: overtime and add-ons now show
The slip printed "Gross salary" as one number (monthly pay + approved overtime), so the overtime was hidden, and the print had no attendance / overtime table.
Now (screen and printed slip, built from `payslipDetail` in `payroll.service.js`):
- earnings lines: **Monthly pay**, **Overtime (approved) - hours x rate x multiplier**, then **Gross salary**; loss of pay; an **Add-ons** group (variable pay, OT adjustment,
  reimbursement, other additions, each with its note) and an **Other deductions** group (TDS adjustment, other deductions); the final net.
- the printed slip carries the attendance / overtime breakdown (approved overtime hours, overtime amount, hourly rate ...).
- `detail.earnings`, `totals.expected_net` and `needs_refresh`: when an add-on or deduction was added **after** the payroll was processed, the frozen net no longer holds it. The slip
  then says so ("use Update payroll on the run") instead of silently showing lines that do not add up.

## FnF statement and documents package (People > Exits > FnF > "Statement & documents")
- **Statement** (`payroll/fnfStatement.service.js`): salary still due from the payslips (net - paid), the last month when it has no payslip yet (worked out from attendance up to the
  last working day), plus **lines added by hand** (leave encashment, notice-period recovery, advances ... stored in `fnf_records.items`); total earnings, deductions, **net payable**;
  leave balance at exit, salary history and the payslips on record for reference.
- **Documents package**: `GET /payroll/fnf/:membershipId/documents.zip` = `FnF-Statement.pdf` + one `Salary-Slips/YYYY-MM-Salary-Slip.pdf` per processed payslip since joining
  (server-side PDFs, `payroll/payslipPdf.js`). Also `statement.pdf` on its own.
- **Email**: `POST /payroll/fnf/:membershipId/email { to_email, note }` queues one mail with the zip attached (outbox now supports one attachment, `email_outbox.attachment_path`;
  the file is deleted after it is sent; Graph and SMTP both). Over 3 MB it is refused (download and share instead). Use their personal address; the work mailbox is usually closed.
- Migration `20261124110000_fnf_statement_attachments` (additive: `fnf_records.items`, `email_outbox.attachment_path/name`). Tests: `fnf-statement.test.js`, `payslip-detail.test.js`.
