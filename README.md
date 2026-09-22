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
- The upcoming 3 km → 7 km → 15 km alert-ring system should call this same function
  and filter on `distance_km`. Notifications are a later stage.

## Blood requests

- Created by authenticated, active **requester** accounts only (server action + RLS
  enforced). The patient never needs an account.
- Fields: blood group, component (Whole Blood / Platelets), units (1–10), hospital
  name + locality, urgency (Routine / Urgent / Critical), required-by deadline
  (future, ≤ 30 days), contact name + private phone, optional ≤ 500-char note.
- Lifecycle: `active` → `fulfilled` | `expired` | `cancelled` (terminal states are
  final, enforced by an RLS `with check` guard). New requests start `active`.
- The contact phone is private (own-row RLS only) — future donor matching must reveal
  it only after a donor accepts a request.

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

## Role dashboards

`/dashboard` redirects every user to the dashboard for their role
(`/dashboard/donor`, `/dashboard/requester`, `/dashboard/volunteer`, `/dashboard/admin`).
Authorization is enforced server-side on every role page **and** by Row Level Security —
hiding UI is never the security boundary.

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
- `npm run check` — rule checks, then the production build
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
