-- ---------------------------------------------------------------------------
-- Migration 0012 — donor-facing emergency alert experience (PROMPT 19)
-- ---------------------------------------------------------------------------
-- Additive support for the donor dashboard UX on top of the 0011 ring engine.
-- The authoritative request lifecycle (active → fulfilled | expired |
-- cancelled; terminal states final) and mark_alert_responded()'s first-valid-
-- acceptance-wins flow are UNCHANGED — there is still no 'accepted' request
-- status; acceptance lives only on donor_alerts.response.
--
-- Adds (every emitter is SECURITY DEFINER; notifications stay emitters-only —
-- clients still cannot INSERT into notifications):
--   1. Six new notification kinds (constraint widened below): alert_expiring,
--      already_accepted, request_fulfilled, request_cancelled,
--      request_expired, eligibility_updated.
--   2. emit_alert_expiring() — ONE "respond soon" nudge per open alert,
--      guarded by the new donor_alerts.expiring_notified_at column.
--   3. emit_alert_claimed() — a competing acceptance retired this donor's open
--      alert while the request is still active → told so (open→expired only).
--   4. emit_request_closeout() — the single active→terminal transition gives
--      the accepted donor the specific outcome AND retires/notifies every
--      still-open alert, so no donor is left waiting.
--   5. sync_donor_profile_from_donation() — an admin-recorded donation now
--      starts the cooldown (last_donation_date) and refreshes donation_count.
--   6. emit_eligibility_updated() — one notice when the donation date changes.
--   7. donor_active_alerts() recreated (drop+create: return type changed) with
--      an APPROXIMATE whole-km distance to the hospital, computed from the
--      caller's OWN rounded point (haversine_km; null when either side lacks
--      a point). Coordinates are never returned; the auth.uid() gate is
--      unchanged.
--   8. donor_donation_history() — the caller's OWN donation records joined to
--      safe request fields. No requester contact, no coordinates.
--
-- Run order: after 0011. Idempotent (drop-if-exists / create or replace).
-- ---------------------------------------------------------------------------

-- 1. Widen the notification kind check (0011 created it as the auto-named
--    column check notifications_kind_check).
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'alert_received', 'donor_accepted', 'request_closed', 'rings_exhausted',
    'alert_expiring', 'already_accepted',
    'request_fulfilled', 'request_cancelled', 'request_expired',
    'eligibility_updated'
  ));

-- 2. Per-alert guard for the single "expiring" nudge, plus a partial index so
--    the every-minute sweep stays cheap as donor_alerts grows.
alter table public.donor_alerts
  add column if not exists expiring_notified_at timestamptz;

create index if not exists donor_alerts_expiring_idx
  on public.donor_alerts (due_at)
  where expiring_notified_at is null and response is null;

-- 3. emit_alert_expiring() — at most one nudge per open alert.
create or replace function public.emit_alert_expiring()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with candidates as (
    select a.id, a.donor_id, a.request_id, a.due_at, a.ring_km,
           r.blood_group, r.blood_component, r.units,
           r.hospital_name, r.hospital_locality
      from public.donor_alerts a
      join public.blood_requests r on r.id = a.request_id
     where a.response is null
       and a.status in ('queued', 'sent', 'opened')
       and a.expiring_notified_at is null
       and a.due_at > now()
       -- 15 = ALERT_EXPIRING_NOTICE_MINUTES in src/lib/constants.ts.
       and a.due_at <= now() + make_interval(mins => 15)
     order by a.due_at asc
     limit 500
     for update of a skip locked
  ), marked as (
    -- Guarded UPDATE = the idempotence lock: a competing tick's rows are
    -- skipped or re-checked after its lock wait, so a second notification
    -- can never be inserted for the same alert.
    update public.donor_alerts d
       set expiring_notified_at = now()
      from candidates c
     where d.id = c.id
       and d.status in ('queued', 'sent', 'opened')
       and d.response is null
    returning d.id, d.donor_id, d.request_id, d.due_at, d.ring_km,
              c.blood_group, c.blood_component, c.units,
              c.hospital_name, c.hospital_locality
  )
  insert into public.notifications (user_id, kind, title, body, request_id, alert_id, link)
  select m.donor_id,
         'alert_expiring',
         'Respond soon — your ' || m.ring_km || ' km alert is expiring',
         m.blood_group || ' (' || replace(m.blood_component, '_', ' ') || ', ' ||
           case when m.units = 1 then '1 unit' else m.units || ' units' end ||
           ') at ' || m.hospital_name || ', ' || m.hospital_locality ||
           '. Respond by ' ||
           to_char(m.due_at at time zone 'Asia/Kolkata', 'DD Mon, HH24:MI') ||
           ' IST or this alert closes with no response.',
         m.request_id,
         m.id,
         '/dashboard/donor'
    from marked m;
end;
$$;

revoke all on function public.emit_alert_expiring() from public, anon, authenticated;
grant execute on function public.emit_alert_expiring() to authenticated;

comment on function public.emit_alert_expiring() is
  'One-shot "expiring" nudge for open, unanswered alerts due within 15 minutes (mirrors ALERT_EXPIRING_NOTICE_MINUTES). Donor-facing request facts only — no coordinates, no requester contact. Idempotent via donor_alerts.expiring_notified_at under FOR UPDATE SKIP LOCKED; driven by pg_cron and the app tick (src/lib/ring-engine.ts).';

-- 4. emit_alert_claimed() — a competing acceptance retired this donor's open
--    alert. Fires ONLY on open→expired, ONLY while the request is still
--    active with a recorded winner; the request-closure path flips the same
--    statuses while the request is NOT active, so donors hear about the
--    closure instead — never both.
create or replace function public.emit_alert_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.blood_requests%rowtype;
begin
  if new.response is not null then
    return null;
  end if;
  select * into r from public.blood_requests where id = new.request_id;
  if not found or r.status <> 'active' then
    return null; -- closure, not a competing acceptance
  end if;
  if not exists (
    select 1 from public.donor_alerts w
     where w.request_id = new.request_id
       and w.response = 'accepted'
  ) then
    return null; -- retired without a winner — not a claim
  end if;

  perform public.notify_user(
    new.donor_id,
    'already_accepted',
    'Another donor accepted this request',
    'Someone else was able to donate for the ' || r.blood_group ||
      ' need at ' || r.hospital_name || ', ' || r.hospital_locality ||
      '. This alert is closed — thank you for being ready to help.',
    new.request_id,
    new.id,
    '/dashboard/donor'
  );
  return null;
end;
$$;

revoke all on function public.emit_alert_claimed() from public, anon, authenticated;

drop trigger if exists donor_alerts_emit_claimed on public.donor_alerts;
create trigger donor_alerts_emit_claimed
  after update of status on public.donor_alerts
  for each row
  when (
    old.status in ('queued', 'sent', 'opened') and new.status = 'expired'
  )
  execute function public.emit_alert_claimed();

-- 5. emit_request_closeout() — the ONE active→terminal transition. Notifies
--    the accepted donor with the specific outcome, then retires and notifies
--    every still-open alert with the same specific kind. Terminal states are
--    final, so this runs at most once per request; the claimed-trigger skips
--    the rows flipped here (request no longer active), so each donor hears
--    exactly once. The engine's closure sweep stays as a safety net and
--    finds no open alerts left.
create or replace function public.emit_request_closeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_label text;
  v_donor uuid;
  v_alert bigint;
begin
  v_kind  := 'request_' || new.status;
  v_label := case new.status
               when 'fulfilled' then 'fulfilled'
               when 'cancelled' then 'cancelled'
               else 'expired'
             end;

  -- 1. The winning donor gets the specific outcome (if there is one).
  select a.donor_id, a.id into v_donor, v_alert
    from public.donor_alerts a
   where a.request_id = new.id
     and a.response = 'accepted'
   limit 1;
  if v_donor is not null then
    perform public.notify_user(
      v_donor,
      v_kind,
      'Request ' || v_label,
      case when new.status = 'fulfilled'
        then 'The ' || new.blood_group || ' request at ' || new.hospital_name ||
             ' was fulfilled — thank you for helping. Once your coordinator ' ||
             'records the donation, it appears in your donation history.'
        else 'The ' || new.blood_group || ' request at ' || new.hospital_name ||
             ' was ' || v_label || '. No donation is needed for this request.'
      end,
      new.id,
      v_alert,
      '/dashboard/donor'
    );
  end if;

  -- 2. Outstanding open alerts: retire + notify in the same statement.
  with flipped as (
    update public.donor_alerts d
       set status = 'expired'
     where d.request_id = new.id
       and d.response is null
       and d.status in ('queued', 'sent', 'opened')
    returning d.donor_id, d.id
  )
  insert into public.notifications (user_id, kind, title, body, request_id, alert_id, link)
  select f.donor_id,
         v_kind,
         'Request ' || v_label,
         'The ' || new.blood_group || ' need at ' || new.hospital_name || ', ' ||
           new.hospital_locality || ' was ' || v_label ||
           '. No response is needed — this alert is closed.',
         new.id,
         f.id,
         '/dashboard/donor'
    from flipped f;
  return new;
end;
$$;

revoke all on function public.emit_request_closeout() from public, anon, authenticated;

drop trigger if exists blood_requests_emit_closeout on public.blood_requests;
create trigger blood_requests_emit_closeout
  after update of status on public.blood_requests
  for each row
  when (
    old.status = 'active'
    and new.status in ('fulfilled', 'cancelled', 'expired')
  )
  execute function public.emit_request_closeout();

-- 6. sync_donor_profile_from_donation() — admin-recorded donations (0010)
--    previously left donor_profiles untouched, so the cooldown never started
--    and donation_count never moved. This bridge starts the interval the
--    profile form already promises ("after a donation, matching pauses
--    automatically") and refreshes the system-managed count. The update then
--    fires the eligibility notice below whenever the date actually changes.
create or replace function public.sync_donor_profile_from_donation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.donor_profiles
     set last_donation_date = case
           when last_donation_date is null
             or last_donation_date < new.donated_on
             then new.donated_on
           else last_donation_date
         end,
         donation_count = (select count(*)::int from public.donation_history h where h.donor_id = new.donor_id)
   where user_id = new.donor_id;
  return new;
end;
$$;

revoke all on function public.sync_donor_profile_from_donation() from public, anon, authenticated;

drop trigger if exists donation_history_sync_donor on public.donation_history;
create trigger donation_history_sync_donor
  after insert on public.donation_history
  for each row
  execute function public.sync_donor_profile_from_donation();

-- 7. emit_eligibility_updated() — ONE notification whenever the recorded
--    last-donation date actually changes (cooldown start, a later donation
--    overwriting an earlier date, or the date being cleared). The
--    IS DISTINCT FROM guard makes repeat saves with the same date no-ops.
--    Returning to matching once the interval passes is shown live on the
--    dashboard badge instead — no sweep, no notification storm.
create or replace function public.emit_eligibility_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next date;
begin
  if new.last_donation_date is null then
    perform public.notify_user(
      new.user_id,
      'eligibility_updated',
      'Donation interval cleared',
      'Your recorded last-donation date was cleared, so the ' ||
        public.donation_interval_days() ||
        '-day availability interval no longer applies. This only affects ' ||
        'matching — the blood bank''s screening decides medical eligibility.',
      null,
      null,
      '/dashboard/donor'
    );
    return null;
  end if;

  v_next := new.last_donation_date +
            make_interval(days => public.donation_interval_days());
  perform public.notify_user(
    new.user_id,
    'eligibility_updated',
    'Donation interval updated',
    'Last donation recorded as ' ||
      to_char(new.last_donation_date, 'DD Mon YYYY') ||
      ' — matching pauses until ' || to_char(v_next, 'DD Mon YYYY') ||
      '. An availability filter only; final eligibility is always the ' ||
      'blood bank''s screening.',
    null,
    null,
    '/dashboard/donor'
  );
  return null;
end;
$$;

revoke all on function public.emit_eligibility_updated() from public, anon, authenticated;

drop trigger if exists donor_profiles_emit_eligibility on public.donor_profiles;
create trigger donor_profiles_emit_eligibility
  after update of last_donation_date on public.donor_profiles
  for each row
  when (
    old.last_donation_date is distinct from new.last_donation_date
  )
  execute function public.emit_eligibility_updated();

-- 8. donor_active_alerts() — recreated (drop first: the return type changed)
--    to add an APPROXIMATE whole-kilometre distance from the caller's OWN
--    rounded point to the hospital. Computed entirely inside this SECURITY
--    DEFINER function: the donor already knows their own location, and only
--    a rounded distance leaves the database — never either coordinate pair,
--    never another donor's data. Null when either side has no point (never a
--    guess). Every other field and gate is identical to the 0011 version.
drop function if exists public.donor_active_alerts(integer);

create or replace function public.donor_active_alerts(
  p_limit integer default 50
)
returns table (
  alert_id bigint,
  request_id uuid,
  ring_km integer,
  approx_distance_km double precision,
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
    -- Rounded to whole kilometres: the donor's own ~1 km point vs the
    -- hospital's approximate area point. Coordinates never leave this body.
    case
      when dp.latitude is null or dp.longitude is null
        or r.hospital_latitude is null or r.hospital_longitude is null
        then null
      else round(public.haversine_km(
             dp.latitude, dp.longitude,
             r.hospital_latitude, r.hospital_longitude))
    end,
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
  left join public.donor_profiles dp on dp.user_id = auth.uid()
  where a.donor_id = auth.uid()
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.donor_active_alerts(integer) from public, anon;
grant execute on function public.donor_active_alerts(integer) to authenticated;

comment on function public.donor_active_alerts(integer) is
  'The caller''s own alert queue: alert state (ring, approximate distance, due, response) plus the request fields needed to decide (group, component, units, hospital area, urgency, deadline, note, lifecycle). approx_distance_km is rounded to whole kilometres from the caller''s OWN rounded point — coordinates themselves are never returned, and no other donor''s data ever appears. Requester contact only inside the caller''s own accepted alert while contact_shared_until.';

-- 9. donor_donation_history() — the caller's OWN completed donations joined
--    to safe request fields (component, hospital area, lifecycle status).
--    SECURITY DEFINER because donors cannot join blood_requests under RLS
--    (requester/admin only) — the function re-checks the donor role and the
--    own-row filter inside the body. Request columns are null for records
--    not linked to a request. Never requester contact, never coordinates.
create or replace function public.donor_donation_history(
  p_limit integer default 50
)
returns table (
  donation_date date,
  units integer,
  blood_component text,
  hospital_name text,
  hospital_locality text,
  request_status text,
  request_id uuid
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
  select h.donated_on,
         h.units,
         r.blood_component,
         r.hospital_name,
         r.hospital_locality,
         r.status,
         h.request_id
    from public.donation_history h
    left join public.blood_requests r on r.id = h.request_id
   where h.donor_id = auth.uid()
   order by h.donated_on desc, h.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.donor_donation_history(integer) from public, anon;
grant execute on function public.donor_donation_history(integer) to authenticated;

comment on function public.donor_donation_history(integer) is
  'The caller''s OWN donation history: date, units, component, hospital area, and the related request''s lifecycle — for the donor dashboard. Donor-role checked and own-row filtered inside the SECURITY DEFINER body; request columns are null when unlinked. No requester contact, no coordinates, no medical data.';

-- 10. Scheduler for the one-shot expiring nudge — mirrors 0011's guarded
--     pg_cron install; where cron is missing, src/lib/ring-engine.ts ticks
--     it during authenticated traffic instead.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled (%)', sqlerrm;
  end;

  if to_regnamespace('cron') is not null then
    -- Replace any earlier copy so re-running the migration keeps ONE job.
    perform cron.unschedule(v.jobid)
      from cron.job v
     where v.jobname = 'raktsetu-alert-expiring';
    perform cron.schedule(
      'raktsetu-alert-expiring',
      '* * * * *',
      'select public.emit_alert_expiring()'
    );
  else
    raise notice 'cron schema missing; the expiring nudge relies on the application tick';
  end if;
exception when others then
  raise notice 'expiring scheduler not installed (%); src/lib/ring-engine.ts still ticks it', sqlerrm;
end $$;

-- End of migration 0012_donor_experience.sql.