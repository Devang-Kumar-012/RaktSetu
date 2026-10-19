-- RaktSetu migration 0019: volunteer verification for emergency coordination.
-- Requires migrations 0001–0018. Idempotent — safe to re-run.
--
-- What this provides:
--   * volunteer_verifications — a time-boxed verification task created when a
--     donor accepts an emergency request. One pending task per request at a
--     time (UNIQUE request_id WHERE status = 'pending'), so no two volunteers
--     can verify the same request concurrently.
--   * status vocabulary: pending | verified | rejected | timeout | escalated.
--   * target_deadline — a configurable, short verification window (the app
--     reads platform_settings or a fixed default; the DB stores the deadline
--     as an absolute timestamp).
--   * escalated_to — when a volunteer escalates, the task is reassigned and the
--     original volunteer cannot reclaim it (RLS + policy).
--   * verified_by / completed_at — every outcome is recorded with the
--     authorized actor ID and timestamp for audit.
--   * requester contact release is NOT part of this table: contact reveal
--     stays exclusively on donor_alerts.contact_shared_until, gated by a
--     valid acceptance.
--
-- Privacy:
--   * Volunteers can only see/update their own verification tasks.
--   * Admins can read all tasks.
--   * Requesters can read verification tasks on their OWN requests (status
--     only — which volunteer is verifying, outcome, timestamps — never donor
--     contact or medical details).
--   * No requester contact details are stored here; no donor medical data.
-- ---------------------------------------------------------------------------

create table if not exists public.volunteer_verifications (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.blood_requests (id) on delete cascade,
  volunteer_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'verified', 'rejected', 'timeout', 'escalated')),
  target_deadline timestamptz not null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  verified_by   uuid references public.profiles (id),
  escalated_to  uuid references public.profiles (id),
  outcome_notes text check (outcome_notes is null or char_length(outcome_notes) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One active verification per request: duplicates impossible at the DB level.
  constraint volunteer_verifications_one_pending
    unique (request_id) where status = 'pending'
);

create index if not exists volunteer_verifications_volunteer_idx
  on public.volunteer_verifications (volunteer_id, status);
create index if not exists volunteer_verifications_request_idx
  on public.volunteer_verifications (request_id, status);

revoke all on table public.volunteer_verifications from anon;
revoke insert, update, delete on table public.volunteer_verifications from authenticated;
grant select on table public.volunteer_verifications to authenticated;
grant insert (request_id, volunteer_id, target_deadline)
  on table public.volunteer_verifications to authenticated;
grant update (status, completed_at, verified_by, escalated_to, outcome_notes)
  on table public.volunteer_verifications to authenticated;

alter table public.volunteer_verifications enable row level security;
alter table public.volunteer_verifications force row level security;

-- Volunteers own their verification tasks: read + update only their own rows.
drop policy if exists "Volunteers can view own verifications" on public.volunteer_verifications;
create policy "Volunteers can view own verifications"
  on public.volunteer_verifications for select to authenticated
  using (auth.uid() = volunteer_id);

drop policy if exists "Volunteers can insert own verification" on public.volunteer_verifications;
create policy "Volunteers can insert own verification"
  on public.volunteer_verifications for insert to authenticated
  with check (
    auth.uid() = volunteer_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
    )
  );

drop policy if exists "Volunteers can update own verification" on public.volunteer_verifications;
create policy "Volunteers can update own verification"
  on public.volunteer_verifications for update to authenticated
  using (auth.uid() = volunteer_id)
  with check (auth.uid() = volunteer_id);

-- Admins can read all verification tasks.
drop policy if exists "Admins can view all verifications" on public.volunteer_verifications;
create policy "Admins can view all verifications"
  on public.volunteer_verifications for select to authenticated
  using (public.is_current_user_admin());

-- Requesters can read verification tasks on their own requests (status only).
drop policy if exists "Requesters can view verifications on own requests" on public.volunteer_verifications;
create policy "Requesters can view verifications on own requests"
  on public.volunteer_verifications for select to authenticated
  using (
    auth.uid() in (
      select r.requester_id from public.blood_requests r where r.id = volunteer_verifications.request_id
    )
  );

-- updated_at trigger
drop trigger if exists volunteer_verifications_set_updated_at on public.volunteer_verifications;
create trigger volunteer_verifications_set_updated_at
  before update on public.volunteer_verifications
  for each row execute function public.set_updated_at();

-- Server-side function: start a verification task for an active request.
-- Only an active volunteer may call this; the request must be active; no other
-- pending verification may exist for this request.
create or replace function public.start_volunteer_verification(
  p_request_id uuid,
  p_target_minutes integer default 15
)
returns table (
  id uuid,
  status text,
  target_deadline timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard: caller must be an active volunteer.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
  ) then
    return;
  end if;

  -- Guard: request must be active.
  if not exists (
    select 1 from public.blood_requests r
    where r.id = p_request_id and r.status = 'active'
  ) then
    return;
  end if;

  -- Guard: no pending verification already exists for this request.
  if exists (
    select 1 from public.volunteer_verifications vv
    where vv.request_id = p_request_id and vv.status = 'pending'
  ) then
    return;
  end if;

  insert into public.volunteer_verifications
    (request_id, volunteer_id, target_deadline)
  values
    (p_request_id, auth.uid(), now() + make_interval(mins => p_target_minutes))
  returning id, status, target_deadline;
end;
$$;

revoke all on function public.start_volunteer_verification(uuid, integer) from public, anon;
grant execute on function public.start_volunteer_verification(uuid, integer) to authenticated;

comment on function public.start_volunteer_verification(uuid, integer) is
  'Starts a time-boxed volunteer verification for an active request. First-valid-volunteer-wins via the pending unique constraint. Caller must be an active volunteer; request must be active; no pending verification may already exist. Returns the verification row.';

-- Server-side function: complete a verification task (approve/reject).
-- Only the assigned volunteer may complete their own pending task.
create or replace function public.complete_volunteer_verification(
  p_verification_id uuid,
  p_outcome text,               -- 'verified' | 'rejected'
  p_notes text default null
)
returns table (
  id uuid,
  status text,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard: caller must be an active volunteer.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
  ) then
    return;
  end if;

  -- The outcome must be a terminal verification state.
  if p_outcome not in ('verified', 'rejected') then
    return;
  end if;

  update public.volunteer_verifications vv
     set status = p_outcome,
         completed_at = now(),
         verified_by = auth.uid(),
         outcome_notes = p_notes,
         updated_at = now()
   where vv.id = p_verification_id
     and vv.volunteer_id = auth.uid()
     and vv.status = 'pending'
  returning vv.id, vv.status, vv.completed_at;
end;
$$;

revoke all on function public.complete_volunteer_verification(uuid, text, text) from public, anon;
grant execute on function public.complete_volunteer_verification(uuid, text, text) to authenticated;

comment on function public.complete_volunteer_verification(uuid, text, text) is
  'Completes a pending volunteer verification: approved or rejected, with the completing volunteer recorded and a timestamp. Only the assigned volunteer may complete their own pending task.';

-- Server-side function: escalate a verification to another volunteer.
-- Only the assigned volunteer may escalate their own pending task. The new
-- volunteer must be active and must not already have a pending verification
-- for this request.
create or replace function public.escalate_volunteer_verification(
  p_verification_id uuid,
  p_escalate_to uuid
)
returns table (
  id uuid,
  status text,
  escalated_to uuid,
  target_deadline timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard: caller must be an active volunteer.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
  ) then
    return;
  end if;

  -- Guard: the target volunteer must exist, be active, and have the volunteer role.
  if not exists (
    select 1 from public.profiles p
    where p.id = p_escalate_to and p.role = 'volunteer' and p.status = 'active'
  ) then
    return;
  end if;

  -- Guard: the target must not already have a pending verification for this request.
  if exists (
    select 1 from public.volunteer_verifications vv
    where vv.request_id = (select request_id from public.volunteer_verifications where id = p_verification_id)
      and vv.volunteer_id = p_escalate_to
      and vv.status = 'pending'
  ) then
    return;
  end if;

  update public.volunteer_verifications vv
     set status = 'escalated',
         escalated_to = p_escalate_to,
         updated_at = now()
   where vv.id = p_verification_id
     and vv.volunteer_id = auth.uid()
     and vv.status = 'pending';

  -- Create a fresh pending task for the escalated-to volunteer.
  insert into public.volunteer_verifications
    (request_id, volunteer_id, target_deadline)
  select request_id, p_escalate_to, target_deadline
  from public.volunteer_verifications
  where id = p_verification_id
  returning id, status, escalated_to, target_deadline;
end;
$$;

revoke all on function public.escalate_volunteer_verification(uuid, uuid) from public, anon;
grant execute on function public.escalate_volunteer_verification(uuid, uuid) to authenticated;

comment on function public.escalate_volunteer_verification(uuid, uuid) is
  'Escalates a pending volunteer verification to another active volunteer. The original task is marked escalated and a new pending task is created for the target volunteer, inheriting the same deadline. Only the assigned volunteer may escalate.';

-- Server-side function: list pending verifications for the caller (volunteer).
create or replace function public.my_pending_verifications()
returns table (
  id uuid,
  request_id uuid,
  blood_group text,
  blood_component text,
  units integer,
  hospital_name text,
  hospital_locality text,
  urgency text,
  required_by timestamptz,
  target_deadline timestamptz,
  started_at timestamptz,
  minutes_left integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
  ) then
    return;
  end if;

  return query
  select
    vv.id,
    vv.request_id,
    r.blood_group,
    r.blood_component,
    r.units,
    r.hospital_name,
    r.hospital_locality,
    r.urgency,
    r.required_by,
    vv.target_deadline,
    vv.started_at,
    greatest(0, floor(extract(epoch from (vv.target_deadline - now())) / 60))::int,
    vv.status
  from public.volunteer_verifications vv
  join public.blood_requests r on r.id = vv.request_id
  where vv.volunteer_id = auth.uid()
    and vv.status = 'pending'
    and r.status = 'active'
  order by vv.target_deadline asc;
end;
$$;

revoke all on function public.my_pending_verifications() from public, anon;
grant execute on function public.my_pending_verifications() to authenticated;

comment on function public.my_pending_verifications() is
  'The caller volunteer''s own pending verification tasks: request facts (safe fields only), deadline, minutes left, and status. Never requester contact, never donor private data.';

-- Server-side function: list verification tasks for a requester's own requests.
create or replace function public.requester_verifications(p_request_id uuid)
returns table (
  id uuid,
  volunteer_id uuid,
  status text,
  target_deadline timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  verified_by uuid,
  escalated_to uuid,
  outcome_notes text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.blood_requests r
    where r.id = p_request_id and r.requester_id = auth.uid()
  ) then
    return;
  end if;

  return query
  select
    vv.id,
    vv.volunteer_id,
    vv.status,
    vv.target_deadline,
    vv.started_at,
    vv.completed_at,
    vv.verified_by,
    vv.escalated_to,
    vv.outcome_notes,
    vv.created_at
  from public.volunteer_verifications vv
  where vv.request_id = p_request_id
  order by vv.created_at desc;
end;
$$;

revoke all on function public.requester_verifications(uuid) from public, anon;
grant execute on function public.requester_verifications(uuid) to authenticated;

comment on function public.requester_verifications(uuid) is
  'Verification tasks on the caller''s own requests: status, deadline, outcome, and actor timestamps. Requester-facing, never exposes donor contact or medical details.';