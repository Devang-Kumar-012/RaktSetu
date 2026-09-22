-- RaktSetu migration 0004: blood requests.
-- Requires migrations 0001–0003. Idempotent — safe to re-run.
--
-- Security model:
--   * blood_requests rows are tied to the authenticated requester (profiles.id,
--     FK with on delete cascade).
--   * RLS: a requester can INSERT only as themselves, SELECT/UPDATE only their
--     own rows. Admins can read all rows (for the future admin console).
--     Volunteers get NO direct row access — request responses for volunteers
--     will go through a dedicated, tightly-scoped table later.
--   * The requester's contact phone lives ONLY in this table's private rows —
--     it is never exposed publicly and future donor matching must surface it
--     only after a donor accepts a request.

create table if not exists public.blood_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid
    not null
    references public.profiles (id) on delete cascade,
  blood_group text not null,
  blood_component text not null
    default 'whole_blood'
    check (blood_component in ('whole_blood', 'platelets')),
  units integer not null default 1 check (units between 1 and 10),
  hospital_name text not null check (char_length(hospital_name) between 2 and 120),
  hospital_locality text not null check (char_length(hospital_locality) between 2 and 120),
  urgency text not null default 'urgent' check (urgency in ('routine', 'urgent', 'critical')),
  required_by timestamptz not null,
  contact_name text not null check (char_length(contact_name) between 2 and 80),
  contact_phone text not null check (char_length(contact_phone) between 8 and 20),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'active' check (status in ('active', 'fulfilled', 'expired', 'cancelled')),
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blood_requests_requester_idx
  on public.blood_requests (requester_id, created_at desc);
-- Prepared for the future matching system: find ACTIVE requests by group + urgency.
create index if not exists blood_requests_matching_idx
  on public.blood_requests (status, blood_group, urgency, required_by);

comment on table public.blood_requests is
  'Urgent blood requests created by authenticated requesters. Contact details are private (own-row RLS only). Status lifecycle: active → fulfilled | expired | cancelled. Fulfillment/expiry timestamps support the future donor-matching system.';

-- updated_at touch trigger
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists blood_requests_touch on public.blood_requests;
create trigger blood_requests_touch
  before update on public.blood_requests
  for each row execute function public.touch_updated_at();

-- Expiry job will later flip past-deadline active rows to 'expired' (matches
-- application-side display logic). Defined here so the lifecycle is explicit:
create or replace function public.expire_stale_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.blood_requests
     set status = 'expired'
   where status = 'active'
     and required_by < now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_stale_requests() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.blood_requests enable row level security;

-- Idempotent policy creation (drop → create, since DROP POLICY IF EXISTS
-- inside DO blocks needs dynamic SQL).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'blood_requests' and policyname = 'blood_requests_insert_own'
  ) then
    create policy blood_requests_insert_own on public.blood_requests
      for insert to authenticated
      with check (
        requester_id = auth.uid()
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'requester' and p.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'blood_requests' and policyname = 'blood_requests_select_own'
  ) then
    create policy blood_requests_select_own on public.blood_requests
      for select to authenticated
      using (
        requester_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'admin'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'blood_requests' and policyname = 'blood_requests_update_own'
  ) then
    create policy blood_requests_update_own on public.blood_requests
      for update to authenticated
      using (requester_id = auth.uid())
      with check (
        requester_id = auth.uid()
        -- Lifecycle guard: an ACTIVE request may only move forward to
        -- fulfilled/cancelled; terminal states are final.
        and (
          (old.status = 'active' and new.status in ('fulfilled', 'cancelled'))
          or new.status = old.status
        )
      );
  end if;
end
$$;

revoke all on public.blood_requests from anon;
