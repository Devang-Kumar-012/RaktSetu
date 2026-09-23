-- 0011_emergency_alert_rings.sql
-- Real-time emergency alert ring engine for RaktSetu.
-- Requires migrations 0001–0010. Idempotent — safe to re-run.
--
-- What this provides (the names 0008's header and the README already promise):
--   * expand_alert_rings() — the server-side ring engine. Starts with the
--     first configured ring (3 km by default), gives every ring
--     alert_window_minutes() (10 minutes), then expands outward: 7 km, then
--     15 km. Ring distances come from alert_rings_km() → platform_settings,
--     never duplicated here. After the final ring's window ends, the
--     emergency alert process stops. The engine terminates immediately when a
--     request is fulfilled, cancelled, or expired (via the existing
--     expire_stale_requests() helper), or accepted by a donor.
--   * request_ring_progress — per-request ring state (which ring, started /
--     finished when, how many alerts it sent, why it stopped). PK
--     (request_id, ring_index) + ON CONFLICT DO NOTHING makes every
--     scheduler run idempotent; FOR UPDATE SKIP LOCKED makes overlapping runs
--     take disjoint requests instead of contending.
--   * pg_cron scheduling (every minute, when the extension is available) so
--     ring progression never depends on a browser tab; src/lib/ring-engine.ts
--     additionally ticks the engine during authenticated page renders as a
--     fallback for environments where pg_cron cannot be enabled.
--   * mark_alert_responded() — atomic donor accept/decline. Every check
--     (request still active, alert still valid, donor still eligible, nobody
--     else has won) runs under a lock on the request row, so the FIRST valid
--     acceptance wins and every later donor gets a safe non-success answer
--     with no requester contact information attached.
--   * notifications + emitters — the in-app notification system (no external
--     providers): an alert reached a donor, a donor accepted, a request
--     closed, rings exhausted.
--   * donor_active_alerts() — a donor's own alert queue with only the request
--     fields needed to decide; requester contact only inside the caller's own
--     accepted alert while contact_shared_until.
--   * reveal_accepted_donors() — the ONLY path revealing donor contact, and
--     only to the requester of that request after a valid acceptance.
--   * admin_ring_progress() — operational ring visibility for the existing
--     admin alerts page (no second analytics system).
--
-- Repairs to earlier migrations:
--   * donor_alerts.ring_km was hard-wired to (3, 7, 15) although admins can
--     configure other rings in platform_settings.
--   * The donor's own-row SELECT policy now covers their responded/closed
--     alerts too (their own history only — never another donor's data).
--   * platform_settings gains a SELECT policy for every privilege-holding
--     role: FORCE RLS would otherwise hide the settings row from the
--     scheduler/owner role and silently fall back to default rings.
--
-- Request lifecycle is UNCHANGED: active → fulfilled | cancelled, with
-- expired handled by the existing expiry helper. There is intentionally NO
-- 'accepted' request status — acceptance lives only on donor_alerts.

-- ---------------------------------------------------------------------------
-- 1. donor_alerts repairs: admin-configurable ring sizes, plus a
--    non-actionable alert state ('expired') used when a request closes or is
--    claimed by another donor.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.donor_alerts'::regclass
       and pg_get_constraintdef(oid) like '%3, 7, 15%'
  loop
    execute format('alter table public.donor_alerts drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.donor_alerts'::regclass
       and conname = 'donor_alerts_ring_km_check'
  ) then
    alter table public.donor_alerts
      add constraint donor_alerts_ring_km_check check (ring_km between 1 and 500);
  end if;
end $$;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.donor_alerts'::regclass
       and pg_get_constraintdef(oid) like '%queued%'
       and pg_get_constraintdef(oid) not like '%expired%'
  loop
    execute format('alter table public.donor_alerts drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.donor_alerts'::regclass
       and conname = 'donor_alerts_status_check'
  ) then
    alter table public.donor_alerts
      add constraint donor_alerts_status_check
      check (status in ('queued', 'sent', 'opened', 'responded', 'expired'));
  end if;
end $$;

-- A donor may read their OWN alerts in any state (their responded history is
-- theirs); responding still only happens through mark_alert_responded() — the
-- UPDATE policy keeps its status = 'sent' guard as defence in depth.
drop policy if exists donor_alerts_donor_select on public.donor_alerts;
create policy donor_alerts_donor_select on public.donor_alerts
  for select to authenticated
  using (auth.uid() = donor_id);

-- Donor-side queue lookups (the (request_id, donor_id) unique constraint
-- already covers request-side lookups).
create index if not exists donor_alerts_donor_idx
  on public.donor_alerts (donor_id, created_at desc);
-- ---------------------------------------------------------------------------
-- 2. request_ring_progress — per-request ring state for the engine
-- ---------------------------------------------------------------------------
create table if not exists public.request_ring_progress (
  request_id  uuid        not null references public.blood_requests (id) on delete cascade,
  ring_index  integer     not null check (ring_index >= 1),
  ring_km     integer     not null check (ring_km between 1 and 500),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  alerts_sent integer     not null default 0,
  outcome     text        check (outcome is null or outcome in
                                 ('accepted', 'request_closed', 'rings_exhausted')),
  created_at  timestamptz not null default now(),
  primary key (request_id, ring_index)
);

comment on table public.request_ring_progress is
  'Ring-engine state per request: which ring is/was running, when it started and finished, how many alerts it sent, and why the process stopped (donor accepted, request closed, or all rings exhausted). Written only by the SECURITY DEFINER engine. PK (request_id, ring_index) is the idempotency guarantee — a ring can never start twice.';

alter table public.request_ring_progress enable row level security;

revoke all on table public.request_ring_progress from anon;
revoke insert, update, delete on table public.request_ring_progress from authenticated;
grant select on table public.request_ring_progress to authenticated;

-- No INSERT/UPDATE policy exists: clients can only read. Writes happen
-- through the owner-run engine (SECURITY DEFINER), which bypasses RLS as the
-- table owner — deliberately NOT force-enabled here, unlike platform_settings.
drop policy if exists request_ring_progress_admin_select
  on public.request_ring_progress;
create policy request_ring_progress_admin_select
  on public.request_ring_progress for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists request_ring_progress_requester_select
  on public.request_ring_progress;
create policy request_ring_progress_requester_select
  on public.request_ring_progress for select to authenticated
  using (request_id in (
    select id from public.blood_requests where requester_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 3. notifications — the in-app notification system (no external providers)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigserial primary key,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  kind       text        not null check (kind in
                     ('alert_received', 'donor_accepted', 'request_closed', 'rings_exhausted')),
  request_id uuid        references public.blood_requests (id) on delete cascade,
  alert_id   bigint      references public.donor_alerts (id) on delete cascade,
  title      text        not null check (char_length(title) between 1 and 200),
  body       text        not null check (char_length(body) between 1 and 600),
  link       text        check (link is null or
                                (link ~ '^/[A-Za-z0-9/_-]*$' and char_length(link) <= 200)),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

comment on table public.notifications is
  'In-app notifications only — no email, SMS, or chat providers. Rows are created exclusively by SECURITY DEFINER emitters (alert engine, acceptance, request close-out). Users read and mark their OWN rows; clients can never insert.';

alter table public.notifications enable row level security;

revoke all on table public.notifications from anon;
revoke insert, update, delete on table public.notifications from authenticated;
grant select, update (read_at) on table public.notifications to authenticated;

drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists notifications_own_mark_read on public.notifications;
create policy notifications_own_mark_read
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- No INSERT/DELETE policy on purpose: emitters only (below).

-- Realtime refresh for the notifications page when the table is in the default
-- Supabase Realtime publication. Best-effort: the page is server-rendered and
-- also refreshes on focus, so a failure here never breaks anything.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
    ) then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
  end if;
exception when others then
  raise notice 'notifications realtime publication skipped: %', sqlerrm;
end $$;
-- ---------------------------------------------------------------------------
-- 4. Notification emitters (server-side only)
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(
  p_user_id    uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_request_id uuid   default null,
  p_alert_id   bigint default null,
  p_link       text   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, request_id, alert_id, link)
  values (p_user_id, p_kind, p_title, p_body, p_request_id, p_alert_id, p_link);
end;
$$;

-- Internal helper: owner-only. Revoked from PUBLIC (the default execute
-- grant), anon, and authenticated — only SECURITY DEFINER engine code calls it.
revoke all on function public.notify_user(uuid, text, text, text, uuid, bigint, text)
  from public, anon, authenticated;

-- Every alert row the engine creates notifies its donor inside the same
-- transaction — this is how the ring engine connects to in-app notifications.
create or replace function public.emit_alert_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.blood_requests%rowtype;
begin
  select * into r from public.blood_requests where id = new.request_id;
  if not found then
    return null;
  end if;

  perform public.notify_user(
    new.donor_id,
    'alert_received',
    'Blood needed within ' || new.ring_km || ' km of you',
    r.blood_group || ' (' || replace(r.blood_component, '_', ' ') || ', ' ||
      case when r.units = 1 then '1 unit' else r.units || ' units' end ||
      ') at ' || r.hospital_name || ', ' || r.hospital_locality ||
      '. Open your dashboard to accept or decline.',
    new.request_id,
    new.id,
    '/dashboard/donor'
  );
  return null;
end;
$$;

revoke all on function public.emit_alert_received() from public, anon, authenticated;

drop trigger if exists donor_alerts_emit_notification on public.donor_alerts;
create trigger donor_alerts_emit_notification
  after insert on public.donor_alerts
  for each row execute function public.emit_alert_received();

-- ---------------------------------------------------------------------------
-- 5. Configuration visibility for the scheduler + system-context matching
-- ---------------------------------------------------------------------------
-- platform_settings is FORCE row-level security (0010) and its policies only
-- covered the authenticated/admin roles. The engine runs as the owner
-- (pg_cron / SECURITY DEFINER — no session role), so without this policy the
-- scheduler would silently read the DEFAULT rings instead of the admin's
-- configuration. Table-level privileges are unchanged: anon was already
-- revoked from the table, so this adds no anonymous surface.
drop policy if exists "Ring engine can read settings" on public.platform_settings;
create policy "Ring engine can read settings"
  on public.platform_settings for select to public
  using (true);
-- match_donors_for_request(): unchanged rules, one addition — the ring engine
-- may call it with no session user. It proves itself with a transaction-local
-- GUC that only its own SECURITY DEFINER body can set (PostgREST exposes
-- function calls only, never this set_config path to clients). Every ring
-- therefore re-evaluates the SAME rules: request active, donor available and
-- past the cooldown (donor_directory), active account, blood-group
-- compatibility, distance within the ring — never a stale donor list.
create or replace function public.match_donors_for_request(
  p_request_id uuid,
  p_radius_km double precision default null,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  blood_group text,
  locality text,
  distance_km double precision,
  availability text,
  cooldown_clear boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_group text;
  v_request_component text;
  v_lat numeric;
  v_lng numeric;
  v_radius double precision;
begin
  -- Caller must own the request (or be an admin) and the request must be
  -- active — or be the ring engine in its transaction. Anything else: no rows.
  select r.blood_group, r.blood_component, r.hospital_latitude, r.hospital_longitude
    into v_request_group, v_request_component, v_lat, v_lng
  from public.blood_requests r
  where r.id = p_request_id
    and r.status = 'active'
    and (
      r.requester_id = auth.uid()
      or exists (
        select 1 from public.profiles a
        where a.id = auth.uid() and a.role = 'admin'
      )
      or current_setting('raktsetu.engine', true) = 'on'
    );

  if v_request_group is null then
    return;
  end if;

  -- Normalise the radius: null stays null (no cap); otherwise keep it within
  -- a sane application range.
  v_radius := case
    when p_radius_km is null then null
    else least(greatest(p_radius_km, 0.5), 500)
  end;

  return query
  with candidates as (
    select
      d.user_id,
      d.blood_group,
      d.locality,
      d.availability,
      public.donor_is_currently_eligible(dp.last_donation_date) as cooldown_clear,
      case
        when v_lat is null or dp.latitude is null or dp.longitude is null then null
        else public.haversine_km(dp.latitude, dp.longitude, v_lat, v_lng)
      end as dist
    from public.donor_directory d
    join public.donor_profiles dp on dp.user_id = d.user_id
    join public.profiles p
      on p.id = d.user_id and p.role = 'donor' and p.status = 'active'
    where public.blood_groups_compatible(d.blood_group, v_request_group, v_request_component)
  )
  select c.user_id, c.blood_group, c.locality, c.dist, c.availability, c.cooldown_clear
  from candidates c
  where v_radius is null
     or (c.dist is not null and c.dist <= v_radius)
  order by c.dist asc nulls last, c.user_id asc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

revoke all on function public.match_donors_for_request(uuid, double precision, integer)
  from public, anon;
grant execute on function public.match_donors_for_request(uuid, double precision, integer)
  to authenticated;

comment on function public.match_donors_for_request is
  'Eligible donors for an ACTIVE blood request, nearest first. Eligibility = available + past the application cooldown (donor_directory), active donor profile, blood-group compatible, and within p_radius_km when given (with a radius, donors without usable location data are excluded — they cannot be proven inside the ring). Called by requesters/admins via session AND by the ring engine via the transaction-local raktsetu.engine marker. Returns only user_id, blood_group, locality, distance_km, availability, cooldown_clear — never names, phones, emails, or coordinates.';
-- ---------------------------------------------------------------------------
-- 6. expand_alert_rings() — the ring engine
-- ---------------------------------------------------------------------------
create or replace function public.expand_alert_rings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rings      integer[];
  v_total      integer;
  v_window     integer;
  v_offset     integer;
  v_progress   record;
  v_ring_index integer;
  v_ring_km    integer;
  v_due_at     timestamptz;
  v_radius     double precision;
  v_new        integer := 0;
  v_sent       integer := 0;
begin
  -- Transaction-local system marker: match_donors_for_request() accepts this
  -- context instead of a session owner. Clients cannot set it (PostgREST only
  -- exposes function invocations, and this path lives in our own body), and
  -- is_local=true means it dies with this transaction.
  perform set_config('raktsetu.engine', 'on', true);

  v_window := greatest(coalesce(public.alert_window_minutes(), 10), 1);
  v_offset := greatest(coalesce(public.alert_due_at_offset_minutes(), 120), 1);
  v_rings  := coalesce(public.alert_rings_km(), array[3, 7, 15]);
  v_total  := coalesce(array_length(v_rings, 1), 0);
  if v_total = 0 then
    return 0;
  end if;

  -- 1. Past-deadline requests become 'expired' first: they must stop the
  --    alert process on this very run (existing lifecycle helper, 0004).
  perform public.expire_stale_requests();

  -- 2. Closed requests (fulfilled / cancelled / expired): retire outstanding
  --    alerts, finish their ring process, and notify the affected donors.
  --    Re-running is a no-op — only still-open rows match.
  with closed as (
    update public.donor_alerts a
       set status = 'expired'
     where a.status in ('queued', 'sent', 'opened')
       and exists (
         select 1 from public.blood_requests r
          where r.id = a.request_id and r.status <> 'active'
       )
    returning a.id, a.donor_id, a.request_id
  ), notified as (
    insert into public.notifications (user_id, kind, title, body, request_id, alert_id, link)
    select c.donor_id,
           'request_closed',
           'A blood request you were alerted about has closed',
           'The request at ' || coalesce(r.hospital_name, 'the hospital') ||
             ' is no longer active — no further action is needed.',
           c.request_id,
           c.id,
           '/notifications'
      from closed c
      join public.blood_requests r on r.id = c.request_id
    returning id
  )
  select count(*) into v_new from notified;

  update public.request_ring_progress p
     set finished_at = coalesce(p.finished_at, now()),
         outcome     = coalesce(p.outcome, 'request_closed')
   where p.finished_at is null
     and exists (
       select 1 from public.blood_requests r
        where r.id = p.request_id and r.status <> 'active'
     );

  -- 3. Requests already accepted by a donor: finish the process at once and
  --    retire any straggler alerts. mark_alert_responded() already did both
  --    atomically at acceptance time — this is the idempotent safety net, so
  --    repeated scheduler executions behave identically.
  update public.donor_alerts a
     set status = 'expired'
   where a.status in ('queued', 'sent', 'opened')
     and exists (
       select 1 from public.donor_alerts w
        where w.request_id = a.request_id and w.response = 'accepted'
     );

  update public.request_ring_progress p
     set finished_at = coalesce(p.finished_at, now()),
         outcome     = coalesce(p.outcome, 'accepted')
   where p.finished_at is null
     and exists (
       select 1 from public.donor_alerts a
        where a.request_id = p.request_id and a.response = 'accepted'
     );
  -- 4. Advance the rings of every still-active, still-unclaimed request.
  --    SKIP LOCKED: an overlapping scheduler run takes different requests
  --    instead of contending — safe under repeated/concurrent executions.
  for v_request in
    select r.id, r.requester_id, r.required_by,
           r.hospital_latitude, r.hospital_longitude
      from public.blood_requests r
     where r.status = 'active'
       and r.required_by > now()
       and not exists (
         select 1 from public.donor_alerts a
          where a.request_id = r.id and a.response = 'accepted'
       )
       and not exists (
         select 1 from public.request_ring_progress p
          where p.request_id = r.id and p.finished_at is not null
       )
     order by r.required_by asc
     for update skip locked
  loop
    select p.* into v_progress
      from public.request_ring_progress p
     where p.request_id = v_request.id
     order by p.ring_index desc
     limit 1;

    if not found then
      -- First ring of the sequence (3 km by default — from config).
      v_ring_index := 1;
      v_ring_km    := v_rings[1];
    else
      if now() < v_progress.started_at + make_interval(mins => v_window) then
        continue; -- the current ring still has its window
      end if;
      if v_progress.ring_index >= v_total then
        -- Final ring's window elapsed → stop the emergency alert process.
        update public.request_ring_progress
           set finished_at = now(), outcome = 'rings_exhausted'
         where request_id = v_request.id
           and ring_index = v_progress.ring_index
           and finished_at is null;
        perform public.notify_user(
          v_request.requester_id,
          'rings_exhausted',
          'All alert rings completed without a response',
          'Donors within ' || v_progress.ring_km || ' km were alerted across ' ||
            v_total || ' ring(s) and nobody accepted in time. The request stays ' ||
            'active — you can still mark it fulfilled or cancel it.',
          v_request.id,
          null,
          '/dashboard/requester'
        );
        continue;
      end if;
      v_ring_index := v_progress.ring_index + 1;
      v_ring_km    := v_rings[v_ring_index];
    end if;

    if v_ring_km is null then
      continue;
    end if;

    -- Start the ring. PK (request_id, ring_index) + ON CONFLICT DO NOTHING
    -- turns a repeated or concurrent tick into a no-op, never a double send.
    insert into public.request_ring_progress (request_id, ring_index, ring_km, started_at)
    values (v_request.id, v_ring_index, v_ring_km, now())
    on conflict (request_id, ring_index) do nothing;

    -- Respond-by deadline for this request's alerts: normally the configured
    -- offset before the deadline, never later than the deadline itself (an
    -- emergency close to its deadline still gets a future, valid due_at).
    v_due_at := case
      when v_request.required_by - make_interval(mins => v_offset) <= now()
        then v_request.required_by
      else v_request.required_by - make_interval(mins => v_offset)
    end;

    -- Radius only when the hospital area has a pinned location; without one,
    -- distance is unknown and matching falls back to group + eligibility,
    -- exactly like the requester match view (0007 semantics preserved).
    v_radius := case
      when v_request.hospital_latitude is null
        or v_request.hospital_longitude is null
        then null
      else v_ring_km::double precision
    end;

    -- Re-evaluate eligible donors FROM SCRATCH for this ring — compatibility,
    -- availability, cooldown, distance, active account (via
    -- match_donors_for_request → donor_directory) — minus anyone already
    -- alerted for this request; the UNIQUE (request_id, donor_id) constraint
    -- enforces that in the database, not just here. A donor who accepted or
    -- declined earlier can never be re-alerted for this request, and the
    -- accepted donor's request stops before any of this runs.
    with fresh as (
      select m.user_id
        from public.match_donors_for_request(v_request.id, v_radius, 50) m
       where not exists (
         select 1 from public.donor_alerts a
          where a.request_id = v_request.id and a.donor_id = m.user_id
       )
    ), inserted as (
      insert into public.donor_alerts (request_id, donor_id, ring_km, status, due_at)
      select v_request.id, f.user_id, v_ring_km, 'sent', v_due_at
        from fresh f
      on conflict (request_id, donor_id) do nothing
      returning id
    )
    select count(*) into v_new from inserted;

    update public.request_ring_progress
       set alerts_sent = v_new
     where request_id = v_request.id
       and ring_index = v_ring_index;

    v_sent := v_sent + v_new;
    -- The AFTER INSERT trigger on donor_alerts emits the in-app notification
    -- for every alert row created here, inside this same transaction.
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.expand_alert_rings() from public, anon;
grant execute on function public.expand_alert_rings() to authenticated;

comment on function public.expand_alert_rings() is
  'Ring engine: starts and advances rings from alert_rings_km(), giving each ring alert_window_minutes(), for ACTIVE requests with no accepted donor — re-evaluating eligible donors from scratch each ring and never re-alerting anyone (UNIQUE request+donor). Stops immediately on fulfil/cancel/expiry/acceptance and after the final ring. Idempotent and safe under concurrent scheduler runs (row locks + ON CONFLICT). Returns the number of alerts created.';
-- ---------------------------------------------------------------------------
-- 7. mark_alert_responded() — atomic, first-valid-acceptance-wins
-- ---------------------------------------------------------------------------
create or replace function public.mark_alert_responded(
  p_alert_id bigint,
  p_response text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert   record;
  v_request record;
  v_due_at  timestamptz;
  v_offset  integer;
begin
  if p_alert_id is null or p_response not in ('accepted', 'declined') then
    return 'invalid_response';
  end if;

  -- Lock order is fixed: REQUEST ROW FIRST, then the alert. Two donors
  -- accepting at the same instant serialise here — the second waits, then
  -- observes the winner and receives a safe non-success answer with no
  -- requester contact information attached.
  select r.* into v_request
    from public.blood_requests r
   where r.id = (select a.request_id from public.donor_alerts a where a.id = p_alert_id)
   for update;
  if not found then
    return 'not_found';
  end if;

  select a.* into v_alert
    from public.donor_alerts a
   where a.id = p_alert_id
   for update;
  if not found then
    return 'not_found';
  end if;
  if auth.uid() is null or v_alert.donor_id <> auth.uid() then
    return 'not_your_alert';
  end if;
  if v_alert.response is not null then
    return 'already_responded';
  end if;
  -- Has someone already won? Checked before the status so a later donor
  -- learns the true reason even though the engine retired their alert.
  if exists (
    select 1 from public.donor_alerts w
     where w.request_id = v_request.id and w.response = 'accepted'
  ) then
    return 'already_taken';
  end if;
  if v_alert.status not in ('sent', 'opened') then
    return 'request_closed';
  end if;
  if v_alert.due_at <= now() then
    return 'alert_expired';
  end if;
  if v_request.status <> 'active' or v_request.required_by <= now() then
    return 'request_closed';
  end if;
  -- The donor must STILL be eligible right now: available + past the
  -- cooldown (donor_directory membership), active account, compatible group
  -- and component. Pausing after the alert does not enable acceptance.
  if not exists (
    select 1
      from public.donor_directory d
      join public.profiles p
        on p.id = d.user_id and p.role = 'donor' and p.status = 'active'
     where d.user_id = v_alert.donor_id
       and public.blood_groups_compatible(
             d.blood_group, v_request.blood_group, v_request.blood_component)
  ) then
    return 'not_eligible';
  end if;

  if p_response = 'declined' then
    update public.donor_alerts
       set status = 'responded', response = 'declined', responded_at = now()
     where id = p_alert_id;
    -- The UNIQUE (request_id, donor_id) row is the durable record: this donor
    -- is never alerted again for this request.
    return 'declined';
  end if;

  -- ACCEPT: every check above ran under the request-row lock, so this is the
  -- first — and only — winning acceptance for this request.
  v_offset := greatest(coalesce(public.alert_due_at_offset_minutes(), 120), 1);
  v_due_at := case
    when v_request.required_by - make_interval(mins => v_offset) <= now()
      then v_request.required_by
    else v_request.required_by - make_interval(mins => v_offset)
  end;

  update public.donor_alerts
     set status = 'responded',
         response = 'accepted',
         responded_at = now(),
         accepted_at = now(),
         contact_shared_until = v_due_at
   where id = p_alert_id;

  -- Every other outstanding alert stops immediately: no further rings and no
  -- further contact — the request now has a winner.
  update public.donor_alerts
     set status = 'expired'
   where request_id = v_request.id
     and id <> p_alert_id
     and status in ('queued', 'sent', 'opened');

  update public.request_ring_progress
     set finished_at = coalesce(finished_at, now()),
         outcome = coalesce(outcome, 'accepted')
   where request_id = v_request.id
     and finished_at is null;

  perform public.notify_user(
    v_request.requester_id,
    'donor_accepted',
    'A donor accepted your blood request',
    'An alerted donor responded yes for ' || v_request.hospital_name || ' (' ||
      v_request.blood_group || ', ' ||
      case when v_request.units = 1 then '1 unit'
           else v_request.units || ' units' end ||
      '). Their contact is on your requester dashboard until the deadline.',
    v_request.id,
    v_alert.id,
    '/dashboard/requester'
  );

  return 'accepted';
end;
$$;

revoke all on function public.mark_alert_responded(bigint, text) from public, anon;
grant execute on function public.mark_alert_responded(bigint, text) to authenticated;

comment on function public.mark_alert_responded(bigint, text) is
  'Atomic donor response to one alert. Locks the request row first so concurrent acceptances serialise: the FIRST valid acceptance wins; every later donor gets a safe non-success outcome with no requester contact. Verifies ownership, alert validity (still open, due_at not passed), request still active, no existing winner, and current donor eligibility. Declines are recorded durably so the donor is never re-alerted for the same request. Returns an outcome code — never data.';
-- ---------------------------------------------------------------------------
-- 8. donor_active_alerts() — the donor's own alert queue (safe fields only)
-- ---------------------------------------------------------------------------
create or replace function public.donor_active_alerts(
  p_limit integer default 50
)
returns table (
  alert_id bigint,
  request_id uuid,
  ring_km integer,
  status text,
  response text,
  due_at timestamptz,
  created_at timestamptz,
  responded_at timestamptz,
  contact_shared_until timestamptz,
  blood_group text,
  blood_component text,
  units integer,
  hospital_name text,
  hospital_locality text,
  urgency text,
  required_by timestamptz,
  note text,
  request_status text,
  requester_contact_name text,
  requester_contact_phone text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'donor'
  ) then
    return;
  end if;

  return query
  select
    a.id,
    a.request_id,
    a.ring_km,
    a.status,
    a.response,
    a.due_at,
    a.created_at,
    a.responded_at,
    a.contact_shared_until,
    r.blood_group,
    r.blood_component,
    r.units,
    r.hospital_name,
    r.hospital_locality,
    r.urgency,
    r.required_by,
    r.note,
    r.status,
    -- Privacy: the requester's contact appears ONLY inside the caller's own
    -- accepted alert and only while contact_shared_until — never for declined
    -- or expired alerts, never because another donor accepted.
    case when a.response = 'accepted' and a.contact_shared_until > now()
         then r.contact_name end,
    case when a.response = 'accepted' and a.contact_shared_until > now()
         then r.contact_phone end
  from public.donor_alerts a
  join public.blood_requests r on r.id = a.request_id
  where a.donor_id = auth.uid()
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.donor_active_alerts(integer) from public, anon;
grant execute on function public.donor_active_alerts(integer) to authenticated;

comment on function public.donor_active_alerts(integer) is
  'The caller''s own alert queue: alert state (ring, due, response) plus the request fields needed to decide (group, component, units, hospital area, urgency, deadline, note, lifecycle). Requester contact only inside the caller''s own accepted alert while contact_shared_until. Never donor coordinates, never other donors'' data.';
-- ---------------------------------------------------------------------------
-- 9. reveal_accepted_donors() — the only donor-contact reveal path
-- ---------------------------------------------------------------------------
create or replace function public.reveal_accepted_donors(
  p_request_ids uuid[]
)
returns table (
  request_id uuid,
  donor_name text,
  donor_phone text,
  donor_blood_group text,
  donor_locality text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or p_request_ids is null
     or coalesce(array_length(p_request_ids, 1), 0) = 0 then
    return;
  end if;

  -- Only the requester of each request sees their accepted donor, only after
  -- a recorded acceptance, and only until contact_shared_until. Name, phone,
  -- group, locality — exactly what coordination needs, nothing else.
  return query
  select distinct on (r.id)
    r.id,
    pr.full_name,
    dp.phone,
    dp.blood_group,
    dp.locality
  from unnest(p_request_ids) as q(id)
  join public.blood_requests r on r.id = q.id
  join public.donor_alerts a
    on a.request_id = r.id and a.response = 'accepted'
  join public.donor_profiles dp on dp.user_id = a.donor_id
  join public.profiles pr on pr.id = a.donor_id
  where r.requester_id = auth.uid()
    and a.contact_shared_until > now()
  order by r.id, a.accepted_at desc nulls last;
end;
$$;

revoke all on function public.reveal_accepted_donors(uuid[]) from public, anon;
grant execute on function public.reveal_accepted_donors(uuid[]) to authenticated;

comment on function public.reveal_accepted_donors(uuid[]) is
  'Post-acceptance donor reveal for the requesting user only: name, phone, blood group, locality — never email, never coordinates, never before an acceptance, never after contact_shared_until. This is the only path that exposes donor contact to another user.';
-- ---------------------------------------------------------------------------
-- 10. admin_ring_progress() — operational visibility for the admin alerts page
-- ---------------------------------------------------------------------------
create or replace function public.admin_ring_progress(
  p_limit integer default 50
)
returns table (
  request_id uuid,
  ring_index integer,
  ring_km integer,
  started_at timestamptz,
  finished_at timestamptz,
  alerts_sent integer,
  outcome text,
  request_status text,
  blood_group text,
  hospital_name text,
  hospital_locality text,
  required_by timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  ) then
    return;
  end if;

  return query
  select
    rp.request_id, rp.ring_index, rp.ring_km, rp.started_at, rp.finished_at,
    rp.alerts_sent, rp.outcome, br.status, br.blood_group, br.hospital_name,
    br.hospital_locality, br.required_by
  from public.request_ring_progress rp
  join public.blood_requests br on br.id = rp.request_id
  order by rp.started_at desc, rp.ring_index desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_ring_progress(integer) from public, anon;
grant execute on function public.admin_ring_progress(integer) to authenticated;

comment on function public.admin_ring_progress(integer) is
  'Operational ring-engine state for active administrators: which ring each tracked request reached, when it started/finished, how many alerts it sent, and why the process stopped. Request context only — no donor or requester private data.';

-- ---------------------------------------------------------------------------
-- 11. requester_ring_status() — the requester's OWN ring-engine visibility
-- ---------------------------------------------------------------------------
create or replace function public.requester_ring_status(
  p_request_ids uuid[]
)
returns table (
  request_id uuid,
  ring_index integer,
  ring_km integer,
  started_at timestamptz,
  finished_at timestamptz,
  alerts_sent integer,
  outcome text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or p_request_ids is null
     or coalesce(array_length(p_request_ids, 1), 0) = 0 then
    return;
  end if;

  return query
  select rp.request_id, rp.ring_index, rp.ring_km, rp.started_at,
         rp.finished_at, rp.alerts_sent, rp.outcome
  from public.request_ring_progress rp
  join public.blood_requests br on br.id = rp.request_id
  where rp.request_id = any (p_request_ids)
    and br.requester_id = auth.uid()
  order by rp.started_at desc, rp.ring_index desc
  limit 500;
end;
$$;

revoke all on function public.requester_ring_status(uuid[]) from public, anon;
grant execute on function public.requester_ring_status(uuid[]) to authenticated;

comment on function public.requester_ring_status(uuid[]) is
  'Ring-engine progress for the caller''s own requests only: which ring is/was running, when it started/finished, how many alerts it sent, and why the process stopped. Ownership re-checked inside the SECURITY DEFINER body — another requester''s progress is never visible.';

-- ---------------------------------------------------------------------------
-- 12. Scheduler: pg_cron ticks the engine every minute (optional, guarded)
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled (%); the engine will rely on the application tick', sqlerrm;
  end;

  if to_regnamespace('cron') is not null then
    -- Replace any earlier copy so re-running the migration keeps ONE job.
    perform cron.unschedule(v.jobid)
      from cron.job v
     where v.jobname = 'raktsetu-alert-rings';
    perform cron.schedule(
      'raktsetu-alert-rings',
      '* * * * *',
      'select public.expand_alert_rings()'
    );
  else
    raise notice 'cron schema missing; the engine will rely on the application tick';
  end if;
exception when others then
  raise notice 'ring scheduler not installed (%); src/lib/ring-engine.ts still ticks the engine during authenticated traffic', sqlerrm;
end $$;

-- End of migration 0011_emergency_alert_rings.sql.
