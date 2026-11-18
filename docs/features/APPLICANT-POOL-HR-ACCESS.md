# Applicant pool: Assign to me / Create profile for HR-type people (2026-11-17)

Reported by Sarthak Solanki and Deepak Jain (HR set, Delphic Global): the buttons "Assign to me" and "Create profile" were missing, then "Applicants can only be given to a recruiter".

## Root causes (two layers, both only visible in a company on the permission model)
1. **Screen** (`client/src/pages/pipeline/ApplicantPoolBoard.jsx`): buttons were gated on `user.role` being recruiter / admin. In a company on permissions the server derives role `admin` for a set that spans several modules (HR) and `uiRole()` (lib/access.js) deliberately shows it as `employee`, so the buttons vanished.
2. **Server** (`applicants.service.assign`): eligibility read the GLOBAL `users.role`. Sarthak's global role is `recruiter` (passed), Deepak's is `employee` (refused); Chahak / Tanvi are `sales` (would be refused).

## Fix (additive, commit 933bc6e on main)
- "HR-type" = in a company on permissions, a set whose **base role is `recruiter`** (HR, HR Admin, HR Super Admin, Interviewer) that holds **Applicants > Update**; Admin / Super Admin always. `access.set` now carries `base_role` (`lib/access/load.js`).
- Screen: `canClaim` / `canWork` = old role rule OR `hrType`. Server: `assign` accepts the old global-role rule OR `roleInCompany().eligible`; the requirement assignment is created for them like any recruiter.
- Sales sets (base role sales) are NOT given claim, as before. Prod before/after for 58 permission-mode people: only Deepak (server + screen), Sarthak and Nikhil Yadav (screen) change.
- A new HR hire gets it from the HR set, no manual role change. Quick workaround that also works: set the person's global and company role to recruiter.
- Earlier step (33e59a4) briefly showed the buttons to everyone holding Applicants > Update; 933bc6e narrowed it to the rule above.

## Pitfall to remember
Any screen still testing `user?.role` can hide actions from an HR / multi-module set in a company on permissions. Use `allowed()` / `adminFor()` / `hasNeed()` from `lib/access.js`, and on the server never trust the global `users.role` for a company decision.
