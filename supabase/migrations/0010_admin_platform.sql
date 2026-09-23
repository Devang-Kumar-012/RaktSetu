-- RaktSetu migration 0010: admin & platform management.
-- Requires migrations 0001–0009. Idempotent — safe to re-run.
--
-- What this provides:
--   * platform_settings — a single admin-managed row holding the APPLICATION
--     coordination rules: emergency alert ring distances, the ring wait
--     window, the alert due-at offset, and the donation-interval days.
--     These are coordination filters, NOT medical eligibility decisions;
--     the database functions below read them so matching/alerts/cooldown
--     follow the configured values. Blood-bank screening stays authoritative.
--   * request_reports — minimal structure for users to report suspicious or
--     fake blood requests (one report per user per request). Admins review.
--   * donation_history — completed-donation records used for platform
--     administration and counts only. NOT a medical-records system: no
--     health data, just who donated for which request, when, and how many
--     units. Written only by admins via RLS.
--   * Admin account management: profiles.status may be updated only by an
--     active admin, never on their own row, and never the role/email/name.
--   * SECURITY DEFINER admin functions (overview + alert list) that verify
--     the caller is an active admin on every call.

-- ---------------------------------------------------------------------------
-- 1. platform_settings (singleton row id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  alert_rings_km integer[] not null default '{3,7,15}'
    check (array_length(alert_rings_km, 1) between 1 and 5),
  alert_window_minutes integer not null default 10
    check (alert_window_minutes between 1 and 240),
  alert_due_at_offset_minutes integer not null default 120
    check (alert_due_at_offset_minutes between 15 and 1440),
  donation_interval_days integer not null default 90
    check (donation_interval_days between 30 and 365),
  updated_at timestamptz not null default now()
);

comment on table public.platform_settings is
  'Application coordination settings (single row). Admin-managed. These are availability/coordination rules only — never medical eligibility decisions.';

insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

revoke all on table public.platform_settings from anon;
revoke insert, update, delete on table public.platform_settings from authenticated;
grant select on table public.platform_settings to authenticated;
grant update (alert_rings_km, alert_window_minutes, alert_due_at_offset_minutes, donation_interval_days)
  on table public.platform_settings to authenticated;

alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;

drop policy if exists "Anyone authenticated can read settings" on public.platform_settings;
create policy "Anyone authenticated can read settings"
  on public.platform_settings for select to authenticated
  using (true);

drop policy if exists "Admins can update settings" on public.platform_settings;
create policy "Admins can update settings"
  on public.platform_settings for update to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop trigger if exists platform_settings_set_updated_at on public.platform_settings;
create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Wire the coordination functions to the settings (fallback = old values)
-- ---------------------------------------------------------------------------
create or replace function public.alert_rings_km()
returns integer[] language sql stable as $$
  select coalesce(
    (select alert_rings_km from public.platform_settings where id = 1),
    array[3, 7, 15]
  );
$$;

create or replace function public.alert_window_minutes()
returns integer language sql stable as $$
  select coalesce(
    (select alert_window_minutes from public.platform_settings where id = 1),
    10
  );
$$;

create or replace function public.alert_due_at_offset_minutes()
returns integer language sql stable as $$
  select coalesce(
    (select alert_due_at_offset_minutes from public.platform_settings where id = 1),
    120
  );
$$;

-- The donation cooldown keeps its database home in donation_interval_days()
-- (0003) but now follows the admin-managed setting, falling back to 90.
-- ⚠️ Availability filter only — never a medical eligibility decision.
create or replace function public.donation_interval_days()
returns integer language sql stable as $$
  select coalesce(
    (select donation_interval_days from public.platform_settings where id = 1),
    90
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. request_reports — minimal abuse reporting for blood requests
-- ---------------------------------------------------------------------------
create table if not exists public.request_reports (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.blood_requests (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (reason in ('fake', 'spam', 'harassment', 'other')),
  details     text check (details is null or char_length(details) <= 500),
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint request_reports_unique unique (request_id, reporter_id)
);

create index if not exists request_reports_status_idx
  on public.request_reports (status, created_at desc);

revoke all on table public.request_reports from anon;
revoke update, delete on table public.request_reports from authenticated;
grant select, insert (request_id, reporter_id, reason, details)
  on table public.request_reports to authenticated;

alter table public.request_reports enable row level security;
alter table public.request_reports force row level security;

drop policy if exists "Users can insert own reports" on public.request_reports;
create policy "Users can insert own reports"
  on public.request_reports for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "Users can view own reports" on public.request_reports;
create policy "Users can view own reports"
  on public.request_reports for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists "Admins can view all reports" on public.request_reports;
create policy "Admins can view all reports"
  on public.request_reports for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists "Admins can review reports" on public.request_reports;
create policy "Admins can review reports"
  on public.request_reports for update to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop trigger if exists request_reports_set_updated_at on public.request_reports;
create trigger request_reports_set_updated_at
  before update on public.request_reports
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. donation_history — completed donations (administration data only)
-- ---------------------------------------------------------------------------
create table if not exists public.donation_history (
  id          uuid primary key default gen_random_uuid(),
  donor_id    uuid not null references public.profiles (id) on delete cascade,
  request_id  uuid references public.blood_requests (id) on delete set null,
  donated_on  date not null check (donated_on <= current_date),
  units       integer not null default 1 check (units between 1 and 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint donation_history_unique unique (donor_id, request_id, donated_on)
);

create index if not exists donation_history_donor_idx
  on public.donation_history (donor_id, donated_on desc);

revoke all on table public.donation_history from anon;
revoke insert, update, delete on table public.donation_history from authenticated;
grant select on table public.donation_history to authenticated;

alter table public.donation_history enable row level security;
alter table public.donation_history force row level security;

drop policy if exists "Donors can view own donation history" on public.donation_history;
create policy "Donors can view own donation history"
  on public.donation_history for select to authenticated
  using (auth.uid() = donor_id);

drop policy if exists "Admins can view donation history" on public.donation_history;
create policy "Admins can view donation history"
  on public.donation_history for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists "Admins can record donations" on public.donation_history;
create policy "Admins can record donations"
  on public.donation_history for insert to authenticated
  with check (public.is_current_user_admin());

drop trigger if exists donation_history_set_updated_at on public.donation_history;
create trigger donation_history_set_updated_at
  before update on public.donation_history
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Admin account management: status only, never on their own row
-- ---------------------------------------------------------------------------
grant update (status) on table public.profiles to authenticated;

drop policy if exists "Admins can update account status" on public.profiles;
create policy "Admins can update account status"
  on public.profiles for update to authenticated
  using (public.is_current_user_admin() and id <> auth.uid())
  with check (public.is_current_user_admin() and id <> auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Admin read functions (SECURITY DEFINER, admin-checked on every call)
-- ---------------------------------------------------------------------------
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

create or replace function public.admin_list_alerts(p_limit integer default 50)
returns table (
  alert_id bigint,
  request_id uuid,
  donor_id uuid,
  ring_km integer,
  status text,
  response text,
  due_at timestamptz,
  created_at timestamptz,
  responded_at timestamptz,
  accepted_at timestamptz,
  blood_group text,
  hospital_name text,
  hospital_locality text
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
    a.id,
    a.request_id,
    a.donor_id,
    a.ring_km,
    a.status,
    a.response,
    a.due_at,
    a.created_at,
    a.responded_at,
    a.accepted_at,
    r.blood_group,
    r.hospital_name,
    r.hospital_locality
  from public.donor_alerts a
  join public.blood_requests r on r.id = a.request_id
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_list_alerts(integer) from anon;
grant execute on function public.admin_list_alerts(integer) to authenticated;

comment on function public.admin_list_alerts is
  'Recent donor alerts for admins: ring radius, alert status, donor response, timestamps, and the request context. Exposes donor_id only — never donor names, phones, emails, or coordinates.';
