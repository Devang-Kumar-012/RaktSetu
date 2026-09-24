# RaktSetu

A live blood-donor network that connects willing blood donors with urgent blood requests.

**Core principle:** the person who actually needs the blood never has to operate the application. Friends, family, volunteers, and hospital staff do the work — the patient just receives help.

## Authentication

Supabase Auth powers email/password accounts with the roles **Donor**, **Requester**, and
**Volunteer** (admins are provisioned internally and can never self-register).

- Registration collects full name, email, password, and role — nothing else.
- Profiles live in the `profiles` table linked to `auth.users`, protected by Row Level
  Security: users can read/update **only their own** row, and only the `full_name` column.
- Signup metadata is sanitized by a database trigger — a crafted request claiming
  `role: "admin"` falls back to `requester`.
- Sessions persist across refreshes (middleware refreshes auth cookies on every request).
- Password reset: `/forgot-password` → email link → `/auth/callback` → `/reset-password`.

### Applying the database migrations

Run these in the Supabase SQL editor (Dashboard → SQL Editor), in order:
1. `supabase/migrations/0001_profiles.sql` — profiles table, RLS, signup trigger
2. `supabase/migrations/0002_role_profiles.sql` — donor & volunteer profiles (private
   phone, availability), admin read policies, and the minimal `donor_directory` matching
   view (no names, no phone numbers)
3. `supabase/migrations/0003_donor_matching.sql` — approximate geo columns, the central
   donation-interval rule, and the eligibility-aware matching view
4. `supabase/migrations/0004_blood_requests.sql` — `blood_requests` table with RLS
   (requesters: own rows only; admins: read), lifecycle constraints, matching index,
   and an `expire_stale_requests()` helper
5. `supabase/migrations/0005_matching_function.sql` — approximate hospital
   coordinates, `haversine_km()`, `blood_groups_compatible()`, and the reusable
   `match_donors_for_request()` function
6. `supabase/migrations/0006_location_access.sql` — column grants so donors can store
   their own approximate coordinates (rounded to ~1 km by the app)
7. `supabase/migrations/0007_matching_experience.sql` — `*` safe view, ring-band coverage info,
   and `matching_donor_stats()` used by the requester matches page
8. `supabase/migrations/0008_alerts.sql` — `donor_alerts` table, RLS (own-row donor reads),
   the UNIQUE (request, donor) guarantee, and safe alert/match stats views. Its header
   promises the ring engine and atomic acceptance that migration 0011 now delivers.
9. `supabase/migrations/0009_volunteer_coordination.sql` — private volunteer phone,
   `request_assistance` (volunteer↔request coordination, separate from request status),
   RLS, and the role-checked `volunteer_active_requests()` / `volunteer_request_detail()`
   functions that expose only safe request fields to volunteers
10. `supabase/migrations/0010_admin_platform.sql` — admin-managed `platform_settings`
    (ring distances, ring window, alert offset, donation interval) wired into the
    coordination functions, `request_reports` (abuse reporting), `donation_history`
    (administration-only donation records), admin account-status RLS, and the
    role-checked `admin_platform_overview()` / `admin_list_alerts()` functions
11. `supabase/migrations/0011_emergency_alert_rings.sql` — the emergency alert-ring engine:
    `expand_alert_rings()` (first configured ring, then the next after every
    `alert_window_minutes()` window — 3 km → 7 km → 15 km by default, distances from
    `platform_settings`; pg_cron every minute plus an opportunistic app tick; idempotent
    via `request_ring_progress` PK and `FOR UPDATE SKIP LOCKED`),
    atomic first-acceptance-wins `mark_alert_responded()`, the in-app `notifications`
    table with SECURITY DEFINER emitters (no external providers),
    `donor_active_alerts()`, `reveal_accepted_donors()`, `requester_ring_status()`,
    and `admin_ring_progress()`

12. `supabase/migrations/0012_donor_experience.sql` — the donor-facing alert
    experience: widens the notification kinds (one-shot expiring nudge,
    already-claimed, specific fulfilled/cancelled/expired outcomes, eligibility
    updates) with guarded/idempotent SECURITY DEFINER emitters, recreates
    `donor_active_alerts()` with an approximate whole-km distance (the caller's
    own rounded point only — coordinates never leave the function), adds
    `donor_donation_history()` (own rows + safe request fields), and syncs
    `last_donation_date`/`donation_count` when an admin records a donation so
    the cooldown actually starts

13. `supabase/migrations/0013_notification_consistency.sql` — the notification
    centre and its event consistency: nine new kinds (one stable kind per
    logical event — request created, volunteer-nearby, assisted-request
    accepted/fulfilled/cancelled/expired, admin report received, acceptance
    confirmed, account status changed), duplicate
    prevention as a database invariant (partial unique index on
    `(user_id, kind, request_id, alert_id)` plus a `BEFORE INSERT` guard that
    silently skips an already-delivered event on every insert path), a
    requester + assisting-volunteer arm for the single active→terminal
    transition, a locality-scoped volunteer alert notice, one operational admin
    notice (a new abuse report), and `prune_read_notifications()` — a bounded,
    read-only, never-unread retention sweep driven by the existing guarded
    pg_cron install, plus an index for the shell's unread badge

14. `supabase/migrations/0014_platform_safety.sql` — anti-abuse, request reporting and
    platform safety. It also **fixes a real defect in 0010**, which revoked UPDATE on
    `request_reports` and never granted it back: the "Admins can review reports" policy
    existed but was unreachable, so every moderation action silently failed. The grant
    is restored column-limited to `(status, reviewed_at)`, so moderation can move a
    report between states and nothing else. Adds the controlled reason set
    (`fake`, `incorrect_information`, `no_longer_needed`, `abuse_misuse`, `other`,
    with the legacy `spam`/`harassment` values kept valid for historical rows) and an
    `under_review` state, giving the queue open / under review / resolved.
    `platform_safety_limits` is a single admin-editable row holding every anti-abuse
    limit — enforced by `BEFORE INSERT`/`BEFORE UPDATE` triggers in the database, so
    it cannot be bypassed by calling PostgREST directly, and it is tunable at
    `/admin/settings` without a code change. The guards only fire for signed-in
    users and fail open if the limits row is missing, so service writes are never
    rate limited and abuse protection can never be the reason a real emergency is
    refused. Reporting never touches `blood_requests`: moderation state lives only in
    `request_reports.status`.

15. `supabase/migrations/0015_campus_blood_drives.sql` — Campus Blood Drive Mode, a
    **separate planned workflow** from emergency blood requests. Adds
    `campus_blood_drives` (title, organiser, schedule, venue, locality,
    instructions, target units, upcoming/ongoing/completed/cancelled, published)
    and `campus_drive_registrations` (unique per donor+drive, with
    registered → checked_in → participated state). A drive never creates,
    edits, closes or alerts on a blood request, and the request lifecycle,
    ring engine and acceptance model are untouched — there is still no
    'accepted' request status. `donation_history` gains a nullable `drive_id`
    + `blood_component` so a drive donation is recorded in the **existing**
    ledger, which means the existing 0012 cooldown trigger starts the donor's
    availability interval automatically: one eligibility system, not two. A
    partial unique index closes the duplicate hole (a `NULL` request_id cannot
    dedupe itself in SQL). Registration transitions are enforced by a database
    trigger, and drives gain four in-app notification kinds plus a `drive_id`
    so each donor gets at most one of each drive event per drive. No SMS,
    e-mail, WhatsApp, Telegram or other external provider is introduced.

All are idempotent — safe to re-run.

## Locations & distance (privacy model)

- **Donors** set an approximate location from their profile: type a locality, press
  "Find my area", pick from up to 3 area suggestions (OpenStreetMap Nominatim lookup,
  India-only for now, no API key needed). Only a rough point rounded to ~1 km is ever
  stored — never a street address. Donors can remove it anytime ("Remove my stored
  location") or just skip it; matching falls back to locality text.
- **Requesters** enter the hospital name + locality. On submit the server geocodes it
  best-effort (or uses the candidate they picked in the optional "Hospital map
  location" section) and stores only the rounded point. No pin → matching still works,
  just without distance sorting.
- **Distance** is computed by `haversineKm()` in `src/lib/geo.ts` (TS mirror of
  `public.haversine_km()` in the database). Invalid/missing coordinates return
  "distance unknown" — never a guess.
- **Nobody sees coordinates**: donor coordinates are own-row RLS only, excluded from
  `donor_directory`, and the matching function returns just `distance_km`. Requesters
  never see a donor's position, and donors never see request coordinates.

## Donor matching (foundation)

- `src/lib/matching.ts` → `findMatchingDonors(requestId, { limit })` is the one
  server-side entry point. It calls the `match_donors_for_request` SQL function, which
  enforces: active request only, caller owns it (or is admin), donors available and
  past the application cooldown, active donor profiles, and blood-group compatibility
  (`src/lib/blood-compat.ts` mirrors the SQL rules — keep the two in sync).
- Matching returns ONLY `user_id`, `blood_group`, `locality`, `distance_km` — sorted
  closest-first. No names, phones, emails, or coordinates ever leave the database.
- Compatibility rules (whole blood: standard ABO/Rh matrix; platelets: ABO-identical,
  Rh− donor may give Rh+) are an application-level filter only — the blood bank's
  screening is authoritative. Have them verified with a professional before launch.
- The emergency ring engine (migration 0011) calls this same function per ring with
  `p_radius_km` and filters on `distance_km`, re-evaluating every rule from scratch each
  ring; in-app notifications ship with it (no external providers).

## Blood requests

- Created by authenticated, active **requester** accounts only (server action + RLS
  enforced). The patient never needs an account.
- Fields: blood group, component (Whole Blood / Platelets), units (1–10), hospital
  name + locality, urgency (Routine / Urgent / Critical), required-by deadline
  (future, ≤ 30 days), contact name + private phone, optional ≤ 500-char note.
- Lifecycle: `active` → `fulfilled` | `expired` | `cancelled` (terminal states are
  final, enforced by an RLS `with check` guard). New requests start `active`.
- The contact phone is private (own-row RLS only). Since migration 0011 it is revealed
  ONLY after a valid acceptance, and only to the two sides of that acceptance
  (`reveal_accepted_donors()` for the requester, `donor_active_alerts()` for the donor),
  each time-boxed by `contact_shared_until`.

## Donor availability & eligibility

- The donation interval lives in ONE place: `src/lib/donation-config.ts`
  (`DONATION_INTERVAL_DAYS`, default 90) and its database mirror
  `donation_interval_days()` in migration 0003. Verify with an authorized blood bank or
  Red Cross professional before changing it.
- Matching status combines the donor's manual availability with the interval:
  **Available**, **Temporarily unavailable** (self-paused), or **Not currently eligible**
  (interval not yet passed). Unavailable and not-currently-eligible donors are excluded
  from `donor_directory` in the database itself.
- This is an application-level availability filter only — final eligibility is always
  determined by the blood bank's medical screening.
- When an admin records a donation (`donation_history`, migration 0010), a SECURITY
  DEFINER trigger (0012) copies the date into `last_donation_date` (unless a later one
  exists) and recounts `donation_count` — the cooldown the profile form promises
  actually starts, and the donor gets one `eligibility_updated` notification whenever
  the recorded date changes.

## Role dashboards

`/dashboard` redirects every user to the dashboard for their role
(`/dashboard/donor`, `/dashboard/requester`, `/dashboard/volunteer`, `/dashboard/admin`).
Authorization is enforced server-side on every role page **and** by Row Level Security —
hiding UI is never the security boundary.

The donor dashboard (`/dashboard/donor`) shows: matching status plus a mobile-first
availability control (driven by the existing `updateDonorProfile` server action), a
read-only ring strip (ring, minutes left to respond, request state), the actionable
alert queue with large "I can help" / "I can't help" buttons (declined and closed
alerts auto-hide), accepted requests with the time-boxed requester contact and next
steps, and donation history with the next eligibility date (availability filter only —
never a medical judgement).

The requester dashboard (`/dashboard/requester`) separates ACTIVE requests from closed ones
(fulfilled, expired, cancelled), shows each request's ring-by-ring progress with the total
number of donors alerted, reveals an accepted donor's time-boxed contact, and links to the
request details page (`/requests/[id]`): full request facts, alert progress per ring, the
live time left before the deadline, the accepted donor, and the race-safe "mark fulfilled" /
"cancel request" actions (a zero-row update means the state moved first, and the request
answers with a plain-language message). `/requests/[id]/matches` remains the read-only
preview of who would match. Both requester pages refresh themselves through the ONE shared
live signal — window focus/visibility plus a best-effort Realtime INSERT on the caller's own
`notifications` rows — and stay fully usable when realtime is unavailable.

`/notifications` is the ONE shared in-app notification centre for every role — there
is no per-role variant. It shows the kind, an exact timestamp, the title, a short
message, and a destination link where one exists; unread rows use the blood-tinted
glass surface **and** an explicit "Unread" marker, so state is never colour-only.
Every row has a 44 px-tall **mark as read** control, and the header offers **mark all
as read** against the exact database unread count (the signed-in shell carries the
same count as a badge — both are asked of the database, never inferred from a
rendered list). Read state is a per-row `read_at` on a per-recipient row: marking a
notification read for one user cannot touch another user's copy.

What generates a notification is deliberately narrow — one stable kind per logical
event, no notice for every minor row change. Donors: alert received, respond-soon
(one-shot), another donor already accepted, and the specific fulfilled/cancelled/
expired outcome (with the accepted donor told specifically), plus eligibility
updates. Requesters: request created, a donor accepted, rings completed, and the
closure of their own request. Volunteers: a nearby emergency in their own locality,
a donor accepting a request they assist, and that request's closure. Admins: the one
operational event that waits on them — a new abuse report. The same logical event
never produces a duplicate: retries, repeated scheduler runs, page refreshes, and
re-transitions are absorbed by a database-level event key (partial unique index plus
a `BEFORE INSERT` guard), not by hiding rows in the UI.

Routing is role-aware and only ever points at an existing page — the requester's
`/requests/[id]`, the donor dashboard (deep-linked to the donor's own alert card
while it is still actionable), `/volunteer/requests/[id]`, or the admin console — so
no notification-specific detail page exists. Deleted requests take their
notifications with them (cascade), and a closed or expired reference degrades to the
role's list page, which keeps working and explains the outcome. Notification text
carries no contact data and no coordinates: it never reveals a phone number or exact
location before the existing acceptance flow permits it.

Notifications are emitted exclusively by SECURITY DEFINER database functions
(0011–0013), revoked from clients — the only thing a user can write is their own
`read_at`. RaktSetu has no email/SMS/chat providers. Read notifications older than
90 days are pruned by a bounded daily job that rebuilds the same guarded pg_cron
schedule the ring engine already uses; unread ones are never deleted.

## Tech stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- Supabase (authentication + PostgreSQL with Row Level Security)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run lint` — lint
- `npm run check:rules` — application-rule checks (geo/distance, blood-group
  compatibility incl. a TS↔SQL mirror comparison, donor availability/cooldown).
  No database or credentials needed.
- `npm run check:rings` — emergency ring-engine checks with a fake clock: ring start,
  10-minute window boundaries, exhaustion, closure/acceptance stops, idempotence, ring
  selection rules, due-at computation, atomic acceptance outcomes, privacy gates,
  SQL↔TS invariants, the migration-0012 donor-experience security regression
  group (emitter privileges, own-row gates, approximate-distance-only output,
  notification idempotence, untouched request lifecycle), and the migration-0013
  notification-centre group (TS↔SQL kind parity, database-level duplicate
  prevention, per-recipient read state with DB-backed unread counts, role-safe
  routing, notification-text privacy, conservative retention, mobile-safe
  rendering), and the migration-0014 platform-safety group (report moderation is
  actually reachable after the 0010 grant defect, reporting never alters the
  request lifecycle, duplicate reports blocked by a database constraint, and the
  anti-abuse limits centralised in one configurable row) and the migration-0015
  campus-drive group (drives never touch the request lifecycle, drive donations
  reuse the existing ledger and its cooldown, duplicate registrations and
  donations are database-blocked, and no public drive surface reads donor
  contact or location). No database or credentials needed.
- `npm run check` — rule checks, ring-engine checks, then the production build
- `npm run smoke` — start a local server and hit every route (writes results to
  `/tmp/rs-routes.txt`)

## Project structure

```
src/
  app/            # App Router routes
  components/     # Reusable UI (buttons, cards, forms, states, layout)
  lib/            # Supabase clients, validation, utilities
  types/          # Shared TypeScript types
```

## Security notes

- Only Supabase **anon** keys are used in the frontend; the service-role key never appears in this codebase.
- Environment variables are validated at startup via `src/lib/env.ts`.
- All Supabase tables will be protected by Row Level Security policies.
- RaktSetu never makes medical eligibility decisions — final donor screening always rests with authorized blood bank / medical professionals.
