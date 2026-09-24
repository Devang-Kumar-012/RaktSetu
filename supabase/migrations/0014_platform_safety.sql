-- ---------------------------------------------------------------------------
-- Migration 0014 — platform safety: abuse controls & report moderation
-- ---------------------------------------------------------------------------
-- Requires migrations 0001–0013. Idempotent — safe to re-run.
--
-- What this provides:
--   * FIXES a real defect in 0010. That migration revoked UPDATE from
--     `authenticated` on request_reports and never granted it back, so the
--     "Admins can review reports" policy could never fire: report moderation
--     was completely non-functional and every review attempt failed. The grant
--     is restored COLUMN-LIMITED to the two moderation columns, so a client can
--     never rewrite request_id, reporter_id, reason or created_at.
--   * Widens the report reason + status vocabularies to the controlled set the
--     moderation queue actually needs. Every legacy value stays VALID, so no
--     historical report is ever invalidated by this migration.
--   * platform_safety_limits — ONE admin-editable row holding every anti-abuse
--     limit, so no magic number is scattered across triggers.
--   * Rate limits enforced IN THE DATABASE, not only in the UI or the server
--     action, so they cannot be bypassed by calling PostgREST directly. They
--     are deliberately generous and skip non-user (service/migration) writes:
--     the goal is to stop mass spam, never to delay a genuine emergency.
--   * admin_platform_overview() gains under-review / resolved report counts and
--     a 24-hour report count for the admin overview.
--
-- Untouched: the request lifecycle (active -> fulfilled | cancelled | expired),
-- the ring engine, the matching algorithm, the acceptance model, and every
-- existing row. Reporting NEVER changes blood_requests.status — moderation
-- state lives only in request_reports.status, so a report can never cancel,
-- hide, or otherwise alter a requester's emergency.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. platform_safety_limits — one configurable row for every anti-abuse limit
-- ---------------------------------------------------------------------------
-- Centralised on purpose: adding a limit must never mean hunting for a number
-- buried in a trigger. Bounds are generous enough that no realistic emergency
-- is ever blocked, and an admin can widen any of them without a code change.
create table if not exists public.platform_safety_limits (
  id                                integer primary key default 1 check (id = 1),
  -- Concurrent live emergencies one requester may have open at once.
  max_active_requests_per_requester integer not null default 3
    check (max_active_requests_per_requester between 1 and 20),
  -- Gap between two creations by the same requester; stops double-submit and
  -- create/cancel/re-create spam without getting in the way of real use.
  min_request_interval_seconds      integer not null default 45
    check (min_request_interval_seconds between 0 and 3600),
  -- Rolling creations per hour, so the active cap cannot be side-stepped.
  max_requests_per_hour             integer not null default 10
    check (max_requests_per_hour between 1 and 100),
  -- Reports a single user may file per day across all requests.
  max_reports_per_day               integer not null default 10
    check (max_reports_per_day between 1 and 100),
  -- Alert responses per donor per minute. A real donor answers a handful;
  -- this only stops a runaway client loop from hammering the engine.
  max_alert_responses_per_minute    integer not null default 20
    check (max_alert_responses_per_minute between 1 and 120),
  updated_at                        timestamptz not null default now()
);

comment on table public.platform_safety_limits is
  'Single admin-managed row holding every platform-safety limit. These are abuse/coordination guards, not medical rules, and they are set high enough never to block a genuine emergency.';

insert into public.platform_safety_limits (id) values (1) on conflict (id) do nothing;

drop trigger if exists platform_safety_limits_touch on public.platform_safety_limits;
create trigger platform_safety_limits_touch
  before update on public.platform_safety_limits
  for each row execute function public.set_updated_at();

revoke all on table public.platform_safety_limits from anon;
revoke insert, delete on table public.platform_safety_limits from authenticated;
grant select on table public.platform_safety_limits to authenticated;
grant update (
  max_active_requests_per_requester,
  min_request_interval_seconds,
  max_requests_per_hour,
  max_reports_per_day,
  max_alert_responses_per_minute
) on table public.platform_safety_limits to authenticated;

alter table public.platform_safety_limits enable row level security;
alter table public.platform_safety_limits force row level security;

drop policy if exists "Anyone authenticated can read safety limits" on public.platform_safety_limits;
create policy "Anyone authenticated can read safety limits"
  on public.platform_safety_limits for select to authenticated
  using (true);

drop policy if exists "Admins can update safety limits" on public.platform_safety_limits;
create policy "Admins can update safety limits"
  on public.platform_safety_limits for update to authenticated

-- ---------------------------------------------------------------------------
-- 2. Report moderation actually works now (the 0010 grant defect)
-- ---------------------------------------------------------------------------
-- 0010 revoked UPDATE from `authenticated` and granted back only
--   select, insert (request_id, reporter_id, reason, details)
-- so although the "Admins can review reports" UPDATE policy existed, the table
-- privilege needed to reach it did not. Every review/dismiss attempt failed.
--
-- Restored COLUMN-LIMITED, so moderation can move a report between states and
-- nothing else. request_id / reporter_id / reason / details / created_at stay
-- immutable to every client, and the admin-only RLS policy still decides who
-- may use the grant at all. DELETE stays revoked: a report is a record.
revoke delete on table public.request_reports from authenticated;
grant update (status, reviewed_at) on table public.request_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Controlled reason + status vocabularies
-- ---------------------------------------------------------------------------
-- The new reasons are the set the moderation queue needs to distinguish
-- "wrong information" from "this is not a real need". Legacy values (spam,
-- harassment) are retained so historical reports stay valid and reviewable.
alter table public.request_reports
  drop constraint if exists request_reports_reason_check;
alter table public.request_reports
  add constraint request_reports_reason_check check (
    reason in (
      'fake',                  -- fake / suspicious request
      'incorrect_information', -- group, units, hospital or urgency is wrong
      'no_longer_needed',      -- the need was resolved, filled, or abandoned
      'abuse_misuse',          -- abuse, spam, or misuse of the platform
      'other',                 -- anything else, with the optional note
      'spam',                  -- legacy (0010) — still valid, no longer offered
      'harassment'             -- legacy (0010) — still valid, no longer offered
    )
  );

-- under_review separates "an admin has picked this up" from the two terminal
-- outcomes, so the admin queue can show open / under review / resolved.
alter table public.request_reports
  drop constraint if exists request_reports_status_check;
alter table public.request_reports
  add constraint request_reports_status_check check (
    status in ('open', 'under_review', 'reviewed', 'dismissed')
  );

comment on column public.request_reports.reason is
  'Controlled report reason. fake | incorrect_information | no_longer_needed | abuse_misuse | other, plus the legacy 0010 values spam | harassment which remain valid for historical rows.';
comment on column public.request_reports.status is
  'Moderation state ONLY — never confused with blood_requests.status. open -> under_review -> reviewed | dismissed. Reporting a request never alters the request itself.';

-- Keep reviewed_at honest even if a moderation update arrives without it, so
-- "under review" and the two terminal states always carry a real timestamp.
create or replace function public.sync_request_report_reviewed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'open' then
      new.reviewed_at := null;           -- reopened: no longer reviewed
    elsif new.reviewed_at is null then
      new.reviewed_at := now();          -- under_review / reviewed / dismissed
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists request_reports_sync_reviewed_at on public.request_reports;
create trigger request_reports_sync_reviewed_at
  before update on public.request_reports
  for each row execute function public.sync_request_report_reviewed_at();

  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());


-- ---------------------------------------------------------------------------
-- 4. Anti-abuse guards — enforced in the database, configurable, generous
-- ---------------------------------------------------------------------------
-- All three read the single platform_safety_limits row, so there is no magic
-- number anywhere. Two deliberate design rules:
--   * They only ever fire for an END USER (auth.uid() is not null). Service-role
--     writes, migrations, seeds and admin tooling are never rate limited.
--   * If the limits row is missing they FAIL OPEN (return the row unchanged).
--     An anti-abuse guard must never be the reason a real emergency is refused.
-- The error uses a dedicated SQLSTATE so the server action can tell a limit
-- apart from a genuine failure and explain it in plain language.
create or replace function public.guard_blood_request_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l        public.platform_safety_limits;
  v_active integer;
  v_recent integer;
  v_last   timestamptz;
begin
  if auth.uid() is null then
    return new;
  end if;

  select * into l from public.platform_safety_limits where id = 1;
  if not found then
    return new;
  end if;

  select count(*) into v_active
    from public.blood_requests
   where requester_id = new.requester_id
     and status = 'active';

  if v_active >= l.max_active_requests_per_requester then
    raise exception using
      errcode = 'RS001',
      message = 'RakSetu limit: you already have ' || v_active ||
                ' active blood request(s). Cancel one you no longer need first. '
                'If this is a genuine emergency, contact the blood bank directly.';
  end if;

  select max(created_at), count(*) into v_last, v_recent
    from public.blood_requests
   where requester_id = new.requester_id
     and created_at > now() - make_interval(hours => 1);

  if v_last is not null
     and l.min_request_interval_seconds > 0
     and v_last > now() - make_interval(secs => l.min_request_interval_seconds) then
    raise exception using
      errcode = 'RS001',
      message = 'RakSetu limit: please wait a moment before creating another request.';
  end if;

  if v_recent >= l.max_requests_per_hour then
    raise exception using
      errcode = 'RS001',
      message = 'RakSetu limit: too many requests were created in the last hour. '
                'If this is a genuine emergency, contact the blood bank directly.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_blood_request_creation() from public, anon, authenticated;

drop trigger if exists blood_requests_guard_creation on public.blood_requests;
create trigger blood_requests_guard_creation
  before insert on public.blood_requests
  for each row execute function public.guard_blood_request_creation();

create or replace function public.guard_request_report_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l        public.platform_safety_limits;
  v_recent integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  select * into l from public.platform_safety_limits where id = 1;
  if not found then
    return new;
  end if;

  select count(*) into v_recent
    from public.request_reports
   where reporter_id = new.reporter_id
     and created_at > now() - make_interval(hours => 24);

  if v_recent >= l.max_reports_per_day then
    raise exception using
      errcode = 'RS001',
      message = 'RakSetu limit: you have already filed several reports today. '
                'An administrator will review the ones you sent.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_request_report_creation() from public, anon, authenticated;

drop trigger if exists request_reports_guard_creation on public.request_reports;
create trigger request_reports_guard_creation
  before insert on public.request_reports
  for each row execute function public.guard_request_report_creation();

create or replace function public.guard_donor_alert_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l        public.platform_safety_limits;
  v_recent integer;
begin
  if new.response is not distinct from old.response then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  select * into l from public.platform_safety_limits where id = 1;
  if not found then
    return new;
  end if;

  select count(*) into v_recent
    from public.donor_alerts
   where donor_id = new.donor_id
     and responded_at is not null
     and responded_at > now() - make_interval(mins => 1);

  if v_recent >= l.max_alert_responses_per_minute then
    raise exception using
      errcode = 'RS001',
      message = 'RakSetu limit: too many alert responses at once. Please try again shortly.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_donor_alert_response() from public, anon, authenticated;

drop trigger if exists donor_alerts_guard_response on public.donor_alerts;
create trigger donor_alerts_guard_response
  before update of response on public.donor_alerts
  for each row execute function public.guard_donor_alert_response();

-- ---------------------------------------------------------------------------
-- 5. Admin visibility: open / under review / resolved reports
-- ---------------------------------------------------------------------------
-- Recreated (not edited) because a `returns table (...)` signature cannot be
-- changed in place with CREATE OR REPLACE. The check, the SECURITY DEFINER
-- admin guard, and the revoke/grant are all identical to 0010 — this only ADDS
-- four moderation figures to the existing overview. No other function is
-- redefined, and no grant is widened.
drop function if exists public.admin_platform_overview();

create or replace function public.admin_platform_overview()
returns table (
  total_users integer,
  total_donors integer,
  total_requesters integer,
  total_volunteers integer,
  total_admins integer,
  suspended_users integer,
  active_requests integer,
  fulfilled_requests integer,
  expired_requests integer,
  cancelled_requests integer,
  completed_donations integer,
  open_reports integer,
  under_review_reports integer,
  resolved_reports integer,
  reports_last_24h integer,
  active_alerts integer,
  accepted_alerts integer,
  available_donors integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  ) then
    return;
  end if;

  return query
  select
    (select count(*)::int from public.profiles),
    (select count(*)::int from public.profiles where role = 'donor'),
    (select count(*)::int from public.profiles where role = 'requester'),
    (select count(*)::int from public.profiles where role = 'volunteer'),
    (select count(*)::int from public.profiles where role = 'admin'),
    (select count(*)::int from public.profiles where status = 'suspended'),
    (select count(*)::int from public.blood_requests where status = 'active'),
    (select count(*)::int from public.blood_requests where status = 'fulfilled'),
    (select count(*)::int from public.blood_requests where status = 'expired'),
    (select count(*)::int from public.blood_requests where status = 'cancelled'),
    (select count(*)::int from public.donation_history),
    (select count(*)::int from public.request_reports where status = 'open'),
    (select count(*)::int from public.request_reports where status = 'under_review'),
    (select count(*)::int from public.request_reports
      where status in ('reviewed', 'dismissed')),
    (select count(*)::int from public.request_reports
      where created_at > now() - make_interval(hours => 24)),
    (select count(*)::int from public.donor_alerts
      where status in ('queued', 'sent', 'opened')),
    (select count(*)::int from public.donor_alerts where response = 'accepted'),
    (select count(*)::int from public.donor_profiles
      where availability = 'available'
        and public.donor_is_currently_eligible(last_donation_date));
end;
$$;

revoke all on function public.admin_platform_overview() from anon;
grant execute on function public.admin_platform_overview() to authenticated;

-- End of migration 0014_platform_safety.sql.

