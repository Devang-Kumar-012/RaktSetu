-- ---------------------------------------------------------------------------
-- Migration 0016 — donor engagement, preferences & central platform settings
-- ---------------------------------------------------------------------------
-- Requires migrations 0001–0015. Idempotent — safe to re-run.
--
-- Adds three cooperating layers, reusing the existing ledgers rather than
-- duplicating them:
--
--   1. CENTRAL SETTINGS. platform_settings grows the operational values that
--      were previously hardcoded or scattered: a maximum ring count, cooldown
--      reminder lead time, donor-alert reminder timing, and the campus-drive
--      reminder window. Defaults reproduce today's behaviour EXACTLY, so
--      nothing changes unless an admin edits a value.
--
--   2. NOTIFICATION PREFERENCES. A per-user row of non-critical category
--      toggles. Critical emergency workflow notices (alerts, acceptances,
--      request lifecycle, account changes) are NOT suppressible — a donor
--      cannot opt out of the thing that saves a life. Suppression is enforced
--      by a BEFORE INSERT trigger, so it holds for every emitter.
--
--   3. DONOR RECOGNITION + REMINDERS. Recognition is COMPUTED from
--      donation_history — the authoritative ledger — and never stored, so it
--      cannot drift or be inflated. It deliberately ignores donor_alerts
--      entirely: being alerted, or answering "I can help", is NOT giving blood
--      and must never count towards recognition.
--
-- The emergency alert ring engine, matching, the acceptance model, the request
-- lifecycle, campus drives and the anti-abuse layer are all preserved. There is
-- still no 'accepted' request status. In-app notifications only.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. notifications gain a general dedupe key
-- ---------------------------------------------------------------------------
-- 0013 keyed events on (user, kind, request_id, alert_id) and 0015 added
-- drive_id. Recognition milestones have NO request, alert or drive: they are
-- about the donor's own lifetime count. Without a stable reference every
-- milestone would collapse onto the same (user, kind, NULL, NULL, NULL) key and
-- a donor would receive exactly ONE milestone notice for the whole product.
alter table public.notifications
  add column if not exists dedupe_key text
    check (dedupe_key is null or char_length(dedupe_key) between 1 and 80);

comment on column public.notifications.dedupe_key is
  'Stable server-chosen reference for events belonging to neither a request, an alert nor a drive (e.g. a recognition milestone or cooldown reminder). Part of the database event-once key.';

-- Rebuild the event-once index over the full key. The exception guard mirrors
-- 0013/0015 so historical duplicates can never make the migration fail; the
-- BEFORE INSERT guard still prevents all new duplicates.
drop index if exists public.notifications_event_once_uidx;
do $$
begin
  begin
    create unique index if not exists notifications_event_once_uidx
      on public.notifications (
        user_id,
        kind,
        coalesce(request_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(alert_id, 0),
        coalesce(drive_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(dedupe_key, '')
      )
      where kind not in (
        'eligibility_updated', 'admin_report_received', 'account_status_changed'
      );
  exception when unique_violation then
    raise notice 'historical duplicate notification rows found; the event-once index was skipped. New duplicates are still prevented by the BEFORE INSERT guard.';
  end;
end $$;

-- Recreate the guard so the advisory lock AND the existence test both include
-- dedupe_key. Without this, a second milestone would re-send the first.
create or replace function public.skip_duplicate_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_status text;
  v_event_key      text;
begin
  if new.kind = 'request_closed' and new.request_id is not null then
    select r.status into v_request_status
      from public.blood_requests r
     where r.id = new.request_id;
    if v_request_status in ('fulfilled', 'cancelled', 'expired') then
      new.kind := 'request_' || v_request_status;
    end if;
  end if;

  if new.kind in (
    'eligibility_updated', 'admin_report_received', 'account_status_changed'
  ) then
    return new;
  end if;

  v_event_key := concat_ws(
    '|', new.user_id::text, new.kind,
    coalesce(new.request_id::text, ''), coalesce(new.alert_id::text, ''),
    coalesce(new.drive_id::text, ''), coalesce(new.dedupe_key, '')
  );
  perform pg_advisory_xact_lock(hashtextextended(v_event_key, 0));

  if exists (
    select 1
      from public.notifications n
     where n.user_id = new.user_id
       and n.request_id is not distinct from new.request_id
       and n.alert_id is not distinct from new.alert_id
       and n.drive_id is not distinct from new.drive_id
       and n.dedupe_key is not distinct from new.dedupe_key
       and (
         n.kind = new.kind
         or (
           new.kind in ('request_fulfilled', 'request_cancelled', 'request_expired')
           and n.kind = 'request_closed'
         )
       )
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.skip_duplicate_notification() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. New notification kinds, and notify_user gains the dedupe reference
-- ---------------------------------------------------------------------------
-- Three advisory kinds, appended to the existing controlled set. None of them
-- is an emergency-workflow notice, so none can suppress one.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'alert_received', 'donor_accepted', 'request_closed', 'rings_exhausted',
    'alert_expiring', 'already_accepted',
    'request_fulfilled', 'request_cancelled', 'request_expired',
    'eligibility_updated', 'request_created',
    'assisted_request_accepted', 'assisted_request_fulfilled',
    'assisted_request_cancelled', 'assisted_request_expired',
    'volunteer_request_nearby', 'admin_report_received', 'acceptance_confirmed',
    'account_status_changed',
    'drive_registered', 'drive_upcoming_reminder', 'drive_updated',
    'drive_completed',
    'recognition_milestone', 'donor_cooldown_ending', 'donor_alert_pending'
  ));

-- notify_user gains a trailing p_dupe_key. As in 0015 this is a DROP AND
-- RECREATE, never an overload: leaving the 8-argument version in place would
-- make every existing 7- and 8-argument emitter call ambiguous at runtime and
-- break the ring engine and the drive notifications. The first eight
-- parameters keep their defaults, so every existing call site resolves
-- unchanged against the new nine-argument signature.
drop function if exists public.notify_user(uuid, text, text, text, uuid, bigint, text, uuid);

create or replace function public.notify_user(
  p_user_id    uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_request_id uuid   default null,
  p_alert_id   bigint default null,
  p_link       text   default null,
  p_drive_id   uuid   default null,
  p_dedupe_key text   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications
    (user_id, kind, title, body, request_id, alert_id, link, drive_id, dedupe_key)
  values
    (p_user_id, p_kind, p_title, p_body, p_request_id, p_alert_id, p_link,
     p_drive_id, p_dedupe_key);
end;
$$;

-- A freshly created function gets DEFAULT EXECUTE to PUBLIC, so the revoke
-- must be re-applied to the NEW signature or every client could call the
-- emitter helper directly.
revoke all on function public.notify_user(uuid, text, text, text, uuid, bigint, text, uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Central platform settings — the operational values
-- ---------------------------------------------------------------------------
-- Defaults deliberately reproduce current behaviour, so an untouched install
-- behaves exactly as it does today.
alter table public.platform_settings
  add column if not exists max_alert_rings integer not null default 5
    check (max_alert_rings between 1 and 5);
alter table public.platform_settings
  add column if not exists cooldown_reminder_lead_days integer not null default 3
    check (cooldown_reminder_lead_days between 1 and 30);
alter table public.platform_settings
  add column if not exists donor_alert_reminder_hours integer not null default 24
    check (donor_alert_reminder_hours between 1 and 168);
alter table public.platform_settings
  add column if not exists drive_reminder_window_hours integer not null default 48
    check (drive_reminder_window_hours between 1 and 168);

-- The ring list is clamped by max_alert_rings so "maximum ring count" is a
-- REAL setting rather than a label. The engine already reads this accessor once
-- per tick and derives its ring count with array_length, so a shorter list just
-- means fewer, wider steps and the existing exhaustion logic still terminates.
-- Defaults are unchanged: up to 5 rings, default 3 / 7 / 15 km.
create or replace function public.alert_rings_km()
returns integer[] language sql stable as $$
  select case
    when s.r is null or array_length(s.r, 1) is null then array[3, 7, 15]
    when s.m >= array_length(s.r, 1) then s.r
    when s.m < 1 then s.r[1:1]
    else s.r[1:s.m]
  end
  from (
    select
      coalesce(
        (select p.alert_rings_km from public.platform_settings p where p.id = 1),
        array[3, 7, 15]
      ) as r,
      coalesce(
        (select p.max_alert_rings from public.platform_settings p where p.id = 1),
        5
      ) as m
  ) s;
$$;

create or replace function public.max_alert_rings()
returns integer language sql stable as $$
  select coalesce((select p.max_alert_rings from public.platform_settings p where p.id = 1), 5);
$$;

create or replace function public.cooldown_reminder_lead_days()
returns integer language sql stable as $$
  select coalesce((select p.cooldown_reminder_lead_days from public.platform_settings p where p.id = 1), 3);
$$;

create or replace function public.donor_alert_reminder_hours()
returns integer language sql stable as $$
  select coalesce((select p.donor_alert_reminder_hours from public.platform_settings p where p.id = 1), 24);
$$;

create or replace function public.drive_reminder_window_hours()
returns integer language sql stable as $$
  select coalesce((select p.drive_reminder_window_hours from public.platform_settings p where p.id = 1), 48);
$$;

-- The new columns must be admin-writable through the same column-limited grant
-- the existing settings use; RLS still decides who may use it.
grant update (max_alert_rings, cooldown_reminder_lead_days,
              donor_alert_reminder_hours, drive_reminder_window_hours)
  on table public.platform_settings to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Notification preferences — non-critical categories only
-- ---------------------------------------------------------------------------
-- Deliberately NOT a blanket "mute everything" switch. Emergency workflow
-- notices (an alert, an acceptance, a request outcome, an account change) are
-- the product working; a donor must not be able to opt out of them. Only
-- advisory categories can be turned off, and each defaults to ON.
create table if not exists public.notification_preferences (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  -- Advisory: campus-drive news, cooldown/alert nudges, recognition milestones.
  drive_updates      boolean not null default true,
  donor_reminders    boolean not null default true,
  recognition_updates boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-user notification preferences for ADVISORY categories only. Emergency alert, acceptance, request-lifecycle and account notifications are never suppressible.';

insert into public.notification_preferences (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

revoke all on table public.notification_preferences from anon;
revoke insert, delete on table public.notification_preferences from authenticated;
grant select on table public.notification_preferences to authenticated;
grant update (drive_updates, donor_reminders, recognition_updates)
  on table public.notification_preferences to authenticated;

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

-- Own row only. A user can read and change their OWN preferences and nothing
-- else — there is deliberately no admin SELECT policy on this table, because
-- these are personal choices, not operational data.
drop policy if exists "Users can view own notification preferences" on public.notification_preferences;
create policy "Users can view own notification preferences"
  on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can update own notification preferences" on public.notification_preferences;
create policy "Users can update own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The one place the category -> preference mapping lives, so a new advisory
-- kind can never be silently unsuppressible by accident.
create or replace function public.notification_category(p_kind text)
returns text
language sql immutable
as $$
  select case
    when p_kind like 'drive\_%'            then 'drive_updates'
    when p_kind = 'recognition_milestone'  then 'recognition_updates'
    when p_kind in ('donor_cooldown_ending', 'donor_alert_pending')
      then 'donor_reminders'
    else null  -- null means NOT suppressible: emergency workflow notifications
  end;
$$;

revoke all on function public.notification_category(text) from public, anon, authenticated;

-- Enforced in the database, so EVERY emitter honours it — including the ones
-- that insert into notifications directly rather than through notify_user().
-- A NULL category (critical kinds) always passes through untouched.
create or replace function public.apply_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
begin
  v_category := public.notification_category(new.kind);
  if v_category is null then
    return new;
  end if;

  if exists (
    select 1
      from public.notification_preferences p
     where p.user_id = new.user_id
       and case v_category
             when 'drive_updates'       then p.drive_updates
             when 'recognition_updates' then p.recognition_updates
             when 'donor_reminders'     then p.donor_reminders
             else true
           end = false
  ) then
    return null;  -- user opted out of this advisory category
  end if;

  return new;
end;
$$;

revoke all on function public.apply_notification_preferences() from public, anon, authenticated;

drop trigger if exists notifications_apply_preferences on public.notifications;
create trigger notifications_apply_preferences
  before insert on public.notifications
  for each row execute function public.apply_notification_preferences();


-- ---------------------------------------------------------------------------
-- 4. Donation integrity — duplicates must not inflate recognition
-- ---------------------------------------------------------------------------
-- 0010's UNIQUE(donor_id, request_id, donated_on) cannot dedupe a drive
-- donation (request_id IS NULL never equals NULL), which 0015 closed per drive.
-- This closes the last gap that matters for recognition: the SAME donor
-- recording two donations on the SAME date — e.g. one against a request and one
-- at a drive — which would otherwise read as two completed donations.
-- Built inside the exception guard so pre-existing duplicates can never make
-- the migration fail; recognition is still correct without it.
do $$
begin
  begin
    create unique index if not exists donation_history_donor_day_uidx
      on public.donation_history (donor_id, donated_on);
  exception when unique_violation then
    raise notice 'duplicate same-day donation rows already exist; the donor/day index was skipped. Recognition counts recorded donations, which may over-count until they are reconciled.';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Donor recognition — COMPUTED, never stored
-- ---------------------------------------------------------------------------
-- Derived entirely from donation_history, the authoritative ledger. It does
-- NOT read donor_alerts at all: being alerted, or answering "I can help", is
-- not donating. A cancelled/expired request contributes nothing, because only
-- a row in donation_history (recorded by an admin after blood was collected)
-- counts.
--
-- Computed rather than stored on purpose: a stored counter can drift, be reset
-- by an account change, or be inflated by a bad insert. Reading the ledger
-- every time means recognition is correct by construction.
create or replace function public.donor_recognition()
returns table (
  total_donations integer,
  total_units     integer,
  first_donation  date,
  last_donation   date,
  next_milestone  integer,
  milestones      jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_next  integer;
begin
  -- Donor role only, and strictly the caller's own record. Any other caller
  -- (including an unauthenticated one) gets an empty result rather than an
  -- error, and never another donor's figures.
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'donor'
  ) then
    return;
  end if;

  select count(*)::int into v_total
    from public.donation_history h
   where h.donor_id = auth.uid();

  -- Milestones are a fixed, transparent ladder. 1 is "first donation".
  select m into v_next
    from unnest(array[1, 3, 5, 10, 25, 50]) as m
   where m > v_total
   order by m asc
   limit 1;

  return query
  select
    v_total,
    coalesce((select sum(h.units)::int from public.donation_history h
               where h.donor_id = auth.uid()), 0),
    (select min(h.donated_on) from public.donation_history h
      where h.donor_id = auth.uid()),
    (select max(h.donated_on) from public.donation_history h
      where h.donor_id = auth.uid()),
    v_next,
    (
      select jsonb_agg(
        jsonb_build_object(
          'count',   m,
          'reached', v_total >= m
        ) order by m
      )
      from unnest(array[1, 3, 5, 10, 25, 50]) as m
    );
end;
$$;

revoke all on function public.donor_recognition() from public, anon;
grant execute on function public.donor_recognition() to authenticated;

comment on function public.donor_recognition() is
  'The caller''s OWN recognition, computed from donation_history only. Never derived from alerts, acceptances, requests or any medical judgement. Returns total donations/units, first and last dates, the next milestone and the full milestone ladder with reached flags. No contact, location or profile data is returned.';


-- ---------------------------------------------------------------------------
-- 6. Recognition milestone notice
-- ---------------------------------------------------------------------------
-- One notice when a recorded donation crosses a milestone. Fired from the
-- EXISTING donation ledger insert, so it can only happen when an admin records
-- a real donation. The dedupe_key is the milestone itself, which is what lets a
-- donor receive several milestone notices over time instead of exactly one.
create or replace function public.emit_recognition_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_next  integer;
begin
  select count(*)::int into v_total
    from public.donation_history h
   where h.donor_id = new.donor_id;

  select m into v_next
    from unnest(array[1, 3, 5, 10, 25, 50]) as m
   where m <= v_total
   order by m desc
   limit 1;

  if v_next is null then
    return null;
  end if;

  perform public.notify_user(
    new.donor_id,
    'recognition_milestone',
    case when v_next = 1
      then 'Your first donation is recorded'
      else v_next || ' donations recorded — thank you'
    end,
    case when v_next = 1
      then 'Your first completed donation is now on your record. Thank you.'
      else 'You have ' || v_total || ' completed donations on record. Thank you '
           || 'for every one of them. This recognition counts recorded donations '
           || 'only — medical eligibility is always decided by the blood bank.'
    end,
    null,
    null,
    '/dashboard/donor',
    null,
    'milestone-' || v_next::text
  );
  return null;
end;
$$;

revoke all on function public.emit_recognition_milestone() from public, anon, authenticated;

drop trigger if exists donation_history_emit_milestone on public.donation_history;
create trigger donation_history_emit_milestone
  after insert on public.donation_history
  for each row execute function public.emit_recognition_milestone();


-- ---------------------------------------------------------------------------
-- 7. Donor reminders — cooldown and unanswered alerts
-- ---------------------------------------------------------------------------
-- Both are ADVISORY and both say plainly what they are: an application-level
-- tracking convenience, not medical advice and not a judgement about whether
-- anyone may donate. Neither ever references a closed request, and both are
-- one-shot so they cannot storm.
--
-- The guard columns are added FIRST because the sweep below reads them.
alter table public.donor_profiles
  add column if not exists cooldown_reminder_sent_for date;
alter table public.donor_alerts
  add column if not exists pending_reminder_sent_at timestamptz;

create index if not exists donor_alerts_pending_reminder_idx
  on public.donor_alerts (created_at)
  where pending_reminder_sent_at is null and response is null;

create or replace function public.emit_donor_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d      record;
  v_sent integer := 0;
  v_days integer;
  v_hours integer;
begin
  v_days  := greatest(coalesce(public.cooldown_reminder_lead_days(), 3), 1);
  v_hours := greatest(coalesce(public.donor_alert_reminder_hours(), 24), 1);

  -- (a) The application-level donation interval is nearly over. Guarded by the
  -- last donation the reminder was sent FOR, so it fires at most once per
  -- donation no matter how often the sweep runs.
  for d in
    select dp.user_id, dp.last_donation_date
      from public.donor_profiles dp
     where dp.last_donation_date is not null
       and dp.cooldown_reminder_sent_for is distinct from dp.last_donation_date
       and dp.last_donation_date
             + make_interval(days => public.donation_interval_days())
             - make_interval(days => v_days)
           <= current_date
       and dp.last_donation_date
             + make_interval(days => public.donation_interval_days())
           > current_date
  loop
    perform public.notify_user(
      d.user_id,
      'donor_cooldown_ending',
      'Your donation interval is nearly over',
      'RaktSetu keeps a simple application-level interval between donations so '
      'donors are not matched too often. It is a tracking convenience only, not '
      'medical advice: the blood bank always decides who may give, and when. You '
      'can pause your availability at any time.',
      null,
      null,
      '/dashboard/donor',
      null,
      'cooldown-' || d.last_donation_date::text
    );
    update public.donor_profiles
       set cooldown_reminder_sent_for = last_donation_date
     where user_id = d.user_id;
    v_sent := v_sent + 1;
  end loop;

  -- (b) An emergency alert the donor has not answered. Guarded per alert and
  -- limited to alerts that are still open and still inside their response
  -- window, so a closed or expired request can never be referenced.
  for d in
    select a.id, a.donor_id
      from public.donor_alerts a
     where a.response is null
       and a.status in ('sent', 'opened')
       and a.pending_reminder_sent_at is null
       and a.due_at > now()
       and a.created_at <= now() - make_interval(hours => v_hours)
     order by a.created_at asc
     limit 200
     for update of a skip locked
  loop
    perform public.notify_user(
      d.donor_id,
      'donor_alert_pending',
      'You have an emergency alert you have not answered',
      'A blood request you were alerted about is still waiting for a response. '
      'Open your dashboard to accept or decline. If you no longer wish to be '
      'alerted, pause your availability — no explanation is needed.',
      null,
      d.id,
      '/dashboard/donor',
      null,
      'alert-pending'
    );
    update public.donor_alerts
       set pending_reminder_sent_at = now()
     where id = d.id;
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.emit_donor_reminders() from public, anon, authenticated;
-- Granted so the application tick can call it, mirroring 0015's drive reminder
-- grant. Without this, reminders would depend entirely on pg_cron.
grant execute on function public.emit_donor_reminders() to authenticated;

-- Same guarded pg_cron pattern as 0011/0012/0015: one job, no new worker.
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
     where v.jobname = 'raktsetu-donor-reminders';
    perform cron.schedule(
      'raktsetu-donor-reminders',
      '40 * * * *',
      'select public.emit_donor_reminders()'
    );
  else
    raise notice 'cron schema missing; donor reminders rely on the application tick';
  end if;
exception when others then
  raise notice 'donor reminder scheduler not installed (%)', sqlerrm;
end $$;

-- End of migration 0016_engagement_preferences_settings.sql.

