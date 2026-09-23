-- RaktSetu migration 0009: volunteer coordination.
-- Requires migrations 0001–0008. Idempotent — safe to re-run.
--
-- What this provides:
--   * A private phone column on volunteer_profiles (own-row RLS only, same
--     privacy model as donor phone — never exposed to other users).
--   * request_assistance — a volunteer's "I am helping coordinate this
--     request" record, kept SEPARATE from blood_requests.status. The request
--     lifecycle (active → fulfilled | expired | cancelled) is untouched; a
--     UNIQUE (request_id, volunteer_id) constraint makes duplicate assistance
--     impossible and concurrent start/stop actions safe.
--   * volunteer_active_requests() / volunteer_request_detail() — SECURITY
--     DEFINER read functions for volunteers. They expose ONLY safe request
--     fields: blood group, component, units, hospital + locality, urgency,
--     required-by, status, note, whether a donor has accepted (from
--     donor_alerts), how many volunteers assist, and whether the CALLER
--     assists. They NEVER return requester contact details or any donor
--     private data (no names, phones, emails, addresses, coordinates).
--   * RLS on request_assistance: volunteers touch only their own rows;
--     admins can read all. Authorization is also re-checked server-side in
--     the server actions — RLS is the boundary, not the UI.

-- ---------------------------------------------------------------------------
-- Volunteer profile: private phone (optional)
-- ---------------------------------------------------------------------------
alter table public.volunteer_profiles
  add column if not exists phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'volunteer_profiles_phone_check'
      and conrelid = 'public.volunteer_profiles'::regclass
  ) then
    alter table public.volunteer_profiles
      add constraint volunteer_profiles_phone_check
      check (phone is null or char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 8 and 15);
  end if;
end;
$$;

comment on column public.volunteer_profiles.phone is
  'PRIVATE — own-row RLS only. Never exposed to other users or any view.';

grant insert (phone) on table public.volunteer_profiles to authenticated;
grant update (phone) on table public.volunteer_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- request_assistance: volunteer ↔ active request coordination records
-- ---------------------------------------------------------------------------
create table if not exists public.request_assistance (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.blood_requests (id) on delete cascade,
  volunteer_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'assisting'
                 check (status in ('assisting', 'stopped')),
  note         text check (note is null or char_length(note) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One record per volunteer/request: duplicates impossible, upsert-safe.
  constraint request_assistance_unique unique (request_id, volunteer_id)
);

create index if not exists request_assistance_request_idx
  on public.request_assistance (request_id, status);
create index if not exists request_assistance_volunteer_idx
  on public.request_assistance (volunteer_id, status);

revoke all on table public.request_assistance from anon;
revoke insert, update, delete on table public.request_assistance from authenticated;
grant select on table public.request_assistance to authenticated;
grant insert (request_id, volunteer_id, status, note)
  on table public.request_assistance to authenticated;
grant update (status, note) on table public.request_assistance to authenticated;

alter table public.request_assistance enable row level security;
alter table public.request_assistance force row level security;

drop policy if exists "Volunteers can view own assistance" on public.request_assistance;
create policy "Volunteers can view own assistance"
  on public.request_assistance for select to authenticated
  using (auth.uid() = volunteer_id);

drop policy if exists "Volunteers can insert own assistance" on public.request_assistance;
create policy "Volunteers can insert own assistance"
  on public.request_assistance for insert to authenticated
  with check (
    volunteer_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
    )

drop policy if exists "Volunteers can update own assistance" on public.request_assistance;
create policy "Volunteers can update own assistance"
  on public.request_assistance for update to authenticated
  using (volunteer_id = auth.uid())
  with check (volunteer_id = auth.uid());

drop policy if exists "Admins can view all assistance" on public.request_assistance;
create policy "Admins can view all assistance"
  on public.request_assistance for select to authenticated
  using (public.is_current_user_admin());

drop trigger if exists request_assistance_set_updated_at on public.request_assistance;
create trigger request_assistance_set_updated_at
  before update on public.request_assistance
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Safe volunteer reads of ACTIVE requests (no contact details, no donor data)
-- ---------------------------------------------------------------------------
create or replace function public.volunteer_active_requests(p_limit integer default 50)
returns table (
  id uuid,
  blood_group text,
  blood_component text,
  units integer,
  hospital_name text,
  hospital_locality text,
  urgency text,
  required_by timestamptz,
  status text,
  note text,
  created_at timestamptz,
  donor_accepted boolean,
  volunteers_assisting integer,
  me_assisting boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only active volunteers (or admins) may call this.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('volunteer', 'admin')
      and p.status = 'active'
  ) then
    return;
  end if;

  return query
  select
    r.id,
    r.blood_group,
    r.blood_component,
    r.units,
    r.hospital_name,
    r.hospital_locality,
    r.urgency,
    r.required_by,
    r.status,
    r.note,
    r.created_at,
    exists (
      select 1 from public.donor_alerts a
      where a.request_id = r.id and a.response = 'accepted'
    ),
    (select count(*)::int from public.request_assistance ra
      where ra.request_id = r.id and ra.status = 'assisting'),
    exists (
      select 1 from public.request_assistance ra
      where ra.request_id = r.id
        and ra.volunteer_id = auth.uid()
        and ra.status = 'assisting'
    )
  from public.blood_requests r
  where r.status = 'active'
  order by r.urgency desc, r.required_by asc, r.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function public.volunteer_active_requests(integer) from anon;
grant execute on function public.volunteer_active_requests(integer) to authenticated;

comment on function public.volunteer_active_requests is
  'ACTIVE blood requests for on-duty volunteers: safe fields only. Never requester contact details, never donor private data. donor_accepted comes from donor_alerts; volunteers_assisting counts active request_assistance rows.';


create or replace function public.volunteer_request_detail(p_request_id uuid)
returns table (
  id uuid,
  blood_group text,
  blood_component text,
  units integer,
  hospital_name text,
  hospital_locality text,
  urgency text,
  required_by timestamptz,
  status text,
  note text,
  created_at timestamptz,
  donor_accepted boolean,
  volunteers_assisting integer,
  me_assisting boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('volunteer', 'admin')
      and p.status = 'active'
  ) then
    return;
  end if;

  return query
  select
    r.id,
    r.blood_group,
    r.blood_component,
    r.units,
    r.hospital_name,
    r.hospital_locality,
    r.urgency,
    r.required_by,
    r.status,
    r.note,
    r.created_at,
    exists (
      select 1 from public.donor_alerts a
      where a.request_id = r.id and a.response = 'accepted'
    ),
    (select count(*)::int from public.request_assistance ra
      where ra.request_id = r.id and ra.status = 'assisting'),
    exists (
      select 1 from public.request_assistance ra
      where ra.request_id = r.id
        and ra.volunteer_id = auth.uid()
        and ra.status = 'assisting'
    )
  from public.blood_requests r
  where r.id = p_request_id;
end;
$$;

revoke all on function public.volunteer_request_detail(uuid) from anon;
grant execute on function public.volunteer_request_detail(uuid) to authenticated;

comment on function public.volunteer_request_detail is
  'One request for a volunteer: same safe field set as volunteer_active_requests(). Row exists only when the caller is an active volunteer or admin — requester contact details and donor private data are never included.';

  );
