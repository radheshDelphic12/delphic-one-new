# Requirement Management Dashboard — Complete API Specification & Build Plan

**Default currency:** INR (all monetary fields default to INR; currency enum available for international clients/vendors)
**Base URL:** `https://{domain}/api/v1`
**Auth:** Bearer JWT on every request except `/auth/login`
**Response envelope:** all responses follow `{ success: boolean, data: T, message?: string, errors?: [] }`
**Pagination:** list endpoints accept `?page=1&limit=20` and return `{ data: [], pagination: { page, limit, total, totalPages } }`

---

## 1. Authentication

### POST /auth/login
```
Request:
{
  email: string (required),
  password: string (required)
}

Response 200:
{
  success: true,
  data: {
    access_token: string,          // JWT, expires 1h
    refresh_token: string,         // expires 7d
    user: {
      id: uuid,
      name: string,
      email: string,
      role: "bda" | "sales" | "recruiter" | "admin",
      active: boolean
    }
  }
}

Response 401:
{ success: false, message: "Invalid credentials" }
```

### POST /auth/refresh
```
Request:
{
  refresh_token: string (required)
}

Response 200:
{
  success: true,
  data: {
    access_token: string,
    refresh_token: string
  }
}
```

### POST /auth/change-password
```
Request:
{
  current_password: string (required),
  new_password: string (required, min 8 chars)
}

Response 200:
{ success: true, message: "Password changed" }
```

---

## 2. Users (admin only, except GET /users/me)

### GET /users/me
```
Response 200:
{
  success: true,
  data: {
    id: uuid,
    name: string,
    email: string,
    phone: string | null,
    role: "bda" | "sales" | "recruiter" | "admin",
    active: boolean,
    created_at: datetime
  }
}
```

### GET /users
**Roles:** admin
```
Query params:
  ?role=bda|sales|recruiter|admin
  &active=true|false
  &search=string              // name or email substring
  &page=1&limit=20

Response 200:
{
  success: true,
  data: [UserObject],
  pagination: { page, limit, total, totalPages }
}
```

### POST /users
**Roles:** admin
```
Request:
{
  name: string (required),
  email: string (required, unique),
  password: string (required, min 8),
  role: "bda" | "sales" | "recruiter" | "admin" (required),
  phone: string | null
}

Response 201:
{
  success: true,
  data: UserObject
}
```

### PATCH /users/:id
**Roles:** admin
```
Request (all optional):
{
  name: string,
  email: string,
  role: "bda" | "sales" | "recruiter" | "admin",
  phone: string,
  active: boolean
}

Response 200:
{ success: true, data: UserObject }
```

---

## 3. Accounts (Lead / Client / Vendor)

### AccountObject (full response shape)
```
{
  id: uuid,
  type: "client" | "vendor" | null,   // null = lead not yet classified (v2) — see POST /accounts/:id/classify
  name: string,
  stage: "lead" | "meeting_scheduled" | "active" | "rescheduled" | "dropped",

  // Company info
  industry: string | null,
  company_size: "startup" | "small" | "mid" | "enterprise" | null,
  website: string | null,
  location_city: string | null,
  location_country: string | null,
  gst_or_tax_id: string | null,

  // Lead capture (v2)
  lead_generated_date: date | null,
  location: string | null,             // free-text, lighter-weight than location_city/location_country
  linkedin_url: string | null,

  // Primary contact
  poc_name: string | null,
  poc_email: string | null,
  poc_phone: string | null,
  poc_designation: string | null,

  // Additional contacts
  additional_contacts: [
    { name: string, email: string, phone: string, designation: string, role_label: string }
  ],

  // Lead/meeting
  source: string | null,
  meeting_mode: "online" | "offline" | null,
  meeting_date: datetime | null,
  meeting_location: string | null,     // (v2) required when meeting_mode = "offline"
  meeting_notes: string | null,
  meeting_attendees: [{ id: uuid, name: string }],   // (v2) Sales users tagged to the meeting

  // Vendor-specific (null for clients)
  vendor_specializations: string[] | null,
  vendor_rate_range: { min: number, max: number, currency: string } | null,
  vendor_payment_terms: string | null,
  vendor_agreement_url: string | null,

  // Client-specific (null for vendors)
  client_billing_currency: string | null,        // default "INR"
  client_payment_terms: string | null,
  client_agreement_url: string | null,

  // System
  owner: { id: uuid, name: string },
  classified_by: { id: uuid, name: string } | null,   // (v2) who resolved type client/vendor, if via classify
  classified_at: datetime | null,                      // (v2)
  is_locked: boolean,
  created_at: datetime,
  updated_at: datetime
}
```

### GET /accounts
**Roles:** all authenticated (team-wide list; optional `owner_id` / `origin_owner_id` / `specialization` filters)
```
Query params:
  ?type=client|vendor|unclassified   // (v2) "unclassified" = type IS NULL
  &stage=lead|meeting_scheduled|active|rescheduled|dropped
  &owner_id=uuid
  &origin_owner_id=uuid
  &specialization=string      // exact match on vendor_specializations[]
  &industry=string
  &search=string              // name, poc_name, poc_email substring
  &created_from=date&created_to=date
  &sort_by=name|created_at|updated_at&sort_order=asc|desc
  &page=1&limit=20

Response 200:
{
  success: true,
  data: [AccountObject],
  pagination: { page, limit, total, totalPages }
}
```

### GET /accounts/specializations
**Roles:** all authenticated
```
Response 200:
{
  success: true,
  data: ["React", "Java", ...]   // distinct vendor_specializations tags, sorted
}
```

### GET /accounts/:id
```
Response 200:
{
  success: true,
  data: AccountObject
}
```

### POST /accounts
**Roles:** bda, admin
```
Request:
{
  type: "client" | "vendor" (optional — v2: BDA may create a bare lead before deciding client/vendor; omit to leave unclassified, resolve later via POST /accounts/:id/classify),
  name: string (required),

  // Company info (all optional)
  industry: string,
  company_size: "startup" | "small" | "mid" | "enterprise",
  website: string,
  location_city: string,
  location_country: string,
  gst_or_tax_id: string,

  // Lead capture (v2, all optional)
  lead_generated_date: date,
  location: string,
  linkedin_url: string,

  // Primary contact (all optional but recommended)
  poc_name: string,
  poc_email: string,
  poc_phone: string,
  poc_designation: string,

  additional_contacts: [{ name, email, phone, designation, role_label }],

  source: string,

  // Vendor-specific
  vendor_specializations: string[],
  vendor_rate_range: { min: number, max: number, currency: string },
  vendor_payment_terms: string,

  // Client-specific
  client_billing_currency: string,     // defaults to "INR"
  client_payment_terms: string
}

Response 201:
{ success: true, data: AccountObject }
```

### PATCH /accounts/:id
**Roles:** bda, admin (any account — BDA has team-wide account mutate)
**Blocked if:** `is_locked = true` — returns `403 { success: false, message: "Record is locked" }` (superadmin may edit locked rows)
```
Request: same fields as POST (all optional)

Response 200:
{ success: true, data: AccountObject }
```

### POST /accounts/:id/stage
**Roles:** bda, admin (any account)
**Blocked if:** `is_locked = true`
```
Request:
{
  to_stage: "meeting_scheduled" | "active" | "rescheduled" | "dropped" (required),
  reason: string,                   // required if to_stage = "dropped"
  meeting_mode: "online" | "offline",  // required if to_stage = "meeting_scheduled"
  meeting_date: datetime,              // required if to_stage = "meeting_scheduled"
  meeting_location: string,            // (v2) required if to_stage = "meeting_scheduled" AND meeting_mode = "offline"
  meeting_notes: string,               // optional free-text notes for the meeting
  meeting_attendee_ids: uuid[]         // (v2) optional Sales user ids to tag as meeting attendees; replaces the prior set for this account
}

Validation rules:
  - lead → meeting_scheduled (requires meeting_mode + meeting_date; meeting_location also required when meeting_mode = "offline")
  - meeting_scheduled → active | rescheduled | dropped
  - rescheduled → meeting_scheduled (requires new meeting_mode + meeting_date, same offline-location rule)
  - dropped requires reason
  - dropped is terminal — no transitions out
  - Sets is_locked = true on "dropped"

Response 200:
{
  success: true,
  data: AccountObject,
  stage_history: {
    id: uuid,
    from_stage: string,
    to_stage: string,
    changed_by: { id, name },
    reason: string | null,
    changed_at: datetime
  }
}
```

### POST /accounts/:id/classify (v2)
**Roles:** bda, admin (any unclassified account)
**Blocked if:** `type` is already set (non-null) — returns `400 { success: false, message: "Account type is already set" }`
```
Request:
{
  type: "client" | "vendor" (required)
}

Side effects:
  - Sets type, classified_at = now(), classified_by = current user
  - Writes a stage_history row (entity_type: "account", from_stage: null, to_stage: "client"|"vendor", reason: "Lead classified")

Response 200:
{ success: true, data: AccountObject }
```

### GET /accounts/:id/history
```
Response 200:
{
  success: true,
  data: [
    {
      id: uuid,
      from_stage: string,
      to_stage: string,
      changed_by: { id: uuid, name: string },
      reason: string | null,
      changed_at: datetime
    }
  ]
}
```

Note: a classify action (v2) also appears here as a row with `from_stage: null` and `to_stage: "client"` or `"vendor"`.

---

## 4. Requirements

### RequirementObject (full response shape)
```
{
  id: uuid,
  account: { id: uuid, name: string, type: "client" },
  title: string,
  req_type: "managed_services" | "recruitment" | "project",   // (v2) was "project" | "developer" — "developer" renamed to "recruitment", "managed_services" added
  status: "open" | "in_progress" | "on_hold" | "closed" | "dropped",
  description: string | null,
  jd_document_url: string | null,
  designation: string | null,
  department: string | null,
  seats_total: number,
  seats_closed: number,               // computed

  // Technical
  primary_tech_stack: string[],
  secondary_tech_stack: string[],
  domain_experience: string | null,
  experience_min: number | null,
  experience_max: number | null,
  certifications_required: string[],

  // Work arrangement
  work_mode: "remote" | "onsite" | "hybrid" | null,
  work_location: string | null,
  time_zone_preference: string | null,
  engagement_type: "full_time" | "part_time" | "contract" | null,
  contract_duration_months: number | null,
  start_date_target: date | null,
  notice_period_max_days: number | null,

  // Budget
  budget_min: number | null,
  budget_max: number | null,
  budget_currency: string,             // default "INR"
  budget_type: "monthly" | "hourly" | "annual" | "fixed_project" | null,
  billing_notes: string | null,

  // Priority
  priority: "low" | "medium" | "high" | "urgent",
  sla_days: number | null,

  // Assignments
  sales_owner: { id: uuid, name: string },
  assigned_recruiters: [{ id: uuid, name: string, assigned_at: datetime }],

  // System
  is_locked: boolean,
  created_at: datetime,
  closed_at: datetime | null,
  updated_at: datetime
}
```

### GET /requirements
**Roles:** all (BDA: view; sales: own + assigned; recruiter: assigned; admin: all)
```
Query params:
  ?status=open|in_progress|on_hold|closed|dropped
  &req_type=managed_services|recruitment|project
  &account_id=uuid
  &sales_owner_id=uuid
  &recruiter_id=uuid             // filter by assigned recruiter
  &priority=low|medium|high|urgent
  &tech_stack=React,Node.js      // comma-separated, matches primary OR secondary
  &experience_min=number
  &experience_max=number
  &work_mode=remote|onsite|hybrid
  &engagement_type=full_time|part_time|contract
  &budget_min=number&budget_max=number
  &created_from=date&created_to=date
  &search=string                 // title, designation, description substring
  &sort_by=created_at|priority|budget_max|status&sort_order=asc|desc
  &page=1&limit=20

Response 200:
{
  success: true,
  data: [RequirementObject],
  pagination: { page, limit, total, totalPages }
}
```

### GET /requirements/:id
```
Response 200:
{ success: true, data: RequirementObject }
```

### POST /requirements
**Roles:** sales, admin
```
Request:
{
  account_id: uuid (required),          // must be active client
  title: string (required),
  req_type: "managed_services" | "recruitment" | "project" (required),
  seats_total: number (default 1),

  description: string,
  designation: string,
  department: string,

  primary_tech_stack: string[],
  secondary_tech_stack: string[],
  domain_experience: string,
  experience_min: number,
  experience_max: number,
  certifications_required: string[],

  work_mode: "remote" | "onsite" | "hybrid",
  work_location: string,
  time_zone_preference: string,
  engagement_type: "full_time" | "part_time" | "contract",
  contract_duration_months: number,
  start_date_target: date,
  notice_period_max_days: number,

  budget_min: number,
  budget_max: number,
  budget_currency: string,              // default "INR"
  budget_type: "monthly" | "hourly" | "annual" | "fixed_project",
  billing_notes: string,

  priority: "low" | "medium" | "high" | "urgent",   // default "medium"
  sla_days: number
}

Side effects:
  - Auto-creates `seats_total` rows in requirement_seat (seat_status = "open")
  - Sets sales_owner_id = current user (if role=sales)

Response 201:
{ success: true, data: RequirementObject }
```

### PATCH /requirements/:id
**Roles:** sales (own), admin
**Blocked if:** `is_locked = true`
```
Request: same fields as POST (all optional, except account_id cannot change)

Response 200:
{ success: true, data: RequirementObject }
```

### POST /requirements/:id/status
**Roles:** sales (own), admin
**Blocked if:** `is_locked = true`
```
Request:
{
  to_status: "open" | "in_progress" | "on_hold" | "closed" | "dropped" (required),
  reason: string               // required if "dropped"
}

Validation:
  - "closed" only allowed if all seats are closed
  - "dropped" requires reason, sets is_locked = true
  - Writes stage_history row

Response 200:
{ success: true, data: RequirementObject }
```

### POST /requirements/:id/assign
**Roles:** sales (own), admin
```
Request:
{
  user_id: uuid (required),
  role_on_req: "sales" | "recruiter" (required)
}

Validation:
  - Cannot assign same user twice with same role if already active
  - Target user must have matching role (recruiter for "recruiter", sales for "sales")

Response 201:
{
  success: true,
  data: {
    id: uuid,
    user: { id: uuid, name: string, role: string },
    role_on_req: string,
    assigned_at: datetime,
    assigned_by: { id: uuid, name: string }
  }
}
```

### POST /requirements/:id/unassign
**Roles:** sales (own), admin
```
Request:
{
  assignment_id: uuid (required)
}

Side effect: sets unassigned_at = now() on that row (does not delete)

Response 200:
{ success: true, message: "Unassigned successfully" }
```

### GET /requirements/:id/assignments
```
Response 200:
{
  success: true,
  data: [
    {
      id: uuid,
      user: { id: uuid, name: string, role: string },
      role_on_req: "sales" | "recruiter",
      assigned_at: datetime,
      unassigned_at: datetime | null,
      assigned_by: { id: uuid, name: string }
    }
  ]
}
```

### GET /requirements/:id/history
```
Response 200:
{
  success: true,
  data: [StageHistoryObject]
}
```

---

## 5. Requirement seats

### SeatObject
```
{
  id: uuid,
  requirement_id: uuid,
  seat_label: string | null,
  seat_status: "open" | "interviewing" | "offer" | "bgv" | "closed" | "dropped",
  closed_at: datetime | null,
  joined_at: date | null,
  is_locked: boolean,
  submissions_count: number,          // computed
  active_submissions_count: number    // computed (excludes rejected/backout)
}
```

### GET /requirements/:id/seats
```
Response 200:
{
  success: true,
  data: [SeatObject]
}
```

### POST /requirements/:id/seats
**Roles:** sales (own), admin — for adding additional seats after creation
```
Request:
{
  seat_label: string              // optional
}

Side effect: increments requirement.seats_total

Response 201:
{ success: true, data: SeatObject }
```

### POST /seats/:id/stage
**Roles:** recruiter (assigned), sales (own req), admin
**Blocked if:** `is_locked = true`
```
Request:
{
  to_status: "open" | "interviewing" | "offer" | "bgv" | "closed" | "dropped" (required),
  reason: string,                 // required if "dropped"
  joined_at: date                 // required if "closed"
}

Validation:
  - "closed" requires joined_at
  - Sets is_locked = true on "closed" or "dropped"
  - Auto-updates parent requirement.status if all seats now closed
  - Writes stage_history row

Response 200:
{ success: true, data: SeatObject }
```

---

## 6. Profiles (Candidates)

### ProfileObject (full response shape)
```
{
  id: uuid,

  // Personal
  name: string,
  email: string | null,
  phone: string | null,
  date_of_birth: date | null,
  gender: "male" | "female" | "other" | "prefer_not_to_say" | null,
  current_location: string | null,
  willing_to_relocate: boolean,
  preferred_locations: string[],

  // Professional
  current_company: string | null,
  current_designation: string | null,
  total_experience_years: number,
  relevant_experience_years: number | null,

  // Skills
  primary_skills: string[],
  secondary_skills: string[],
  certifications: string[],
  domain_experience: string[],
  education: {
    degree: string,
    institution: string,
    year: number
  } | null,

  // Compensation
  current_ctc: number | null,
  current_ctc_currency: string,          // default "INR"
  expected_ctc: number | null,
  expected_ctc_currency: string,         // default "INR"
  ctc_negotiable: boolean,
  ctc_notes: string | null,

  // Availability
  notice_period_days: number | null,
  is_serving_notice: boolean,
  last_working_day: date | null,
  earliest_join_date: date | null,
  preferred_work_mode: "remote" | "onsite" | "hybrid" | null,

  // Documents & links
  resume_url: string | null,
  linkedin_url: string | null,
  portfolio_url: string | null,
  other_documents: [{ label: string, url: string }],

  // Sourcing
  source: "direct" | "vendor" | "linkedin",   // (v2) was "internal" | "vendor" | "linkedin"
  vendor_account: { id: uuid, name: string } | null,
  vendor_profile_id: string | null,
  added_by: { id: uuid, name: string },
  recruiter_notes: string | null,
  on_bench: boolean,       // (v2) marks a "direct"-sourced candidate as currently available for a new submission

  // System
  is_active: boolean,
  created_at: datetime,
  updated_at: datetime,

  // Computed
  active_submissions_count: number,
  total_submissions_count: number,
  progress: { percent, completed, total, steps } | null   // best (highest %) among non-terminal active submissions; null if none
}
```

### GET /profiles
**Roles:** recruiter, sales, admin
```
Query params:
  ?source=direct|vendor|linkedin
  &on_bench=true|false               // (v2) filters direct-sourced candidates flagged available for a new submission
  &vendor_id=uuid
  &primary_skills=React,Java        // comma-separated, OR match
  &experience_min=number
  &experience_max=number
  &expected_ctc_min=number
  &expected_ctc_max=number
  &notice_period_max=number          // profiles available within N days
  &is_serving_notice=true|false
  &current_location=string
  &willing_to_relocate=true|false
  &preferred_work_mode=remote|onsite|hybrid
  &is_active=true|false
  &added_by=uuid
  &search=string                     // name, email, phone, current_company, skills substring
  &sort_by=created_at|total_experience_years|expected_ctc&sort_order=asc|desc
  &page=1&limit=20

Response 200:
{
  success: true,
  data: [ProfileObject],
  pagination: { page, limit, total, totalPages }
}
```

### GET /profiles/:id
```
Response 200:
{ success: true, data: ProfileObject }
```

### POST /profiles
**Roles:** recruiter, admin
```
Request:
{
  name: string (required),
  email: string,
  phone: string,
  date_of_birth: date,
  gender: "male" | "female" | "other" | "prefer_not_to_say",
  current_location: string,
  willing_to_relocate: boolean,
  preferred_locations: string[],

  current_company: string,
  current_designation: string,
  total_experience_years: number (required),
  relevant_experience_years: number,

  primary_skills: string[] (required, min 1),
  secondary_skills: string[],
  certifications: string[],
  domain_experience: string[],
  education: { degree, institution, year },

  current_ctc: number,
  current_ctc_currency: string,          // default "INR"
  expected_ctc: number,
  expected_ctc_currency: string,         // default "INR"
  ctc_negotiable: boolean,               // default false
  ctc_notes: string,

  notice_period_days: number,
  is_serving_notice: boolean,            // default false
  last_working_day: date,
  earliest_join_date: date,
  preferred_work_mode: "remote" | "onsite" | "hybrid",

  linkedin_url: string,
  portfolio_url: string,

  source: "direct" | "vendor" | "linkedin" (required),
  vendor_account_id: uuid,               // required if source = "vendor"
  vendor_profile_id: string,
  recruiter_notes: string,
  on_bench: boolean                      // (v2) only meaningful when source = "direct"
}

Response 201:
{ success: true, data: ProfileObject }
```

### PATCH /profiles/:id
**Roles:** recruiter (own), admin
```
Request: same fields as POST (all optional)

Response 200:
{ success: true, data: ProfileObject }
```

### GET /profiles/:id/submissions
**Returns all submissions this profile has been pitched to**
```
Response 200:
{
  success: true,
  data: [
    {
      id: uuid,
      stage: string,
      requirement: { id: uuid, title: string, account_name: string },
      seat: { id: uuid, seat_label: string },
      proposed_rate: number,
      created_at: datetime
    }
  ]
}
```

---

## 7. Submissions (Profile ↔ Requirement Seat)

### SubmissionObject (full response shape)
```
{
  id: uuid,
  seat: { id: uuid, seat_label: string, requirement_id: uuid },
  requirement: { id: uuid, title: string, account_name: string },
  profile: {
    id: uuid,
    name: string,
    current_company: string,
    total_experience_years: number,
    primary_skills: string[],
    expected_ctc: number,
    notice_period_days: number,
    source: string
  },
  stage: "sourced" | "internal_screening" | "submitted_to_client" | "interview_scheduled"
       | "interview_result" | "offer_sent" | "bgv" | "closed" | "backout" | "rejected",
       // (v2) "offer" renamed to "offer_sent"

  // Commercials
  proposed_rate: number | null,
  proposed_rate_type: "monthly" | "hourly" | "annual" | null,
  proposed_rate_currency: string,        // default "INR"
  vendor_rate: number | null,
  vendor_rate_type: "monthly" | "hourly" | "annual" | null,
  vendor_rate_currency: string,          // default "INR"
  margin: number | null,                 // computed
  margin_percentage: number | null,      // computed
  final_agreed_rate: number | null,
  final_agreed_rate_type: "monthly" | "hourly" | "annual" | null,

  // Notes
  submission_notes: string | null,
  client_feedback: string | null,
  relevancy_score: number | null,        // 1-10

  // Backout/rejection
  backout_stage: string | null,
  backout_reason: string | null,
  rejection_stage: string | null,
  rejection_reason: string | null,

  // Offer & joining
  offer_date: date | null,
  offer_ctc: number | null,
  offer_ctc_currency: string | null,
  expected_joining_date: date | null,
  actual_joining_date: date | null,

  // BGV
  bgv_initiated_date: date | null,
  bgv_status: "pending" | "in_progress" | "cleared" | "failed" | null,
  bgv_completed_date: date | null,
  bgv_notes: string | null,

  // System
  submitted_by: { id: uuid, name: string },
  is_locked: boolean,
  created_at: datetime,
  updated_at: datetime,

  // Nested
  interview_rounds: [InterviewRoundObject],

  // Computed (v2)
  missing_mandatory_rounds: ("internal_r1" | "hr_cto_ceo")[]   // round types not yet present — soft-rule warning only, never blocks a stage move

  // Computed (closure progress)
  progress: {                         // null when stage is rejected/backout
    percent: number,                  // 0–100
    completed: number,
    total: number,                    // grows with interview-round count (min 2 interview steps)
    steps: [{ key: string, label: string, status: "done" | "current" | "pending", detail?: string }]
  } | null
}
```

### GET /submissions
**Roles:** recruiter (assigned reqs), sales (own reqs), admin
```
Query params:
  ?requirement_id=uuid
  &seat_id=uuid
  &profile_id=uuid
  &stage=sourced|internal_screening|submitted_to_client|interview_scheduled|interview_result|offer_sent|bgv|closed|backout|rejected
  &submitted_by=uuid
  &source=direct|vendor|linkedin       // profile source filter
  &vendor_id=uuid
  &margin_min=number
  &created_from=date&created_to=date
  &search=string                          // profile name, requirement title
  &sort_by=created_at|stage|margin&sort_order=asc|desc
  &page=1&limit=20

Response 200:
{
  success: true,
  data: [SubmissionObject],
  pagination: { page, limit, total, totalPages }
}
```

### GET /submissions/:id
```
Response 200:
{ success: true, data: SubmissionObject }
```

### POST /submissions
**Roles:** recruiter (assigned to this requirement), admin
```
Request:
{
  requirement_seat_id: uuid (required),
  profile_id: uuid (required),

  proposed_rate: number,
  proposed_rate_type: "monthly" | "hourly" | "annual",
  proposed_rate_currency: string,        // default "INR"
  vendor_rate: number,                   // only for vendor-sourced profiles
  vendor_rate_type: "monthly" | "hourly" | "annual",
  vendor_rate_currency: string,          // default "INR"

  submission_notes: string,
  relevancy_score: number                // 1-10
}

Validation:
  - Seat must not be locked
  - Profile must be active (is_active = true)
  - No duplicate active submission for same profile + same seat
  - vendor_rate required if profile.source = "vendor"
  - Auto-computes margin = proposed_rate − vendor_rate (when currencies match)

Response 201:
{ success: true, data: SubmissionObject }
```

### PATCH /submissions/:id
**Roles:** recruiter (own), admin
**Blocked if:** `is_locked = true`
```
Request (all optional):
{
  proposed_rate: number,
  proposed_rate_type: string,
  proposed_rate_currency: string,
  vendor_rate: number,
  vendor_rate_type: string,
  vendor_rate_currency: string,
  final_agreed_rate: number,
  final_agreed_rate_type: string,
  submission_notes: string,
  client_feedback: string,
  relevancy_score: number,
  offer_date: date,
  offer_ctc: number,
  offer_ctc_currency: string,
  expected_joining_date: date,
  actual_joining_date: date,
  bgv_initiated_date: date,
  bgv_status: "pending" | "in_progress" | "cleared" | "failed",
  bgv_completed_date: date,
  bgv_notes: string
}

Response 200:
{ success: true, data: SubmissionObject }
```

### POST /submissions/:id/stage
**Roles:** recruiter (own), admin
**Blocked if:** `is_locked = true`
```
Request:
{
  to_stage: string (required),
  reason: string,                         // required if backout or rejected
  backout_reason: string,                 // required if to_stage = "backout"
  rejection_reason: string                // required if to_stage = "rejected"
}

Stage transition rules:
  sourced → internal_screening
  internal_screening → submitted_to_client | rejected
  submitted_to_client → interview_scheduled | rejected
  interview_scheduled → interview_result | rejected
  interview_result → offer_sent | rejected (requires all rounds to have a result)
  offer_sent → bgv | backout | rejected
  bgv → closed | backout | rejected (requires bgv_status = "cleared")
  ANY → backout (with reason)
  ANY → rejected (with reason)

  (v2) These gates are unchanged and unrelated to the new "missing_mandatory_rounds" soft
  warning below — a submission can still reach offer_sent/closed with all *existing* rounds
  resolved even if a mandatory round type (internal_r1, hr_cto_ceo) was never added at all.

Side effects:
  - "backout": sets backout_stage + backout_reason; seat stays as-is (manual reopen)
  - "rejected": sets rejection_stage + rejection_reason
  - "closed": sets is_locked = true; updates seat_status if this was the winning submission
  - Writes stage_history row

Response 200:
{ success: true, data: SubmissionObject }
```

### GET /submissions/:id/history
```
Response 200:
{
  success: true,
  data: [StageHistoryObject]
}
```

---

## 8. Interview rounds

### InterviewRoundObject
```
{
  id: uuid,
  submission_id: uuid,
  round_number: number,
  round_type: "internal_r1" | "internal_r2" | "client_r1" | "client_r2" | "client_r3" | "hr_cto_ceo",
  // (v2) was "internal" | "client_l1" | "client_l2" | "client_hr" | "client_final" —
  // old "client_hr" and "client_final" both collapsed into the combined "hr_cto_ceo" round.
  // internal_r1 and hr_cto_ceo are the two mandatory round types (soft rule, see SubmissionObject.missing_mandatory_rounds).
  round_name: string | null,
  scheduled_at: datetime | null,
  duration_minutes: number | null,
  interviewer_name: string | null,
  interviewer_email: string | null,
  meeting_link: string | null,
  result: "pending" | "pass" | "fail" | "no_show" | "rescheduled",
  feedback: string | null,
  rating: number | null,              // 1-10
  completed_at: datetime | null
}
```

### POST /submissions/:id/interview-rounds
**Roles:** recruiter (own submission), sales (own requirement — client-facing round types only: client_r1/r2/r3, hr_cto_ceo), admin
```
Request:
{
  round_type: "internal_r1" | "internal_r2" | "client_r1" | "client_r2" | "client_r3" | "hr_cto_ceo" (required),
  round_name: string,
  scheduled_at: datetime (required — interview date & time when the round is open),
  duration_minutes: number,
  interviewer_name: string,
  interviewer_email: string,
  meeting_link: string,
  result: "pending" | "pass" | "fail" | "no_show" | "rescheduled",
  feedback: string,
  rating: number
}

Side effect:
  - Auto-increments round_number based on existing rounds for this submission (global counter, not per round_type)
  - If submission.stage = "submitted_to_client", auto-advances to "interview_scheduled"

Response 201:
  { success: true, data: InterviewRoundObject }

Response 403 (v2):
  A sales user tried to log a non-client round type (internal_r1/internal_r2), or a
  recruiter/sales user who doesn't own the submission/requirement tried to add a round.

Response 422:
  Missing or empty scheduled_at
```

### PATCH /interview-rounds/:id
**Roles:** recruiter (own submission), sales (own requirement — client-facing round types only), admin
**Note (v2):** `round_type` is immutable after creation and not accepted on PATCH.
```
Request (all optional):
{
  scheduled_at: datetime,
  duration_minutes: number,
  interviewer_name: string,
  interviewer_email: string,
  meeting_link: string,
  result: "pending" | "pass" | "fail" | "no_show" | "rescheduled",
  feedback: string,
  rating: number,                    // 1-10
  completed_at: datetime
}

Side effect:
  - If result set to "pass"/"fail"/"no_show", sets completed_at = now() if not provided
  - Does NOT change the submission stage. interview_scheduled → interview_result is a
    manual move via POST /submissions/:id/stage (recording round results never auto-advances).

Response 200:
{ success: true, data: InterviewRoundObject }
```

### GET /submissions/:id/interview-rounds
```
Response 200:
{
  success: true,
  data: [InterviewRoundObject]
}
```

---

## 9. Documents (generic file attachments)

### DocumentObject
```
{
  id: uuid,
  entity_type: "account" | "requirement" | "profile" | "submission",
  entity_id: uuid,
  label: string,
  file_url: string,
  file_type: string,
  file_size_bytes: number,
  uploaded_by: { id: uuid, name: string },
  uploaded_at: datetime
}
```

### POST /documents
**Roles:** all authenticated
**Content-Type:** multipart/form-data
```
Request:
{
  entity_type: string (required),
  entity_id: uuid (required),
  label: string (required),          // "Resume", "JD", "MSA", "Offer Letter", "PAN", etc.
  file: File (required)              // max 10MB
}

Validation:
  - Allowed types: .pdf, .doc, .docx, .jpg, .jpeg, .png, .xlsx, .csv
  - Entity must exist and user must have access to it

Response 201:
{ success: true, data: DocumentObject }
```

### GET /documents
```
Query params:
  ?entity_type=account|requirement|profile|submission
  &entity_id=uuid

Response 200:
{
  success: true,
  data: [DocumentObject]
}
```

### DELETE /documents/:id
**Roles:** uploader or admin
```
Response 200:
{ success: true, message: "Document deleted" }
```

---

## 10. Comments

### CommentObject
```
{
  id: uuid,
  entity_type: "account" | "requirement" | "submission",
  entity_id: uuid,
  user: { id: uuid, name: string, role: string },
  body: string,
  created_at: datetime
}
```

### GET /comments
```
Query params:
  ?entity_type=string (required)
  &entity_id=uuid (required)

Response 200:
{
  success: true,
  data: [CommentObject]
}
```

### POST /comments
**Roles:** all authenticated (must have access to the entity)
```
Request:
{
  entity_type: "account" | "requirement" | "submission" (required),
  entity_id: uuid (required),
  body: string (required, min 1 char)
}

Response 201:
{ success: true, data: CommentObject }
```

---

## 11. Admin — Unlock

### POST /admin/:entity_type/:entity_id/unlock
**Roles:** admin (any entity); **bda** when `entity_type=account` only
```
Request:
{
  reason: string (required)
}

Validation:
  - entity_type must be: account | requirement | seat | submission
  - Entity must exist and is_locked must be true
  - BDA callers are rejected unless entity_type is account
  - Writes stage_history row with to_stage = "unlocked"
  - Sets is_locked = false

Response 200:
{
  success: true,
  message: "Record unlocked",
  data: {
    entity_type: string,
    entity_id: uuid,
    unlocked_by: { id: uuid, name: string },
    reason: string
  }
}
```

---

## 12. Reports

### GET /reports/recruiter-performance
**Roles:** admin, sales (sees recruiters on own requirements)
```
Query params:
  ?date_from=date (required)
  &date_to=date (required)
  &recruiter_id=uuid             // optional filter to specific recruiter

Response 200:
{
  success: true,
  data: [
    {
      recruiter: { id: uuid, name: string },
      profiles_sourced: number,
      profiles_sourced_by_source: {
        direct: number,   // (v2) was "internal"
        vendor: number,
        linkedin: number
      },
      submissions_total: number,
      submissions_in_screening: number,
      submissions_submitted_to_client: number,
      submissions_in_interview: number,
      submissions_in_offer: number,
      submissions_in_bgv: number,
      submissions_closed: number,
      submissions_rejected: number,
      submissions_backout: number,
      backout_rate_percentage: number,
      avg_days_sourced_to_submitted: number | null,
      avg_days_submitted_to_interview: number | null,
      avg_days_interview_to_offer: number | null,
      avg_days_offer_to_closed: number | null,
      avg_days_total_cycle: number | null,
      requirements_worked_on: number,
      closures_count: number,             // actual joinings in period
      rounds_missing_mandatory_count: number   // (v2) submissions missing internal_r1 or hr_cto_ceo
    }
  ]
}
```

### GET /reports/bda-performance
**Roles:** admin

Lead/account funnel grouped by BDA. Accounts are owned by BDA (`owner_id`), not sales.

```
Query params:
  ?date_from=date (required)
  &date_to=date (required)
  &bda_id=uuid
  &department_id=uuid

Response 200:
{
  success: true,
  data: [
    {
      bda: { id: uuid, name: string },
      leads_created: number,
      leads_in_meeting: number,
      leads_converted_active: number,
      leads_dropped: number,
      conversion_rate_percentage: number,
      vendors_created: number,
      leads_unclassified: number,            // (v2) leads created in range with type still null
      leads_via_linkedin: number,             // (v2) leads created in range with linkedin_url set
      avg_days_lead_to_meeting: number | null,   // (v2) lead_generated_date → meeting_date, for leads that reached meeting_scheduled
      clients_active_current: number,         // present-state snapshot, NOT scoped to date_from/date_to
      vendors_active_current: number,         // present-state snapshot
      stuck_leads_current: number             // present-state snapshot (STUCK_THRESHOLD_DAYS, default 7)
    }
  ]
}
```
Note: `*_current` fields are named that way because they're a snapshot "as of now," unlike the rest of this report which is scoped to `date_from`/`date_to`.

### GET /reports/sales-performance
**Roles:** admin

Requirement and joining metrics grouped by sales owner (`sales_owner_id`). Does **not** use account lead ownership (that is BDA).

```
Query params:
  ?date_from=date (required)
  &date_to=date (required)
  &sales_id=uuid
  &department_id=uuid

Response 200:
{
  success: true,
  data: [
    {
      sales_person: { id: uuid, name: string },
      requirements_opened: number,
      requirements_closed: number,
      requirements_dropped: number,
      requirements_in_progress: number,
      avg_closure_days: number | null,
      total_budget_pipeline: number,
      total_closed_revenue: number,
      total_margin_generated: number,
      clients_active: number,
      closures_count: number,
      submissions_missing_hr_cto_ceo_round: number   // (v2) open/closed submissions on owned requirements lacking the combined HR/CTO/CEO round
      // plus interview summary fields when present
    }
  ]
}
```

### GET /reports/vendor-performance
**Roles:** admin, sales
```
Query params:
  ?date_from=date (required)
  &date_to=date (required)
  &vendor_id=uuid

Response 200:
{
  success: true,
  data: [
    {
      vendor: { id: uuid, name: string },
      profiles_submitted: number,
      profiles_shortlisted: number,       // reached submitted_to_client+
      profiles_interviewed: number,
      profiles_offered: number,
      profiles_closed: number,
      profiles_backout: number,
      backout_rate_percentage: number,
      avg_margin_per_profile: number,
      total_margin: number,
      avg_days_to_submit: number | null,  // time from requirement creation to vendor submission
      reliability_score: number | null     // computed: (closed / submitted) * 100
    }
  ]
}
```

### GET /reports/client-performance (v2)
**Roles:** admin, sales

Mirrors `vendor-performance`'s shape, anchored on `Account.type === "client"` instead of `"vendor"`, via requirements owned by that client account.
```
Query params:
  ?date_from=date (required)
  &date_to=date (required)
  &client_id=uuid

Response 200:
{
  success: true,
  data: [
    {
      client: { id: uuid, name: string },
      requirements_total: number,
      requirements_open: number,           // status open or in_progress
      requirements_closed: number,
      submissions_total: number,
      submissions_closed: number,
      avg_days_to_close: number | null,    // submission created_at → actual_joining_date, closed submissions only
      total_revenue: number,               // sum final_agreed_rate on closed submissions
      total_margin: number,
      stuck_requirements_count: number     // open/in_progress requirements not updated in STUCK_THRESHOLD_DAYS (default 7)
    }
  ]
}
```

### GET /reports/aging
**Roles:** admin, sales
```
Query params:
  ?threshold_days=number (default 7)

Response 200:
{
  success: true,
  data: {
    stuck_leads: [
      {
        account: { id, name, stage },
        owner: { id, name },
        days_in_stage: number,
        last_activity: datetime
      }
    ],
    stuck_requirements: [
      {
        requirement: { id, title, status, priority },
        sales_owner: { id, name },
        days_open: number,
        submissions_count: number,
        last_submission_date: datetime | null
      }
    ],
    stuck_submissions: [
      {
        submission: { id, stage },
        profile: { id, name },
        requirement: { id, title },
        recruiter: { id, name },
        days_in_current_stage: number
      }
    ],
    past_sla_requirements: [
      {
        requirement: { id, title, sla_days },
        days_open: number,
        overdue_by_days: number
      }
    ]
  }
}
```

### GET /reports/closure
**Roles:** admin, sales
```
Query params:
  ?date_from=date (required)
  &date_to=date (required)
  &group_by=month|quarter|client|recruiter

Response 200:
{
  success: true,
  data: [
    {
      group_label: string,                 // "Aug 2026", "Q3 2026", "Acme Corp", "Deepanshu"
      closures_count: number,
      total_revenue: number,               // sum of final_agreed_rate
      total_margin: number,
      avg_cycle_days: number,
      details: [
        {
          requirement: { id, title },
          client: { id, name },
          profile: { id, name },
          joined_at: date,
          final_agreed_rate: number,
          margin: number,
          recruiter: { id, name }
        }
      ]
    }
  ]
}
```

### GET /reports/export
**Roles:** admin, sales
```
Query params:
  ?type=xlsx|pdf (required)
  &report=recruiter-performance|bda-performance|sales-performance|vendor-performance|client-performance|aging|closure (required)
  &date_from=date
  &date_to=date
  &... (same filters as the corresponding report endpoint)

Response 200:
  Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (xlsx)
  OR application/pdf (pdf)
  Content-Disposition: attachment; filename="recruiter-performance-2026-08.xlsx"

  Binary file stream
```

---

## 13. Pipeline board (requirement × stage matrix)

### GET /pipeline/board
**Roles:** admin, sales (own requirements), recruiter (assigned requirements only). BDA is not authorized.
```
Query params:
  ?search=string          // matches requirement title or account name (case-insensitive)
  &stuck_only=true|false  // when true, only requirements past the stuck threshold that are still open/in_progress

Response 200:
{
  success: true,
  data: {
    requirements: [{
      id: uuid,
      title: string,
      status: string,
      priority: string,
      account: { id: uuid, name: string } | null,
      sales_owner: { id: uuid, name: string } | null,
      seats_total: number,
      seats_closed: number,
      created_at: datetime,
      is_stuck: boolean
    }],
    submissions: [{
      id: uuid,
      stage: string,
      requirement: { id: uuid },
      profile: { id: uuid, name: string, source: string } | null,
      submitted_by: { id: uuid, name: string } | null,
      progress: { percent, completed, total, steps } | null   // same shape as SubmissionObject.progress
    }]
  }
}
```

UI: `/pipeline?view=matrix` (“Requirement map”) — rows = requirements, columns = submission stages, cards show candidate + closure ProgressRing. Capability: `viewRequirementMatrix`.

---

## 14. Dashboard summary (home screen)

### GET /dashboard/summary
**Roles:** all (scoped to user's access)
```
Response 200:
{
  success: true,
  data: {
    // Counts
    leads_active: number,
    leads_in_meeting: number,
    clients_active: number,
    vendors_active: number,
    requirements_open: number,
    requirements_in_progress: number,
    requirements_closed_this_month: number,
    submissions_active: number,
    interviews_scheduled_this_week: number,
    closures_this_month: number,

    // Aging alerts (top 5 each)
    stuck_leads: [{ id, name, days_in_stage }],
    stuck_requirements: [{ id, title, days_open, submissions_count }],

    // Recent activity (last 10)
    recent_activity: [
      {
        entity_type: string,
        entity_id: uuid,
        entity_label: string,
        action: string,                    // "stage changed to offer", "assigned to Preet"
        user: { id, name },
        timestamp: datetime
      }
    ],

    // Pipeline funnel (for charts)
    pipeline_funnel: {
      sourced: number,
      screening: number,
      submitted: number,
      interviewing: number,
      offered: number,
      bgv: number,
      closed: number
    }
  }
}
```

---

## 15. Architecture & deployment

```
Internet → Nginx (SSL via Certbot)
             ├── /           → React static build (built with Vite)
             └── /api/v1     → Node/Express (PM2 cluster mode)
                                  → PostgreSQL (same VPS)
                                  → local disk for file uploads (/var/uploads)
```

Nightly `pg_dump` cron. Deploy via scripted `git pull` + `npm run build` + `pm2 reload`.

---

## 16. Security

- JWT (1h access + 7d refresh), bcrypt passwords
- Role middleware on every route per §4 matrix
- Zod request validation on all POST/PATCH
- Rate limiting on `/auth/login` (5 attempts/min)
- CORS locked to frontend domain
- HTTPS only (Nginx)
- File upload: 10MB limit, type whitelist, virus-scan optional v2
- SQL injection prevented via parameterized queries (pg or Knex)
- Structured application logging to stdout (no secrets/tokens in log fields) — see [BACKEND-LOGGING.md](../guides/BACKEND-LOGGING.md)

---

## 17. Detailed 8-day build plan

### Day 1 — Foundation (Aug 21)

**Morning: environment + DB**
- [ ] Init monorepo: `/server` (Express) + `/client` (React + Vite)
- [ ] PostgreSQL setup on VPS, create database + role
- [ ] Knex/Drizzle ORM setup + migration runner
- [ ] Write all migration files:
  - `001_users.sql`
  - `002_accounts.sql`
  - `003_requirements.sql`
  - `004_requirement_seats.sql`
  - `005_requirement_assignments.sql`
  - `006_profiles.sql`
  - `007_submissions.sql`
  - `008_interview_rounds.sql`
  - `009_stage_history.sql`
  - `010_documents.sql`
  - `011_comments.sql`
- [ ] Run migrations, verify schema

**Afternoon: auth + scaffolding**
- [ ] Auth module: `/auth/login`, `/auth/refresh`, `/auth/change-password`
- [ ] JWT middleware (access token verification)
- [ ] Role middleware factory: `authorize('admin', 'sales')`
- [ ] Locking middleware: checks `is_locked` before PATCH/PUT, returns 403
- [ ] Error handling middleware (consistent error envelope)
- [ ] Seed script: create admin user + 2-3 test users per role
- [ ] Nginx config: proxy `/api` → Node, serve `/` → React build
- [ ] PM2 ecosystem config

**Deliverable:** VPS running, DB migrated, login working, roles enforced.

---

### Day 2 — Accounts module (Aug 22)

**Backend**
- [ ] `GET /accounts` — with all filters (type, stage, owner, search, date range, sort, pagination)
- [ ] `GET /accounts/:id`
- [ ] `POST /accounts` — full validation, all fields from §3
- [ ] `PATCH /accounts/:id` — lock check; mutate roles admin|bda (team-wide accounts)
- [ ] `POST /accounts/:id/stage` — state machine validation, meeting fields enforcement, locking on drop, stage_history write
- [ ] `GET /accounts/:id/history`

**Frontend**
- [ ] Layout shell: sidebar nav, top bar with user info/logout
- [ ] Accounts list page: data table with column sorting, filters (type, stage, owner), search bar, pagination
- [ ] Account create/edit form (tabbed: company info, contact, vendor/client-specific)
- [ ] Account detail page: info cards, stage badge, stage transition buttons, history timeline
- [ ] Stage transition modal: reason field (required for drop), meeting fields (for meeting_scheduled)

**Deliverable:** full account lifecycle working end-to-end. BDAs can create leads, schedule meetings, convert or drop.

---

### Day 3 — Requirements + seats + assignments (Aug 23)

**Backend**
- [ ] `GET /requirements` — all filters (status, type, account, owner, recruiter, priority, tech_stack, experience, work_mode, budget range, sort, pagination)
- [ ] `GET /requirements/:id`
- [ ] `POST /requirements` — validates active client, auto-creates seats, sets sales_owner
- [ ] `PATCH /requirements/:id` — lock + ownership check
- [ ] `POST /requirements/:id/status` — state machine, auto-lock on close/drop, stage_history
- [ ] `POST /requirements/:id/assign` + `POST /requirements/:id/unassign`
- [ ] `GET /requirements/:id/assignments`
- [ ] `GET /requirements/:id/seats`, `POST /requirements/:id/seats`
- [ ] `POST /seats/:id/stage` — auto-updates parent requirement status when all seats close
- [ ] `GET /requirements/:id/history`

**Frontend**
- [ ] Requirements list page: Jira-style grid with inline status badges, priority color coding, tech stack pills, filter bar
- [ ] Requirement create form (sections: basic info, technical requirements, work arrangement, budget, priority)
- [ ] Requirement detail page: info panels, seats table, assignment panel
- [ ] Assignment modal: select user by role, shows current assignments + history
- [ ] Seat status management: stage transition per seat

**Deliverable:** sales can create requirements, assign recruiters, manage seats. Assignment history visible.

---

### Day 4 — Profiles (candidates) (Aug 24)

**Backend**
- [ ] `GET /profiles` — all filters (source, vendor, skills, experience, CTC, notice period, location, work mode, search, sort, pagination)
- [ ] `GET /profiles/:id`
- [ ] `POST /profiles` — full validation, vendor_account_id check if source=vendor
- [ ] `PATCH /profiles/:id`
- [ ] `GET /profiles/:id/submissions`
- [ ] `POST /documents` (multipart upload handler, file type validation, size limit)
- [ ] `GET /documents?entity_type=&entity_id=`
- [ ] `DELETE /documents/:id`
- [ ] `GET /comments`, `POST /comments`

**Frontend**
- [ ] Profile list page: searchable, filterable grid with skill tags, CTC, experience, source badge
- [ ] Profile create/edit form (sections: personal, professional, skills, compensation/availability, documents/links, sourcing info)
- [ ] Resume upload component (drag-drop + click, shows uploaded file)
- [ ] Profile detail page: all info, documents list, submissions history, comments thread
- [ ] Document upload component (reusable for account/requirement/profile/submission)
- [ ] Comments component (reusable threaded notes panel)

**Deliverable:** recruiters can add full candidate profiles with resumes, CTC, skills. Profiles searchable by tech stack + availability.

---

### Day 5 — Submissions pipeline (Aug 25)

**Backend**
- [ ] `GET /submissions` — all filters
- [ ] `GET /submissions/:id`
- [ ] `POST /submissions` — duplicate check, seat lock check, auto-compute margin
- [ ] `PATCH /submissions/:id` — commercials, feedback, offer/BGV fields
- [ ] `POST /submissions/:id/stage` — full state machine with all transition rules, backout/rejection handling, lock on close/reject, stage_history
- [ ] `GET /submissions/:id/history`
- [ ] `POST /submissions/:id/interview-rounds` — auto-increment round number; auto-advance submitted_to_client → interview_scheduled only (never to interview_result)
- [ ] `PATCH /interview-rounds/:id` — result handling only; never changes submission stage
- [ ] `GET /submissions/:id/interview-rounds`
- [ ] `POST /admin/:entity_type/:entity_id/unlock` — admin unlock with reason + audit log

**Frontend**
- [ ] Submissions list page (can be accessed globally or scoped to a requirement/seat)
- [ ] Submit profile to requirement flow: select profile → enter rates → submit (shows margin calculation live)
- [ ] Submission detail page: stage pipeline visualization (horizontal stepper showing current position), commercials card, interview rounds list, BGV tracking panel, backout/rejection info
- [ ] Stage transition controls: action buttons per allowed transition, reason modals for backout/rejection
- [ ] Margin calculator: live computation as rates are entered

**Deliverable:** full submission pipeline from sourcing to closure. Multiple interview rounds. Backout/rejection with reasons. Margin tracking.

---

### Day 6 — Submissions pipeline (contd.) + interview rounds (Aug 26)

**Backend (remaining)**
- [ ] Edge cases: multiple submissions per seat (parallel candidates), profile pitched to multiple requirements
- [ ] Auto-derive seat_status from submission stages
- [ ] Auto-derive requirement.status from seat statuses
- [ ] Integration testing: full lifecycle test — create account → lead → active → create requirement → assign recruiter → add profile → submit → interview → offer → BGV → close

**Frontend**
- [ ] Interview round management: add round modal (type, schedule, interviewer, link), result update form with feedback + rating
- [ ] Kanban-style board view for submissions on a requirement (columns = pipeline stages, cards = submissions)
- [ ] Profile search + select component for submission creation (searchable dropdown with skills/experience preview)
- [ ] Bulk actions: select multiple submissions for stage update (optional, time permitting)
- [ ] Requirement detail → submissions tab: shows all submissions across all seats with stage, profile summary, margin

**Deliverable:** complete pipeline with interview management. Kanban view for visual tracking.

---

### Day 7 — Reports + dashboard + export (Aug 27)

**Backend**
- [ ] `GET /dashboard/summary` — aggregated counts, pipeline funnel, aging alerts, recent activity
- [ ] `GET /reports/recruiter-performance` — funnel, conversion, time-in-stage, backout rate
- [ ] `GET /reports/sales-performance` — leads, requirements, revenue, margin
- [ ] `GET /reports/vendor-performance` — submissions, margins, reliability
- [ ] `GET /reports/aging` — stuck leads, stuck requirements, stuck submissions, past SLA
- [ ] `GET /reports/closure` — grouped closures with revenue/margin details
- [ ] `GET /reports/export` — Excel generation (exceljs: one sheet per data table, formatted headers, auto-column-width) + PDF generation (pdfkit: header, summary table, page breaks)

**Frontend**
- [ ] Dashboard home page: summary cards (counts), pipeline funnel chart (Recharts bar/funnel), aging alerts list, recent activity feed
- [ ] Recruiter performance page: table + funnel chart + time-in-stage bar chart, recruiter selector
- [ ] Sales performance page: table + conversion chart + pipeline value chart
- [ ] Vendor performance page: table + margin chart + reliability comparison
- [ ] Aging/SLA page: sortable tables with day-count color coding (green < yellow < red)
- [ ] Closure report page: grouped table with totals, filterable by date range / group-by toggle
- [ ] Export buttons on every report page: "Download Excel" / "Download PDF"
- [ ] Date range picker component (reusable across all report pages)

**Deliverable:** rich analytics dashboard with all five report types, in-dashboard charts, Excel/PDF export.

---

### Day 8 — UI polish + QA + deploy (Aug 28)

**Morning: UI polish**
- [ ] Jira-style list view refinements: resizable columns, sticky headers, inline status change (click badge → dropdown), row actions menu
- [ ] Global search: search across accounts, requirements, profiles from the top bar
- [ ] Filter presets: save/load common filter combinations (e.g. "My open requirements", "Urgent + no submissions")
- [ ] Loading skeletons, empty states, error states on all pages
- [ ] Responsive tweaks for laptop screens (1366px+)
- [ ] Breadcrumb navigation on detail pages

**Afternoon: QA + deploy**
- [ ] End-to-end walkthrough: BDA creates lead → meeting → active; sales creates requirement + assigns recruiter; recruiter adds profile → submits → interviews → offer → BGV → closed
- [ ] Test locking: verify 403 on edit of closed/dropped records; verify admin unlock flow
- [ ] Test permissions: verify each role can only access allowed endpoints
- [ ] Test edge cases: backout at each stage, rejection, reassignment, multi-seat requirement, same profile on multiple requirements
- [ ] Test reports: verify numbers match manual count from test data
- [ ] Test export: open generated Excel/PDF files, verify formatting
- [ ] Deploy to VPS:
  - Pull latest code
  - Run migrations
  - Build frontend (`npm run build`)
  - Copy build to Nginx static directory
  - PM2 reload backend
  - SSL cert verify
  - Smoke test on production URL
- [ ] Create production admin account + initial user accounts

**Deliverable:** production deployment, all core flows verified. Ready for team onboarding.

---

### Day 9 (Aug 29) — Buffer + team onboarding

- [ ] Bug fixes from Day 8 QA
- [ ] Seed real user accounts for the team
- [ ] Quick walkthrough/demo for BDA, Sales, Recruiter teams
- [ ] Collect immediate feedback, fix critical issues
- [ ] Document: login credentials, basic user guide (1-page cheat sheet)

---

### Post-launch backlog (prioritized)

| Priority | Item | Sprint |
|---|---|---|
| P1 | Email notifications (assignment, stage change, interview reminder T-1) | **In-app shipped** ([RD-NOTIFICATIONS-AND-CALENDAR](../features/RD-NOTIFICATIONS-AND-CALENDAR.md)); email is a drop-in channel behind the same dispatch chokepoint + `NotificationPreference.email` flag |
| P2 | In-app notification bell + notification center | **Shipped** — `Notification` / `NotificationPreference` models, `/api/v1/notifications`, header bell + `/notifications` + `/notifications/preferences` |
| P3 | SLA auto-escalation alerts | v2 Sprint 2 |
| P4 | JIRA/Sheets historical data migration | v2 Sprint 2 |
| P5 | Advanced filters: saved views, custom columns | v2 Sprint 3 |
| P6 | WhatsApp/Slack notification channels | v3 |
| P7 | Vendor portal (limited login for vendors to submit profiles) | v3 |
| P8 | Calendar integration (Google/Outlook for interview scheduling) | **In-app calendar shipped** (`/calendar`, `/api/v1/interviews`, `node-cron` reminders); external Google/Outlook/MS Teams sync is the remaining v3 piece (reserved `online_meeting_provider` / `external_event_id` columns) |
| P9 | CI/CD pipeline (GitHub Actions → VPS) | v3 |
