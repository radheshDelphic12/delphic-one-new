# HR letters (People > Letters)

Built 2026-11-11, local. Migration `20261211110000_hr_letters` (tables `letter_templates`, `letter_counters`, `letters`).

## What it does
* **Templates** (admin): name, kind (offer, appointment, appraisal, relieving, experience, warning, or any label), who it is for (anyone, employees, new joiners, left employees, vendors, others), subject, letter text with `{{fields}}`, signatory, and the **serial number format**.
* **Issue** (HR): pick a template, pick who it is for - an employee (current or past), a candidate, a vendor or anyone else - see the live preview, type the fields that do not come from a record (for example `{{ctc}}`), issue. The PDF is drawn from the text stored on the letter.
* **Store**: every issued letter keeps its own final text, its fields, its recipient and its serial number. Filter by kind, status, person or vendor; search by serial number or name.
* **Cancel, never edit**: a wrong letter is cancelled with a reason (the PDF then carries a CANCELLED stamp) and a new one is issued.

## Fields
Fill themselves: `company_name`, `date`, `serial_number`, `recipient_name`, `recipient_email`, `recipient_address`, and for an employee `employee_name`, `employee_code`, `designation`, `department`, `joining_date`, `last_working_day`, `manager_name`, `work_email`. Any other `{{name}}` is asked for when the letter is issued. What HR types wins over the record.

## Serial numbers
Format tokens: `{PREFIX}` (the template prefix), `{FY}` (2026-27), `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}` (running number, n digits). Exactly one `{SEQ}` is required. The **series** is the format with the running number left out; each series has its own counter (`letter_counters`, incremented in one SQL statement so two people issuing at once never get the same number, and `UNIQUE (org_id, serial_number)` as a second guard). A new financial year in the format, or an edited format, starts a new series at 1; issued letters are never renumbered. Default format: `{PREFIX}/{FY}/{SEQ:4}` -> `OFR/2026-27/0001`.

## Access
New permission module **Letters**: `letters.view` (read), `letters.create` (issue, preview, cancel), `letters.manage` (templates and serial formats). Companies still on the old roles: admin only. Routes `/api/v1/letters/*`; screen People hub > Letters.

## Not in this version
Letterhead images and signatures (text signatory only), emailing the letter to the recipient, a letters list on the employee profile page, approval before issue. The company address is not stored on the company, so use `{{company_address}}` only if HR types it.
