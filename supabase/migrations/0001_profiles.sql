-- RaktSetu migration 0001: profiles table, Row Level Security, signup trigger.
--
-- Apply this in the Supabase SQL editor (Dashboard → SQL) or with the
-- Supabase CLI. It is idempotent — safe to run more than once.
--
-- Security model:
--   * Every user may read/update ONLY their own profile row.
--   * Users can never insert profiles directly — a trigger on auth.users
--     creates the profile, and INSERT is not granted to client roles.
--   * Users can only update their own `full_name` (column-level grant);
--     role/status/email are not updatable by users.
--   * No role is ever accepted from signup metadata except
--     donor/requester/volunteer — "admin" is never self-assignable.
--   * Admins (read access to all profiles) are identified via a
--     SECURITY DEFINER helper so RLS cannot recurse.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  email text not null,
  role text not null
    check (role in ('donor', 'requester', 'volunteer', 'admin')),
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'RaktSetu user profiles. One row per auth.users entry, created by trigger.';

create index if not exists profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- Privileges: clients may SELECT and update only full_name. No insert,
-- no delete, and anon gets nothing (RLS would block anyway — this is
-- explicit defence in depth).
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon;
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at maintenance trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Admin check helper (SECURITY DEFINER so RLS policies cannot recurse)
-- ---------------------------------------------------------------------------
create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

revoke all on function public.is_current_user_admin() from anon;

-- ---------------------------------------------------------------------------
-- Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Own-row policies: these are the ONLY user-facing policies.
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admins may view every profile (needed for the future admin console).
-- Admin insert/update/delete is intentionally NOT granted: admins manage
-- accounts out-of-band with the service role.
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_current_user_admin());

-- ---------------------------------------------------------------------------
-- Signup trigger: create a profile for every new auth user.
-- The role comes from signup metadata but is sanitized — anything outside
-- donor/requester/volunteer (including 'admin') falls back to 'requester'.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'Member');
  if char_length(v_name) > 80 then
    v_name := left(v_name, 80);
  end if;

  v_role := coalesce(new.raw_user_meta_data ->> 'role', 'requester');
  if v_role not in ('donor', 'requester', 'volunteer') then
    v_role := 'requester';
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (new.id, v_name, new.email, v_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Keep profiles.email in sync when a user changes their auth email.
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_email_updated on auth.users;
create trigger on_auth_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

