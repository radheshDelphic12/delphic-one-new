# V2 — Lead Capture, Candidate Pipeline, Requirement Types, Reports

| Field | Value |
|---|---|
| **Status** | Implemented (backend + frontend); docs pass complete |
| **As of** | 2026-08-27 |
| **Related** | [HLD](HLD.md) · [API Spec](API-Spec-and-Build-Plan.md) · [AGENTS](../AGENTS.md) |

## Why

Three gaps surfaced between how the product modeled the world and how the team actually works:

1. **Leads.** BDAs create a lead before knowing whether it'll become a client, a vendor, or both — but `Account.type` was required and locked at creation. Offline meetings didn't capture a location, and there was no way to record which Sales person(s) joined a meeting. LinkedIn, lead-generated date, and a lightweight location field weren't tracked at all.
2. **Candidate pipeline.** The real interview flow (Sourced → Internal R1 → Internal R2 → Client R1-3 → combined HR/CTO/CEO round → Offer Sent → BGV) is more specific than the old generic `RoundType` (`internal`, `client_l1/l2/hr/final`). Nothing distinguished who could log client-side feedback, and nothing flagged a missing mandatory round.
3. **Requirements & reports.** Requirements needed a `managed_services / recruitment / project` type instead of `project / developer`. Reporting was already fairly rich (recruiter/sales/BDA/vendor performance + aging + closure) but lacked a `client-performance` report to mirror `vendor-performance`.

A candidate on-bench flag was added mid-implementation, per explicit request: internal/direct-sourced candidates need to be easy to find and filter when putting someone forward for a new submission.

## Decisions

- **Meeting attendees:** multiple Sales users can be tagged per meeting, via a join table (`AccountMeetingAttendee`) rather than a scalar array — gives a clean `user.name` join for future reporting and a `@@unique([account_id, user_id])` guard against dupes. Attendees are replaced wholesale on each `meeting_scheduled` move (not accumulated across moves).
- **`Account.type` is nullable.** A lead with no type yet is valid. No `'both'` enum value was added — a company that's genuinely both client and vendor becomes two linked `Account` rows later; that's out of scope here.
- **POC stays as primary `poc_*` fields + `additional_contacts` JSON array** for secondary contacts — not collapsed into one list, since `poc_*` is what today's search/list columns already key off.
- **Offline meetings require `meeting_location`** — same `meeting_fields_required`-style validation pattern as the existing `meeting_mode`/`meeting_date` check.
- **`ProfileSource`: `internal` → `direct`; `linkedin` stays a separate 3rd value** (not merged into `direct`), for reporting granularity. This is a deliberate deviation from a literal "2 sources" reading — kept because it was chosen explicitly during review.
- **`RoundType` expanded** to `internal_r1, internal_r2, client_r1, client_r2, client_r3, hr_cto_ceo`. Old `client_hr` and `client_final` both collapse into the single combined `hr_cto_ceo` round (any submission that historically had both ends up with two `hr_cto_ceo`-typed rows, differentiated by `round_number` — no data loss).
- **`SubmissionStage` stays a small set of milestone stages** (sourced, internal_screening, submitted_to_client, interview_scheduled, interview_result, offer_sent, bgv, closed, backout, rejected). Named rounds live only as `InterviewRound.round_type` records underneath — not as their own stage values. This mirrors the pre-existing pattern (`interview_scheduled`/`interview_result` already sit above `InterviewRound` rows) and keeps round composition changeable (add/shorten rounds later) without touching the stage machine.
- **Mandatory rounds are a soft rule.** `internal_r1`, `hr_cto_ceo` (rounds) and `sourced`, `internal_screening`, `offer_sent` (stages) are "expected" — the UI warns when missing (`missing_mandatory_rounds` on the serialized submission) but never blocks. The *existing* hard gates (can't reach `offer_sent` with unresolved rounds, can't reach `closed` without cleared BGV) are unchanged and are a different concern — data integrity on *pending* rounds, not "was every named round run."
- **Client-round feedback** (`client_r1/r2/r3`, `hr_cto_ceo`) may be logged by either **Sales** (the requirement's `sales_owner_id`) or the **Recruiter** (the submission's `submitted_by`) — not recruiter-only as before. Internal rounds (`internal_r1/r2`) stay recruiter/admin-only.
- **`ReqType`: `project|developer` → `managed_services|recruitment|project`** (`developer`→`recruitment`, `project` unchanged, `managed_services` new/additive).
- **`RequirementStatus` unchanged at the schema level.** `in_progress` stays a real state; only the `on_hold` UI label reads "Hold" — no migration needed.
- **Lead classification is a dedicated endpoint** (`POST /accounts/:id/classify`), one-way (can't reclassify through it once `type` is set), and is written to `StageHistory` (`from_stage: null, to_stage: "client"|"vendor"`) alongside the new `classified_at`/`classified_by` scalar columns on `Account` — belt and suspenders, both cheap to keep.
- **New `client-performance` report**, mirroring `vendor-performance`'s shape, anchored on `Account.type === 'client'`.
- **`Profile.on_bench`** flags a candidate (conventionally `direct`-sourced, though not schema-restricted) as currently available for a new submission — surfaced as a list filter and a quick filter in the submission candidate-picker.

## Schema changes

See [schema.prisma](../../server/prisma/schema.prisma) for the authoritative definitions. Summary:

- `Account`: `type` → nullable; added `lead_generated_date`, `location`, `linkedin_url`, `meeting_location`, `classified_at`, `classified_by`; new relation to `AccountMeetingAttendee`.
- `AccountMeetingAttendee` (new model): `account_id`, `user_id`, unique per pair.
- `Profile`: added `on_bench` (default `false`); `ProfileSource` enum: `internal`→`direct`.
- `Submission`: `SubmissionStage` enum: `offer`→`offer_sent`.
- `InterviewRound`: `RoundType` enum replaced (`internal|client_l1|client_l2|client_hr|client_final` → `internal_r1|internal_r2|client_r1|client_r2|client_r3|hr_cto_ceo`).
- `Requirement`: `ReqType` enum replaced (`project|developer` → `managed_services|recruitment|project`).

Migration: `server/prisma/migrations/20260827115000_v2_add_enum_values/` (adds new enum values, its own transaction) followed by `20260827120000_v2_lead_pipeline_requirements/` (remaps existing rows to the new values, then swaps each enum type, then the additive column/table changes) — split into two migrations because Postgres forbids using a new enum value in the same transaction that added it.

## API surface

Full request/response shapes are in [API-Spec-and-Build-Plan.md](API-Spec-and-Build-Plan.md) (sections 3, 4, 6, 7, 8, 12 — each v2 change is marked inline). New endpoints:

- `POST /accounts/:id/classify` — set `type` on a previously-unclassified lead.
- `GET /reports/client-performance` — client-side mirror of `vendor-performance`.

## Verification

- `cd server && npm test` — 117/117 passing, including new coverage for classify flow, offline-meeting location gating, meeting attendees, interview-round role scoping (`canManageInterviewRound`), and the candidate bench flag.
- `npm run lint` — 0 errors.
- `npm run build --workspace client` — production build succeeds.
- `node prisma/seed.js` — runs clean against the migrated schema; includes unclassified leads, meeting attendees, bench-flagged candidates, and demo data for every new `RoundType`/`ReqType` value.
