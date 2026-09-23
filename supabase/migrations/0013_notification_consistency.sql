-- ---------------------------------------------------------------------------
-- Migration 0013 — notification centre & event consistency (PROMPT 23)
-- ---------------------------------------------------------------------------
-- Completes the in-app notification system on top of the 0011 notification
-- table / emitters and the 0012 donor-experience emitters.
--
-- The authoritative request lifecycle (active → fulfilled | expired |
-- cancelled; terminal states final), the ring engine, and the atomic
-- first-acceptance-wins model are UNCHANGED. No matching rule is touched.
--
-- Adds:
--   1. Seven new notification kinds — ONE stable kind per logical event, so a
--      "does this already exist" question always has a single, indexable
--      answer: request_created, assisted_request_accepted,
--      assisted_request_fulfilled, assisted_request_cancelled,
--      assisted_request_expired, volunteer_request_nearby,
--      admin_report_received.
--   2. Duplicate prevention as a DATABASE invariant (not a UI trick):
--      a partial UNIQUE index on the stable event key
--      (recipient, kind, request_id, alert_id) plus a BEFORE INSERT guard
--      trigger that silently skips an already-delivered event. Every insert
--      path is covered — including the 0011 ring-engine closure sweep, which
--      is deliberately NOT redefined here. `eligibility_updated` and
--      `admin_report_received` are intentionally repeatable and excluded.
--   3. emit_request_created() — the requester's "your request is live"
--      confirmation, plus a locality-scoped "relevant emergency request"
--      notice for on-duty volunteers. Neither leaks requester contact data.
--   4. emit_request_closeout() recreated — the donor behaviour is byte-for-
--      byte 0012's, and the same ONE active→terminal transition now also
--      tells the requester (kind request_<status>, link /requests/<id>) and
--      every volunteer still assisting it (kind assisted_request_<status>).
--   5. emit_assisted_request_accepted() — volunteers assisting a request hear
--      that a donor accepted it (coordination progress, no contact details).
--   6. emit_admin_report_received() — the ONE operational event the existing
--      admin functionality requires: a new abuse report waiting in
--      /admin/reports. The reporter's optional free-text details are NEVER
--      copied into a notification (they may contain personal information).
--   7. prune_read_notifications() — conservative retention. Deletes ONLY rows
--      that are already READ and older than a clamped retention window, in
--      bounded batches. Unread rows are never deleted. Driven by the SAME
--      guarded pg_cron install used by 0011/0012 (one daily job); where
--      pg_cron is unavailable nothing is deleted at all, and an admin can
--      call the function directly.
--
-- Notifications stay emitters-only: clients still have no INSERT/UPDATE/DELETE
-- grant on the table, and every emitter is SECURITY DEFINER with a pinned
-- search_path. Read state remains a per-row, per-recipient `read_at`.
--
-- Run order: after 0012. Idempotent (drop-if-exists / create or replace).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One stable kind per logical event
-- ---------------------------------------------------------------------------
-- 0012 created the auto-named column check notifications_kind_check; widen it.
alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'alert_received', 'donor_accepted', 'request_closed', 'rings_exhausted',
    'alert_expiring', 'already_accepted',
    'request_fulfilled', 'request_cancelled', 'request_expired',
    'eligibility_updated',
    -- 0013: requester lifecycle + volunteer coordination + admin operations
    'request_created',
    'assisted_request_accepted', 'assisted_request_fulfilled',
    'assisted_request_cancelled', 'assisted_request_expired',
    'volunteer_request_nearby',
    'admin_report_received'
  ));

comment on column public.notifications.kind is
  'One kind per logical event (see the check constraint). Kinds tied to a request/alert form a stable event key with user_id, request_id and alert_id — the partial unique index below enforces "the same event is delivered to the same recipient at most once". Only eligibility_updated and admin_report_received are intentionally repeatable.';

-- ---------------------------------------------------------------------------
-- 2. Duplicate prevention at the database (retry / scheduler / refresh safe)
-- ---------------------------------------------------------------------------
-- A retried server action, a scheduler run twice, a page refresh, or an
-- alert/ring that transitions more than once can all reach the same emitter
-- again. The event key below is stable across retries: the recipient, the
-- event kind, and the referenced request/alert. NULLs are folded to sentinels
-- so the key behaves identically for events without an alert.
create unique index if not exists notifications_event_once_uidx
  on public.notifications (
    user_id,
    kind,
    coalesce(request_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(alert_id, 0)
  )
  where kind not in ('eligibility_updated', 'admin_report_received');

-- The guard trigger is what makes the guarantee hold for EVERY insert path —
-- including emitters that write to public.notifications directly instead of
-- going through notify_user() (0011's ring-engine closure sweep, 0012's
-- expiring nudge). Returning NULL from a BEFORE INSERT trigger skips the row
-- without raising, so a duplicate can never poison a ring-engine transaction.
create or replace function public.skip_duplicate_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally repeatable kinds: a new donation date, and one notice per
  -- report row (request_reports is unique per request+reporter, so a retried
  -- report insert cannot fan out twice).
  if new.kind in ('eligibility_updated', 'admin_report_received') then
    return new;
  end if;

  if exists (
    select 1
      from public.notifications n
     where n.user_id = new.user_id
       and n.kind = new.kind
       and n.request_id is not distinct from new.request_id
       and n.alert_id is not distinct from new.alert_id
  ) then
    -- The same logical event was already delivered to this recipient.
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.skip_duplicate_notification() from public, anon, authenticated;

drop trigger if exists notifications_skip_duplicate on public.notifications;
create trigger notifications_skip_duplicate
  before insert on public.notifications
  for each row execute function public.skip_duplicate_notification();

-- Unread counts are read on every authenticated page (shell badge) and are
-- always answered from the database, never from the rendered list.
-- ---------------------------------------------------------------------------
-- 3. emit_request_created() — requester confirmation + nearby volunteers
-- ---------------------------------------------------------------------------
-- Fires once per request row (INSERT). It sends:
--   * the requester their "live" confirmation (kind request_created,
--     destination /requests/<id>), and
--   * on-duty volunteers whose OWN locality matches the hospital locality
--     (kind volunteer_request_nearby, destination /volunteer/requests/<id>).
-- Only facts volunteers already see on their dashboard are included: blood
-- group, component, units, hospital name + area, urgency, deadline. Never the
-- requester's name, phone, e-mail, or coordinates.
create or replace function public.emit_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ring      integer;
  v_volunteer uuid;
begin
  if new.status <> 'active' then
    return null; -- only a live emergency is announced
  end if;

  v_ring := coalesce((public.alert_rings_km())[1], 3);

  perform public.notify_user(
    new.requester_id,
    'request_created',
    'Your blood request is live',
    new.blood_group || ' (' || replace(new.blood_component, '_', ' ') || ', ' ||
      case when new.units = 1 then '1 unit' else new.units || ' units' end ||
      ') at ' || new.hospital_name || ', ' || new.hospital_locality ||
      '. Donors near the hospital are alerted in widening rings from ' ||
      v_ring || ' km; you will hear here the moment a donor accepts.',
    new.id,
    null,
    '/requests/' || new.id::text
  );

  for v_volunteer in
    select p.id
      from public.profiles p
      join public.volunteer_profiles vp on vp.user_id = p.id
     where p.role = 'volunteer'
       and p.status = 'active'
       and vp.availability = 'available'
       and vp.locality is not null
       and lower(btrim(vp.locality)) = lower(btrim(new.hospital_locality))
     order by p.id
     limit 100
  loop
    perform public.notify_user(
      v_volunteer,
      'volunteer_request_nearby',
      'New ' || initcap(new.urgency) || ' blood request in ' ||
        new.hospital_locality,
      new.blood_group || ' (' || replace(new.blood_component, '_', ' ') || ', ' ||
        case when new.units = 1 then '1 unit' else new.units || ' units' end ||
        ') at ' || new.hospital_name || ', needed by ' ||
        to_char(new.required_by at time zone 'Asia/Kolkata', 'DD Mon, HH24:MI') ||
        ' IST. Open the request to assist with coordination.',
      new.id,
      null,
      '/volunteer/requests/' || new.id::text
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.emit_request_created() from public, anon, authenticated;

drop trigger if exists blood_requests_emit_created on public.blood_requests;
create trigger blood_requests_emit_created
  after insert on public.blood_requests
  for each row execute function public.emit_request_created();

-- ---------------------------------------------------------------------------
-- 4. emit_request_closeout() — recreated: donors (unchanged) + requester +
--    assisting volunteers, all from the ONE active→terminal transition
-- ---------------------------------------------------------------------------
-- The donor behaviour is identical to 0012: the winning donor gets the
-- specific outcome, then every still-open alert is retired and told with the
-- same specific kind. The claimed-trigger skips the rows flipped here (the
-- request is no longer active), so each donor hears exactly once. The engine
-- closure sweep remains the safety net and finds no open alerts left.
--
-- New in 0013: the requester gets a durable record of the closure (kind
-- request_<status>, destination /requests/<id> — this is also how a deadline
-- expiry or an admin-side closure reaches them), and every volunteer still
-- assisting the request is told (kind assisted_request_<status>, destination
-- /volunteer/requests/<id>). No contact data of any kind appears in either.
create or replace function public.emit_request_closeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind      text;
  v_label     text;
  v_donor     uuid;
  v_alert     bigint;
  v_volunteer uuid;
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

  -- 1b. The requester gets ONE notice per closure — the record of the state
  --     change, whether they closed it themselves or the deadline/admin did.
  perform public.notify_user(
    new.requester_id,
    v_kind,
    'Your request was ' || v_label,
    case when new.status = 'fulfilled'
      then 'Your ' || new.blood_group || ' request at ' || new.hospital_name ||
           ' is closed as fulfilled. Alerts have stopped; an accepted donor ' ||
           'keeps the contact you shared until their response window ends.'
      when new.status = 'cancelled'
      then 'Your ' || new.blood_group || ' request at ' || new.hospital_name ||
           ' was cancelled. No further alerts are sent. If blood is still ' ||
           'needed, create a new request so donors near the hospital are ' ||
           'alerted again.'
      else 'Your ' || new.blood_group || ' request at ' || new.hospital_name ||
           ' expired at its required-by time without an acceptance. If the ' ||
           'need remains, create a new request with a fresh deadline.'
    end,
    new.id,
    null,
    '/requests/' || new.id::text
  );

  -- 1c. Volunteers still assisting it hear the same outcome.
  for v_volunteer in
    select ra.volunteer_id
      from public.request_assistance ra
     where ra.request_id = new.id
       and ra.status = 'assisting'
     order by ra.volunteer_id
  loop
    perform public.notify_user(
      v_volunteer,
      'assisted_request_' || new.status,
      'Assisted request was ' || v_label,
      'The ' || new.blood_group || ' request at ' || new.hospital_name || ', ' ||
        new.hospital_locality || ' that you are assisting was ' || v_label ||
        '. No further coordination is needed for it.',
      new.id,
      null,
      '/volunteer/requests/' || new.id::text
    );
  end loop;

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

-- ---------------------------------------------------------------------------
-- 5. emit_assisted_request_accepted() — coordination progress for volunteers
-- ---------------------------------------------------------------------------
-- Fires when an alert row records an acceptance (mark_alert_responded, 0011 —
-- untouched). Every volunteer still assisting that request hears that the
-- request now has a donor. Contact details stay strictly between the
-- requester and the accepted donor, so none are copied here.
create or replace function public.emit_assisted_request_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r            public.blood_requests%rowtype;
  v_volunteer  uuid;
begin
  if new.response is distinct from 'accepted' then
    return null;
  end if;

  select * into r from public.blood_requests where id = new.request_id;
  if not found then
    return null;
  end if;

  for v_volunteer in
    select ra.volunteer_id
      from public.request_assistance ra
     where ra.request_id = new.request_id
       and ra.status = 'assisting'
     order by ra.volunteer_id
  loop
    perform public.notify_user(
      v_volunteer,
      'assisted_request_accepted',
      'A donor accepted the request you are assisting',
      'The ' || r.blood_group || ' request at ' || r.hospital_name || ', ' ||
        r.hospital_locality || ' now has a donor. Coordinate the remaining ' ||
        'steps; contact details stay between the requester and that donor.',
      new.request_id,
      null,
      '/volunteer/requests/' || new.request_id::text
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.emit_assisted_request_accepted() from public, anon, authenticated;

drop trigger if exists donor_alerts_emit_assisted_accepted on public.donor_alerts;
create trigger donor_alerts_emit_assisted_accepted
  after update of response on public.donor_alerts
  for each row
  when (old.response is null and new.response = 'accepted')
  execute function public.emit_assisted_request_accepted();

-- ---------------------------------------------------------------------------
-- 6. emit_admin_report_received() — the one event admin ops actually needs
-- ---------------------------------------------------------------------------
-- The admin console is pull-based (all requests, alert/ring monitor, donations,
-- settings). The single event that genuinely waits on an admin is a new abuse
-- report: /admin/reports is the queue that must be worked. One notification per
-- active admin per report row. The reporter's free-text `details` is NEVER
-- copied into the notification text.
create or replace function public.emit_admin_report_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.blood_requests%rowtype;
  v_admin uuid;
begin
  select * into r from public.blood_requests where id = new.request_id;
  if not found then
    return null;
  end if;

  for v_admin in
    select p.id
      from public.profiles p
     where p.role = 'admin'
       and p.status = 'active'
     order by p.id
  loop
    perform public.notify_user(
      v_admin,
      'admin_report_received',
      'A request was reported for review',
      'Reason: ' || replace(new.reason, '_', ' ') || '. Request: ' ||
        r.blood_group || ' at ' || r.hospital_name || ', ' ||
        r.hospital_locality || ' (' || r.status || '). Open the reports queue ' ||
        'to review it — the reporter note stays in the queue, never here.',
      new.request_id,
      null,
      '/admin/reports'
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.emit_admin_report_received() from public, anon, authenticated;

drop trigger if exists request_reports_emit_admin on public.request_reports;
create trigger request_reports_emit_admin
  after insert on public.request_reports
  for each row execute function public.emit_admin_report_received();

-- ---------------------------------------------------------------------------
-- 7. Conservative retention — read notifications only, bounded, never unread
-- ---------------------------------------------------------------------------
-- Notifications accumulate forever otherwise (small rows, but unbounded). The
-- rule here is deliberately timid: delete ONLY rows the recipient has already
-- read and that are older than the retention window, at most p_max_rows at a
-- time. Unread rows, and every request/alert-linked row younger than the
-- window, are never touched — so nothing operationally important can vanish
-- before it has been seen. Callable by an active admin (RPC) or by the engine/
-- service context (pg_cron runs without a session uid).
create or replace function public.prune_read_notifications(
  p_retain_days integer default 90,
  p_max_rows    integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days    integer;
  v_limit   integer;
  v_deleted integer := 0;
begin
  if auth.uid() is not null and not public.is_current_user_admin() then
    return 0;
  end if;

  -- Clamped: a mis-typed call can never wipe recent history.
  v_days  := least(greatest(coalesce(p_retain_days, 90), 30), 3650);
  v_limit := least(greatest(coalesce(p_max_rows, 500), 1), 5000);

  with doomed as (
    select n.id
      from public.notifications n
     where n.read_at is not null
       and n.created_at < now() - make_interval(days => v_days)
     order by n.created_at asc
     limit v_limit
  )
  delete from public.notifications n
   using doomed d
   where n.id = d.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_read_notifications(integer, integer) from public, anon;
grant execute on function public.prune_read_notifications(integer, integer) to authenticated;

comment on function public.prune_read_notifications(integer, integer) is
  'Conservative notification retention: deletes only READ rows older than the (clamped, min 30 day) retention window, at most p_max_rows per call. Unread rows are never deleted. Admin- or engine-context only.';

-- One daily job, using the SAME guarded pg_cron install as 0011/0012 — no new
-- worker, no new service. Where pg_cron is unavailable nothing is pruned at
-- all (the safe default) and an admin can call the function directly.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled (%)', sqlerrm;
  end;

  if to_regnamespace('cron') is not null then
    perform cron.unschedule(v.jobid)
      from cron.job v
     where v.jobname = 'raktsetu-notifications-prune';
    perform cron.schedule(
      'raktsetu-notifications-prune',
      '30 3 * * *',
      'select public.prune_read_notifications(90, 500)'
    );
  else
    raise notice 'cron schema missing; notification retention is admin-triggered only';
  end if;
exception when others then
  raise notice 'notification retention scheduler not installed (%)', sqlerrm;
end $$;

-- End of migration 0013_notification_consistency.sql.




