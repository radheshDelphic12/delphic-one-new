# RD-115 — Spec / UX walkthrough (Aug 21)

**Status:** Complete for owned + post-merge surfaces (updated after Dev A/B merge; RD-114/128 landed)  
**Sources:** [API-Spec-and-Build-Plan.md](../architecture/API-Spec-and-Build-Plan.md), [UI-UX-JIRA.md](UI-UX-JIRA.md), [SPRINT-PLAN.md](../progress/SPRINT-PLAN.md)

## 1. Purpose

Page-by-page check: does each intended screen/button exist, and do primary lists feel Jira-like (dense filters + issue keys)?

## 2. Surfaces checked

| Surface | Status | Notes |
|---|---|---|
| Login + quick role login | Present | RD-131 |
| Role dashboard home | Present | RD-113 — named dashboard, role widgets, stuck + activity |
| Accounts list / detail / create / edit / stage move | Present | RD-101/102 — Basic filter bar, ACC keys |
| Account Notes + Files | Present | RD-109/110 |
| Account Unlock (admin) | Present | RD-127 |
| Profiles list / detail / create / edit / resume files | Present | RD-105 — Basic filter bar, PRF keys |
| Profile Notes + Files | Present | RD-109/110 |
| Requirements list | Present | Dense Basic filters + REQ keys; Assign recruiter (RD-106); + Create |
| Requirement detail | Present | RD-103 — seats + stage controls, status, assignees, history; Notes/Files; Unlock job + locked seats |
| Add / Edit Job + status + Add seat | Present | RD-104 — `/requirements/new`, `/:id/edit` |
| Kanban board | Present | RD-112 — `/requirements/:id/board` |
| Submissions list | Present | Dense Basic filters + SUB keys; + Put forward |
| Submission detail | Present | RD-107/111 — stage stepper + move buttons; Notes/Files; Unlock; commercials/BGV |
| Put candidate forward | Present | RD-108 — `/submissions/new` |
| Interview rounds UI | Present | RD-125 — internal + client, feedback + rating |
| Reports charts (not raw JSON) | Present | **RD-114** — tables/charts, date range, Excel/PDF |
| Admin Users | Present | RD-126 |
| Unlock UI | Present | RD-127 on account / requirement / seat / submission |
| Change password | Present | **RD-128** — header avatar menu |

## 3. Jira-like UX checklist

- [x] Dense list + Basic filter bar on Accounts, Profiles, Requirements, Submissions
- [x] Issue-style keys (ACC / PRF / REQ / SUB) + title links
- [x] Compact top chrome (Delphic brand, role chip, avatar initial)
- [x] Detail issue headers with status + Locked badge where relevant
- [x] Create from list for Jobs (+ Create) and Submissions (+ Put forward)
- [x] Kanban alternate view — RD-112
- [x] Rich report charts — RD-114
- [x] Change password from header — RD-128

Compared against [references/jira-like-dashboard-reference.png](references/jira-like-dashboard-reference.png) for filter/list density on owned pages.

## 4. Fixes landed

1. **RD-127** — reusable `UnlockButton`; wired on locked account, requirement, seat row, and submission.
2. **RD-109 / RD-110** — `NotesPanel` + `FilesPanel` on Account, Candidate, Job, and Submission detail.
3. **Requirements / Submissions lists** — Basic filter bar, mono keys, denser rows, footer count.
4. **AppLayout** — Delphic brand, tighter header, role chip + initials avatar; profile menu for password + logout.
5. **Post-merge (Aug 21)** — re-wired Notes/Files/Unlock onto Dev B Job + Submission detail pages after stash/main merge overwrote thin shells.
6. **RD-114 / RD-128** — reports charts/export + change password modal.

## 5. Explicitly still open

- **RD-116 / RD-119 / RD-120 / RD-121 / RD-122** — linter, E2E, CI smoke, deploy
