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

`/notifications` is the shared in-app notification centre for every role — alert
received/expiring, another donor already accepted, request fulfilled/cancelled/expired
(with the accepted donor told specifically), acceptances, closures, ring completion,
and donation-interval updates — emitted exclusively by SECURITY DEFINER database
functions (0011 + 0012): idempotent and emitters-only. RaktSetu has no email/SMS/chat
providers.

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
  SQL↔TS invariants, and the migration-0012 donor-experience security regression
  group (emitter privileges, own-row gates, approximate-distance-only output,
  notification idempotence, untouched request lifecycle). No database or credentials
  needed.
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
