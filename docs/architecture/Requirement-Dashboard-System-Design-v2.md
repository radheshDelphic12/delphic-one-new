# Requirement Management Dashboard — System Design (v1)

**Target launch:** 29–30 Aug 2026
**Stack:** React · Node.js/Express · PostgreSQL · existing VPS (Nginx + PM2)
**Tenancy:** single tenant
**v1 scope:** full core pipeline, assignment, locked audit history, margin tracking, reporting/export
**Deferred:** notifications (v2), vendor/client portals (v2), JIRA/Sheets migration (post-launch, last backlog item)

---

## 1. Data model — complete field specifications

### 1.1 user
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| name | text | not null | |
| email | text | unique, not null | login credential |
| password_hash | text | not null | bcrypt |
| role | enum | not null | `bda` · `sales` · `recruiter` · `admin` |
| phone | text | | optional contact |
| active | boolean | default true | soft-disable without deleting |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

---

### 1.2 account *(unifies Lead / Client / Vendor)*

#### 1.2.1 Core identity
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| type | enum | not null | `client` · `vendor` |
| name | text | not null | company/entity name |
| stage | enum | not null, default `lead` | `lead → meeting_scheduled → active / rescheduled / dropped` |

#### 1.2.2 Company information
| Field | Type | Constraints | Notes |
|---|---|---|---|
| industry | text | | e.g. "FinTech", "Healthcare", "E-commerce" |
| company_size | enum | | `startup` · `small` · `mid` · `enterprise` |
| website | text | | |
| location_city | text | | registered/HQ city |
| location_country | text | | |
| gst_or_tax_id | text | | GST (India), VAT (UAE/KSA), TRN, etc. |

#### 1.2.3 Primary contact
| Field | Type | Constraints | Notes |
|---|---|---|---|
| poc_name | text | | point of contact |
| poc_email | text | | |
| poc_phone | text | | |
| poc_designation | text | | e.g. "CTO", "HR Manager", "Procurement Lead" |

#### 1.2.4 Additional contacts (for accounts with multiple stakeholders)
| Field | Type | Constraints | Notes |
|---|---|---|---|
| additional_contacts | jsonb | default `[]` | array of `{name, email, phone, designation, role_label}` — "role_label" is freeform: "Technical Interviewer", "Finance Approver", etc. |

#### 1.2.5 Lead/meeting tracking
| Field | Type | Constraints | Notes |
|---|---|---|---|
| source | text | | how the lead came in: "referral", "cold call", "event", "inbound website", etc. |
| meeting_mode | enum | nullable | `online` · `offline` |
| meeting_date | timestamp | nullable | |
| meeting_notes | text | | free-form notes from BDA after the meeting |

#### 1.2.6 Vendor-specific fields *(only populated when type = vendor)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| vendor_specializations | text[] | | tech stacks/domains the vendor supplies for, e.g. `["React", "Java", "DevOps"]` |
| vendor_rate_range | jsonb | | `{min: number, max: number, currency: "INR"/"USD"/"AED"}` — typical hourly/monthly rate band |
| vendor_payment_terms | text | | e.g. "Net 30", "Monthly advance", "Milestone-based" |
| vendor_agreement_url | text | | link to signed MSA/NDA if uploaded |

#### 1.2.7 Client-specific fields *(only populated when type = client)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| client_billing_currency | enum | | `INR` · `USD` · `AED` · `SAR` · `EUR` · `GBP` |
| client_payment_terms | text | | e.g. "Net 15", "Net 30" |
| client_agreement_url | text | | link to signed MSA/SOW if uploaded |

#### 1.2.8 Workflow/system fields
| Field | Type | Constraints | Notes |
|---|---|---|---|
| owner_id | fk → user | not null | BDA who owns this lead |
| is_locked | boolean | default false | true once `stage = dropped` |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

---

### 1.3 requirement

#### 1.3.1 Core identity
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| account_id | fk → account | not null | must be `type=client`, `stage=active` |
| title | text | not null | e.g. "Senior React Developer", "Full-stack team for payments module" |
| req_type | enum | not null | `project` · `developer` |
| status | enum | not null, default `open` | `open` · `in_progress` · `on_hold` · `closed` · `dropped` |

#### 1.3.2 Role/position details
| Field | Type | Constraints | Notes |
|---|---|---|---|
| description | text | | detailed JD / scope of work |
| jd_document_url | text | | uploaded JD file (PDF/DOCX) |
| designation | text | | e.g. "Senior Software Engineer", "Tech Lead", "QA Analyst" |
| department | text | | client-side department if known |
| seats_total | int | not null, default 1 | number of developers needed |

#### 1.3.3 Technical requirements
| Field | Type | Constraints | Notes |
|---|---|---|---|
| primary_tech_stack | text[] | | must-have: `["React", "Node.js", "PostgreSQL"]` |
| secondary_tech_stack | text[] | | good-to-have: `["Redis", "Docker", "AWS"]` |
| domain_experience | text | | e.g. "FinTech", "Healthcare" — domain knowledge needed |
| experience_min | numeric | | minimum years |
| experience_max | numeric | | maximum years |
| certifications_required | text[] | | e.g. `["AWS Solutions Architect", "PMP"]` |

#### 1.3.4 Work arrangement
| Field | Type | Constraints | Notes |
|---|---|---|---|
| work_mode | enum | | `remote` · `onsite` · `hybrid` |
| work_location | text | | required if onsite/hybrid — city or office address |
| time_zone_preference | text | | e.g. "IST", "EST overlap", "Gulf time" |
| engagement_type | enum | | `full_time` · `part_time` · `contract` |
| contract_duration_months | int | | nullable, only for contract engagements |
| start_date_target | date | | when the client wants the developer to start |
| notice_period_max_days | int | | max notice period the client will accept (e.g. 30, 60, 90) |

#### 1.3.5 Budget & commercials
| Field | Type | Constraints | Notes |
|---|---|---|---|
| budget_min | numeric | | monthly/hourly — floor |
| budget_max | numeric | | monthly/hourly — ceiling |
| budget_currency | enum | default `INR` | `INR` · `USD` · `AED` · `SAR` · `EUR` · `GBP` |
| budget_type | enum | | `monthly` · `hourly` · `annual` · `fixed_project` |
| billing_notes | text | | any special terms — "rate renegotiable after 3 months", etc. |

#### 1.3.6 Priority & SLA
| Field | Type | Constraints | Notes |
|---|---|---|---|
| priority | enum | default `medium` | `low` · `medium` · `high` · `urgent` |
| sla_days | int | | target days to close — used in aging reports |

#### 1.3.7 Workflow/system fields
| Field | Type | Constraints | Notes |
|---|---|---|---|
| sales_owner_id | fk → user | not null | primary sales person |
| is_locked | boolean | default false | true once `status ∈ {closed, dropped}` |
| created_at | timestamp | auto | |
| closed_at | timestamp | nullable | set when last seat closes or requirement is dropped |
| updated_at | timestamp | auto | |

---

### 1.4 requirement_seat *(one row per developer needed)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| requirement_id | fk | not null | |
| seat_label | text | | optional label: "Backend Dev #1", "QA Lead" |
| seat_status | enum | default `open` | `open` · `interviewing` · `offer` · `bgv` · `closed` · `dropped` |
| closed_at | timestamp | nullable | |
| joined_at | date | nullable | **this is what counts as closure** |
| is_locked | boolean | default false | true once `seat_status ∈ {closed, dropped}` |

---

### 1.5 requirement_assignment *(multiple recruiters/sales per requirement — also serves as reassignment history)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| requirement_id | fk | not null | |
| user_id | fk → user | not null | |
| role_on_req | enum | not null | `sales` · `recruiter` |
| assigned_at | timestamp | auto | |
| unassigned_at | timestamp | nullable | null = currently active; rows are never deleted |
| assigned_by | fk → user | not null | |

---

### 1.6 profile *(candidate)*

#### 1.6.1 Personal information
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| name | text | not null | |
| email | text | | |
| phone | text | | |
| date_of_birth | date | | nullable — some BGV processes need this |
| gender | enum | | `male` · `female` · `other` · `prefer_not_to_say` — nullable |
| current_location | text | | city/state |
| willing_to_relocate | boolean | | |
| preferred_locations | text[] | | e.g. `["Bangalore", "Remote", "Dubai"]` |

#### 1.6.2 Professional details
| Field | Type | Constraints | Notes |
|---|---|---|---|
| current_company | text | | |
| current_designation | text | | |
| total_experience_years | numeric | not null | e.g. 4.5 |
| relevant_experience_years | numeric | | experience in the specific tech/domain being evaluated |

#### 1.6.3 Technical skills
| Field | Type | Constraints | Notes |
|---|---|---|---|
| primary_skills | text[] | | core competencies: `["Java", "Spring Boot", "Microservices"]` |
| secondary_skills | text[] | | `["Docker", "Jenkins", "AWS"]` |
| certifications | text[] | | `["AWS SAA", "Kubernetes CKA"]` |
| domain_experience | text[] | | `["FinTech", "E-commerce"]` |
| education | jsonb | | `{degree: "B.Tech CS", institution: "IIT Delhi", year: 2018}` |

#### 1.6.4 Compensation & availability
| Field | Type | Constraints | Notes |
|---|---|---|---|
| current_ctc | numeric | | annual or monthly — stored as annual, UI converts |
| current_ctc_currency | enum | default `INR` | `INR` · `USD` · `AED` · `SAR` |
| expected_ctc | numeric | | |
| expected_ctc_currency | enum | default `INR` | |
| ctc_negotiable | boolean | default false | |
| ctc_notes | text | | freeform: "open to equity component", "expects joining bonus" |
| notice_period_days | int | | current notice period in days |
| is_serving_notice | boolean | default false | |
| last_working_day | date | nullable | if already serving notice |
| earliest_join_date | date | | computed or manually entered |
| preferred_work_mode | enum | | `remote` · `onsite` · `hybrid` |

#### 1.6.5 Documents & links
| Field | Type | Constraints | Notes |
|---|---|---|---|
| resume_url | text | | uploaded file path/S3 key |
| linkedin_url | text | | |
| portfolio_url | text | | GitHub, portfolio site, etc. |
| other_documents | jsonb | default `[]` | array of `{label, url}` — "Aadhar", "PAN", "Passport", "Offer Letter", etc. |

#### 1.6.6 Sourcing & ownership
| Field | Type | Constraints | Notes |
|---|---|---|---|
| source | enum | not null | `internal` · `vendor` · `linkedin` |
| vendor_account_id | fk → account | nullable | only if source=vendor |
| vendor_profile_id | text | | vendor's own internal ID for this candidate, if any |
| added_by | fk → user | not null | recruiter who added |
| recruiter_notes | text | | internal notes not shared with client |

#### 1.6.7 System fields
| Field | Type | Constraints | Notes |
|---|---|---|---|
| is_active | boolean | default true | false = candidate opted out / DND |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

---

### 1.7 submission *(profile ↔ requirement_seat — many-to-many)*

#### 1.7.1 Core
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| requirement_seat_id | fk | not null | |
| profile_id | fk | not null | |
| stage | enum | not null, default `sourced` | see §2.2 |

#### 1.7.2 Commercials (per-submission, since the same profile may be submitted to different requirements at different rates)
| Field | Type | Constraints | Notes |
|---|---|---|---|
| proposed_rate | numeric | | rate proposed to the client for this candidate |
| proposed_rate_type | enum | | `monthly` · `hourly` · `annual` |
| proposed_rate_currency | enum | | `INR` · `USD` · `AED` · `SAR` |
| vendor_rate | numeric | nullable | cost from vendor, only for vendor-sourced profiles |
| vendor_rate_type | enum | nullable | |
| vendor_rate_currency | enum | nullable | |
| margin | numeric | generated | `proposed_rate − vendor_rate` (normalized to same type/currency) |
| margin_percentage | numeric | generated | `(margin / proposed_rate) × 100` |
| final_agreed_rate | numeric | nullable | filled after negotiation/offer stage |
| final_agreed_rate_type | enum | nullable | |

#### 1.7.3 Submission notes & tracking
| Field | Type | Constraints | Notes |
|---|---|---|---|
| submission_notes | text | | recruiter's pitch/rationale for this candidate |
| client_feedback | text | | feedback received from client post-submission |
| relevancy_score | int | check 1–10 | optional recruiter self-assessment of fit |

#### 1.7.4 Backout/rejection tracking
| Field | Type | Constraints | Notes |
|---|---|---|---|
| backout_stage | enum | nullable | which stage the backout happened at |
| backout_reason | text | | required if backout |
| rejection_stage | enum | nullable | which stage the rejection happened at |
| rejection_reason | text | | |

#### 1.7.5 Offer & joining
| Field | Type | Constraints | Notes |
|---|---|---|---|
| offer_date | date | nullable | |
| offer_ctc | numeric | nullable | final CTC in offer letter |
| offer_ctc_currency | enum | nullable | |
| expected_joining_date | date | nullable | |
| actual_joining_date | date | nullable | **this drives closure counting** |

#### 1.7.6 BGV tracking
| Field | Type | Constraints | Notes |
|---|---|---|---|
| bgv_initiated_date | date | nullable | |
| bgv_status | enum | nullable | `pending` · `in_progress` · `cleared` · `failed` |
| bgv_completed_date | date | nullable | |
| bgv_notes | text | | |

#### 1.7.7 System fields
| Field | Type | Constraints | Notes |
|---|---|---|---|
| submitted_by | fk → user | not null | recruiter who created this submission |
| is_locked | boolean | default false | true once `stage ∈ {closed, rejected}` |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

---

### 1.8 interview_round
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| submission_id | fk | not null | |
| round_number | int | not null | sequential per submission |
| round_type | enum | not null | `internal` · `client_l1` · `client_l2` · `client_hr` · `client_final` |
| round_name | text | | freeform label: "System Design Round", "Culture Fit" |
| scheduled_at | timestamp | | |
| duration_minutes | int | | expected duration |
| interviewer_name | text | | name of the interviewer (client-side or internal) |
| interviewer_email | text | | for calendar coordination |
| meeting_link | text | | Zoom/Meet/Teams link or office address |
| result | enum | default `pending` | `pending` · `pass` · `fail` · `no_show` · `rescheduled` |
| feedback | text | | |
| rating | int | check 1–10 | nullable |
| completed_at | timestamp | nullable | |

---

### 1.9 stage_history *(append-only audit log)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| entity_type | enum | not null | `account` · `requirement` · `seat` · `submission` |
| entity_id | uuid | not null | |
| from_stage | text | | |
| to_stage | text | not null | |
| changed_by | fk → user | not null | |
| reason | text | | required for `dropped` / `backout` / `rejected` / `unlock` |
| changed_at | timestamp | auto | |

---

### 1.10 document *(generic file attachment for any entity)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| entity_type | enum | not null | `account` · `requirement` · `profile` · `submission` |
| entity_id | uuid | not null | |
| label | text | not null | "Resume", "JD", "MSA", "Offer Letter", "PAN Card", etc. |
| file_url | text | not null | S3 key or local path |
| file_type | text | | mime type |
| file_size_bytes | int | | |
| uploaded_by | fk → user | not null | |
| uploaded_at | timestamp | auto | |

This replaces scattered `*_url` fields with a unified attachment system. The `resume_url`, `jd_document_url`, `vendor_agreement_url`, etc. fields in the entities above are **shortcuts** (denormalized for quick access to the most important document); the `document` table holds everything including additional uploads.

---

### 1.11 comment *(threaded notes on any entity)*
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK | |
| entity_type | enum | not null | `account` · `requirement` · `submission` |
| entity_id | uuid | not null | |
| user_id | fk → user | not null | |
| body | text | not null | |
| created_at | timestamp | auto | |

Gives every entity a comment thread — visible in the detail panel, useful for recruiter-to-sales coordination without needing a separate chat system.

---

## 2. Workflow / state machines

### 2.1 Account (Lead) stage flow
```
lead → meeting_scheduled → active
                         → rescheduled → meeting_scheduled (loops)
                         → dropped (terminal, at any point)
```
Same machine for both `type=client` and `type=vendor`.

### 2.2 Submission pipeline
```
sourced → internal_screening → submitted_to_client → interview_scheduled
→ interview_result → offer → bgv → closed
```
From **any** stage: `backout` (reason required, seat reopened manually) or `rejected`.

`interview_result` supports multiple rounds — submission advances to `offer` only once all required rounds pass.

### 2.3 Requirement seat status (derived)
`open → interviewing → offer → bgv → closed` (or `dropped`). Auto-derived from furthest-advanced active submission; recruiter can override manually.

---

## 3. Record locking

- Every core entity carries `is_locked`, auto-set on terminal state.
- Once locked: `PATCH`/`PUT` returns `403 Locked`. Only `GET` allowed.
- Admin can unlock via `POST /{entity}/:id/unlock` with mandatory `reason` — logged in `stage_history`. Re-locks on next terminal transition.
- Locked records remain fully visible in reports and list views — locking affects editability, not visibility.

---

## 4. Roles & permissions

| Role | Account | Requirement | Submission | Assignment | Unlock | Reports |
|---|---|---|---|---|---|---|
| BDA | View/edit **all** (stage, meeting, type, brought-by); unlock accounts | View all | View | — | Accounts only | Own-lead metrics |
| Sales | View all; create requirement on active clients | Create/edit own; assign recruiters | View | Assign recruiters to own requirements | — | Own requirements |
| Recruiter | View all | View assigned | Full CRUD on assigned requirements | — | — | Own submissions |
| Admin | Full | Full | Full | Full | Any entity | All org-wide |
| Superadmin | Full + locked-row edit + stage override | Full | Full + stage override | Full | Any entity | All org-wide |

---

## 5. API design

```
POST   /auth/login
POST   /auth/refresh

GET    /accounts               ?type=&stage=&owner_id=&origin_owner_id=&specialization=&search=
GET    /accounts/specializations
POST   /accounts
PATCH  /accounts/:id
POST   /accounts/:id/stage      { to_stage, reason? }
POST   /accounts/:id/classify

GET    /requirements            ?status=&sales_owner=&account=&priority=&tech_stack=
POST   /requirements
PATCH  /requirements/:id
POST   /requirements/:id/assign { user_id, role_on_req }
POST   /requirements/:id/unassign { assignment_id }

GET    /requirements/:id/seats
POST   /requirements/:id/seats
POST   /seats/:id/stage         { to_stage, reason? }

GET    /profiles                ?source=&vendor=&skills=&experience_min=&experience_max=&available=
POST   /profiles
PATCH  /profiles/:id

GET    /submissions             ?seat_id=&profile_id=&stage=&submitted_by=
POST   /submissions
PATCH  /submissions/:id
POST   /submissions/:id/stage   { to_stage, reason? }
POST   /submissions/:id/interview-rounds
PATCH  /interview-rounds/:id

POST   /documents               (multipart upload)
GET    /documents?entity_type=&entity_id=
DELETE /documents/:id

GET    /comments?entity_type=&entity_id=
POST   /comments

POST   /admin/:entity/:id/unlock { reason }

GET    /reports/recruiter-performance  ?date_from=&date_to=
GET    /reports/sales-performance      ?date_from=&date_to=
GET    /reports/vendor-performance     ?date_from=&date_to=
GET    /reports/aging                  ?threshold_days=
GET    /reports/export?type=xlsx|pdf&report=...&date_from=&date_to=
```

---

## 6. Reports & analytics

**Recruiter performance** — profiles sourced (by source) vs. submitted vs. interviewed vs. closed; conversion funnel; avg. time-in-stage; backout/rejection rate; active submissions per recruiter.

**Sales performance** — leads converted vs. dropped; requirements opened vs. closed; avg. closure time; budget pipeline by client; margin generated.

**Vendor performance** — profiles submitted vs. shortlisted vs. closed per vendor; avg. margin per vendor; backout rate; avg. time-to-submit.

**Aging/SLA** — requirements open > X days with zero submissions; leads stuck > X days; submissions stuck in one stage > X days; requirements past target close date (`sla_days`).

**Closure report** — closed requirements with actual joining dates, final agreed rates, margins; grouped by month/quarter, client, recruiter.

All in-dashboard (Recharts) + exportable to Excel/PDF via server-side endpoints.

---

## 7. Architecture & deployment

```
Internet → Nginx (SSL via Certbot)
             ├── /           → React static build
             └── /api        → Node/Express (PM2 cluster mode)
                                  → PostgreSQL (same VPS)
                                  → local disk / S3 for uploads
```

Nightly `pg_dump` cron for backups. Deploy via scripted `git pull` + `npm build` + `pm2 reload`.

---

## 8. Security

JWT (short-lived access + refresh token), bcrypt passwords, role middleware on every route, Zod/Joi input validation, rate limiting on `/auth/login`, CORS locked to frontend domain, HTTPS only.

---

## 9. JIRA/Sheets migration — deferred, post-launch

Export → CSV/JSON → one-off script mapping to new schema → imported records enter as `is_locked = true` → admin unlock if corrections needed → validate on staging copy first → then production.

---

## 10. Build plan (Aug 20 – Aug 29/30)

| Days | Focus |
|---|---|
| Day 1 | Schema + migrations, VPS setup (Nginx/PM2/PG), auth + role scaffolding |
| Day 2–3 | Account module (all fields, stage flow, history, locking, comments, documents) |
| Day 3–4 | Requirement + seat module + assignment (all fields, tech stack matching, priority) |
| Day 4–6 | Profile (full candidate data, CTC, skills, availability) + Submission pipeline (stages, commercials, margin calc, interview rounds, backout, BGV tracking) |
| Day 6–7 | Reports/analytics screens + Excel/PDF export |
| Day 7–8 | UI polish (Jira-style grid with filters, column sorting, search), QA |
| Day 8 | Deploy, smoke test, buffer |
| *Post-launch* | Notifications (v2) → JIRA/Sheets migration (last) |

---

## 11. Open items
1. **Aging/SLA threshold** — default days before flagging stuck leads/requirements/submissions?
2. **CTC storage convention** — store all CTCs as annual and let UI convert to monthly, or store the raw value + a period enum?
3. **Currency conversion** — for margin calculations across INR/USD/AED submissions, use a fixed exchange rate table (admin-editable) or skip cross-currency margin calc in v1?
