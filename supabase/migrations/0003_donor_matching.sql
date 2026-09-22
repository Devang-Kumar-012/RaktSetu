-- RaktSetu migration 0003: donor matching preparation.
-- Requires migrations 0001 and 0002. Idempotent — safe to re-run.
--
-- Security model (unchanged from 0002, strengthened here):
--   * donor_profiles stays private (own-row RLS + admin read).
--   * latitude/longitude are APPROXIMATE geo coordinates for future distance
--     matching — derived from the donor's locality, never an exact home
--     address. Only the service role / future matching job writes them;
--     users cannot set them, and they are never exposed through the
--     matching view.
--   * donor_directory now excludes paused AND not-currently-eligible donors,
--     so unavailable donors can never appear in emergency matching results.
--   * The view still exposes ONLY: user_id, blood_group, locality,
--     availability. No name, no phone, no dates, no coordinates.

-- ---------------------------------------------------------------------------
-- Geographic matching fields (application-level, approximate locations only)
-- ---------------------------------------------------------------------------
alter table public.donor_profiles
  add column if not exists latitude numeric(9, 6),
  add column if not exists longitude numeric(9, 6);

comment on column public.donor_profiles.latitude is
  'Approximate coordinate derived from locality for distance matching. Never an exact residential address. Not user-editable; not exposed via donor_directory.';
comment on column public.donor_profiles.longitude is
  'Approximate coordinate derived from locality for distance matching. Never an exact residential address. Not user-editable; not exposed via donor_directory.';

-- Users do not get grants on the coordinate columns: they are set later by
-- the matching system (service role) from the donor''s general locality.

-- ---------------------------------------------------------------------------
-- Central eligibility rule (single source of truth in the database).
-- Application mirror: src/lib/donation-config.ts → DONATION_INTERVAL_DAYS.
-- ⚠️ Availability filter only — never a medical eligibility decision.
-- ---------------------------------------------------------------------------
create or replace function public.donation_interval_days()
returns integer
language sql
stable
as $$
  select 90;
$$;

create or replace function public.donor_is_currently_eligible(
  p_last_donation_date date
)
returns boolean
language sql
stable
as $$
  select p_last_donation_date is null
      or p_last_donation_date <= current_date - public.donation_interval_days();
$$;

revoke all on function public.donation_interval_days() from anon;
revoke all on function public.donor_is_currently_eligible(date) from anon;

-- ---------------------------------------------------------------------------
-- donor_directory: matching surface. Unavailable + not-yet-eligible donors
-- are excluded here so the future matching system cannot even see them.
-- ---------------------------------------------------------------------------
drop view if exists public.donor_directory;
create view public.donor_directory as
  select
    user_id,
    blood_group,
    locality,
    availability
  from public.donor_profiles
  where availability = 'available'
    and public.donor_is_currently_eligible(last_donation_date);

revoke all on public.donor_directory from anon;
grant select on public.donor_directory to authenticated;

comment on view public.donor_directory is
  'Emergency matching surface. Exposes ONLY minimal fields for donors who are both available and past the donation interval (application-level filter, not medical eligibility). No names, phones, dates, or coordinates.';
