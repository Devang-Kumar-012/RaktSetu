-- RaktSetu migration 0002: role-based profiles (donor + volunteer).
-- Requires migration 0001 (profiles, is_current_user_admin, set_updated_at).
-- Idempotent — safe to run more than once.
--
-- Security model:
--   * donor_profiles and volunteer_profiles are PRIVATE per-user tables:
--     users read/write only their own row; admins can read all.
--   * phone is private: never included in any view, never granted beyond
--     the owner's own row. Future contact sharing will be gated by a
--     request-acceptance mechanism (security definer lookup, not RLS skip).
--   * locality is general area info only (no exact addresses).
--   * users can never write donation_count — system/admin-managed.
--   * donor_directory view exposes ONLY minimal matching fields
--     (no name, no phone, no history) for future donor matching.

-- ---------------------------------------------------------------------------
-- donor_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.donor_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  blood_group text not null
    check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  locality text not null
    check (char_length(btrim(locality)) between 2 and 100),
  last_donation_date date check (last_donation_date <= current_date),
  phone text not null
    check (char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15),
  availability text not null default 'temporarily_unavailable'
    check (availability in ('available', 'temporarily_unavailable')),
  donation_count integer not null default 0 check (donation_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.donor_profiles.phone is
  'PRIVATE — never exposed to other users via RLS or views. Future contact reveal only after the donor accepts a legitimate blood request.';
comment on column public.donor_profiles.locality is
  'General locality (area/city). Never an exact home address.';

create index if not exists donor_profiles_matching_idx
  on public.donor_profiles (blood_group, availability);

-- Users manage their own row, but never donation_count.
revoke all on table public.donor_profiles from anon;
revoke insert, update, delete on table public.donor_profiles from authenticated;
grant select on table public.donor_profiles to authenticated;
grant insert (user_id, blood_group, locality, last_donation_date, phone, availability)
  on table public.donor_profiles to authenticated;
grant update (blood_group, locality, last_donation_date, phone, availability)
  on table public.donor_profiles to authenticated;

alter table public.donor_profiles enable row level security;
alter table public.donor_profiles force row level security;

drop policy if exists "Donors can view own donor profile" on public.donor_profiles;
create policy "Donors can view own donor profile"
  on public.donor_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Donors can insert own donor profile" on public.donor_profiles;
create policy "Donors can insert own donor profile"
  on public.donor_profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Donors can update own donor profile" on public.donor_profiles;
create policy "Donors can update own donor profile"
  on public.donor_profiles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Admins can view all donor profiles" on public.donor_profiles;
create policy "Admins can view all donor profiles"
  on public.donor_profiles for select to authenticated
  using (public.is_current_user_admin());

drop trigger if exists donor_profiles_set_updated_at on public.donor_profiles;
create trigger donor_profiles_set_updated_at
  before update on public.donor_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- volunteer_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.volunteer_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  locality text
    check (locality is null or char_length(btrim(locality)) between 2 and 100),
  availability text not null default 'temporarily_unavailable'
    check (availability in ('available', 'temporarily_unavailable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table public.volunteer_profiles from anon;
revoke insert, update, delete on table public.volunteer_profiles from authenticated;
grant select on table public.volunteer_profiles to authenticated;
grant insert (user_id, locality, availability)
  on table public.volunteer_profiles to authenticated;
grant update (locality, availability)
  on table public.volunteer_profiles to authenticated;

alter table public.volunteer_profiles enable row level security;
alter table public.volunteer_profiles force row level security;

drop policy if exists "Volunteers can view own volunteer profile" on public.volunteer_profiles;
create policy "Volunteers can view own volunteer profile"
  on public.volunteer_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Volunteers can insert own volunteer profile" on public.volunteer_profiles;
create policy "Volunteers can insert own volunteer profile"
  on public.volunteer_profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Volunteers can update own volunteer profile" on public.volunteer_profiles;
create policy "Volunteers can update own volunteer profile"
  on public.volunteer_profiles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Admins can view all volunteer profiles" on public.volunteer_profiles;
create policy "Admins can view all volunteer profiles"
  on public.volunteer_profiles for select to authenticated
  using (public.is_current_user_admin());

drop trigger if exists volunteer_profiles_set_updated_at on public.volunteer_profiles;
create trigger volunteer_profiles_set_updated_at
  before update on public.volunteer_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- donor_directory: the ONLY cross-user donor surface, for future matching.
-- Minimal fields by design: no name, no phone, no donation history.
-- Contact reveal will happen exclusively through a future acceptance flow.
-- ---------------------------------------------------------------------------
drop view if exists public.donor_directory;
create view public.donor_directory as
  select user_id, blood_group, locality, availability
  from public.donor_profiles
  where availability = 'available';

revoke all on public.donor_directory from anon;
grant select on public.donor_directory to authenticated;

comment on view public.donor_directory is
  'Minimum donor info for matching. Excludes name, phone, last donation date, donation count. Contact reveal later gated by request acceptance.';

