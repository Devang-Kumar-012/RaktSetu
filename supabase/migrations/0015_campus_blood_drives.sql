-- ---------------------------------------------------------------------------
-- Migration 0015 — Campus Blood Drive Mode
-- ---------------------------------------------------------------------------
-- Requires migrations 0001–0014. Idempotent — safe to re-run.
--
-- A campus blood drive is a SEPARATE, PLANNED workflow from an emergency blood
-- request. Nothing here touches the emergency path: the request lifecycle
-- (active -> fulfilled | cancelled | expired), the ring engine, the matching
-- algorithm and the first-acceptance-wins model are all UNCHANGED, and there
-- is still no 'accepted' request status. A drive has its own status vocabulary
-- (upcoming | ongoing | completed | cancelled) on its OWN table and never
-- feeds blood_requests.
--
-- What this adds:
--   * campus_blood_drives — an admin-managed, publishable drive with schedule,
--     venue and locality.
--   * campus_drive_registrations — a donor's interest in ONE drive, unique per
--     (drive, donor) at the database level, carrying check-in/participation
--     state.
--   * donation_history gains a nullable drive_id + blood_component, so a drive
--     donation is recorded in the EXISTING donation ledger. That reuse is what
--     makes the existing 0012 sync_donor_profile_from_donation() trigger start
--     the donor's cooldown automatically — there is no second eligibility
--     system, and no second cooldown.
--   * notifications gain a nullable drive_id, four drive kinds, and a drive-
--     aware duplicate key, so a donor gets at most ONE of each drive event
--     per drive rather than one ever.
--   * In-app only. No SMS, e-mail, WhatsApp, Telegram or any external provider.
--
-- Privacy: a drive page is aggregate-only for other donors. Registrations are
-- own-row for donors; the roster is readable by admins and by volunteers (who
-- need it to check people in) and exposes a uuid + state only. Donor phone and
-- location stay in donor_profiles behind own-row RLS and are never joined in.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. campus_blood_drives
-- ---------------------------------------------------------------------------
create table if not exists public.campus_blood_drives (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 120),
  organizer    text not null check (char_length(organizer) between 1 and 160),
  drive_date   date not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  venue        text not null check (char_length(venue) between 1 and 160),
  locality     text not null check (char_length(locality) between 1 and 120),
  description  text check (description is null or char_length(description) <= 1000),
  -- Target is expressed in UNITS collected, the same unit emergency requests
  -- use, so the two never have to be translated. Null means "no target set".
  target_units integer check (target_units is null or target_units between 1 and 5000),
  status       text not null default 'upcoming'
                 check (status in ('upcoming', 'ongoing', 'completed', 'cancelled')),
  published    boolean not null default false,
  -- One-shot guard for the upcoming reminder, so a re-run of the sweep (or a
  -- second scheduler) can never re-notify the same drive.
  reminder_sent_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A drive that ends before it starts is a data error, not a configuration.
  constraint campus_blood_drives_time_check check (ends_at > starts_at),
  -- The schedule and the headline date must agree; the date is what lists and
  -- aggregate views group by, so it is derived from, not free-form next to,
  -- starts_at. Kept as a CHECK so a bad write can never land.
  constraint campus_blood_drives_date_check
    check (drive_date = (starts_at at time zone 'Asia/Kolkata')::date)
);

comment on table public.campus_blood_drives is
  'Admin-managed, publishable campus/planned blood drives. Separate from emergency blood requests: drives never create or alter blood_requests, and their status is independent of any request lifecycle.';

create index if not exists campus_blood_drives_listing_idx
  on public.campus_blood_drives (published, status, drive_date);
create index if not exists campus_blood_drives_reminder_idx
  on public.campus_blood_drives (starts_at)
  where reminder_sent_at is null and published and status = 'upcoming';

drop trigger if exists campus_blood_drives_touch on public.campus_blood_drives;
create trigger campus_blood_drives_touch
  before update on public.campus_blood_drives
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. campus_drive_registrations
-- ---------------------------------------------------------------------------
-- Minimum viable data: WHO registered for WHICH drive, and the operational
-- state (registered -> checked_in -> participated). No phone, no location, no
-- medical detail — those live in donor_profiles behind their own RLS and are
-- never joined into a drive surface.
create table if not exists public.campus_drive_registrations (
  id            uuid primary key default gen_random_uuid(),
  drive_id      uuid not null references public.campus_blood_drives (id) on delete cascade,
  donor_id      uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'registered'
                  check (status in ('registered', 'checked_in', 'participated', 'cancelled')),
  -- A donor may note a practical reason for not attending (travel, exams).
  -- Short, factual, and visible only to the drive's admins/volunteers.
  note          text check (note is null or char_length(note) <= 200),
  registered_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Duplicate registration is impossible, not merely discouraged: a second
  -- INSERT for the same (drive, donor) raises a unique violation, which the
  -- server action reports as a clear "already registered" message.
  constraint campus_drive_registrations_unique unique (drive_id, donor_id)
);

create index if not exists campus_drive_registrations_drive_idx
  on public.campus_drive_registrations (drive_id, status);
create index if not campus_drive_registrations_donor_idx
  on public.campus_drive_registrations (donor_id, registered_at desc);

drop trigger if exists campus_drive_registrations_touch on public.campus_drive_registrations;
create trigger campus_drive_registrations_touch
  before update on public.campus_drive_registrations
  for each row execute function public.set_updated_at();

-- Only forward moves are legal, and a settled row is final. This is what makes
-- the permissive volunteer UPDATE grant safe: a volunteer can advance someone
-- from registered to checked_in, but can never rewrite history or invent a
-- 'participated' record for someone who never attended.
create or replace function public.enforce_drive_registration_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The system itself settles a roster when a drive completes or is cancelled
  -- (settle_drive_registrations_on_completion / emit_drive_updated). Those two
  -- paths must run AFTER the drive row has already moved to its terminal
  -- status, so without this flag the "drive already closed" check below would
  -- reject them and completing or cancelling a drive would be impossible.
  -- The flag is transaction-local, set only by those SECURITY DEFINER helpers,
  -- and never by a client, so a user can still not edit a closed drive's roster.
  if current_setting('raktsetu.drive_settle', true) = '1' then
    return new;
  end if;

  if new.status = old.status then
    return new;  -- note/other field edit only
  end if;

  if old.status in ('participated', 'cancelled') then
    raise exception using
      errcode = 'RS002',
      message = 'This registration is already settled and cannot change again.';
  end if;

  if not (
    (old.status = 'registered'  and new.status in ('checked_in', 'cancelled')) or
    (old.status = 'checked_in'  and new.status in ('participated', 'cancelled'))
  ) then
    raise exception using
      errcode = 'RS002',
      message = 'That registration change is not allowed.';
  end if;

  -- A completed or cancelled drive can no longer take attendance changes.
  if exists (
    select 1 from public.campus_blood_drives d
     where d.id = new.drive_id and d.status in ('completed', 'cancelled')
  ) then
    raise exception using
      errcode = 'RS002',
      message = 'This drive is already closed, so registrations can no longer change.';
  end if;

  return new;
end;
$$;

drop trigger if exists campus_drive_registrations_transition on public.campus_drive_registrations;
create trigger campus_drive_registrations_transition
  before update on public.campus_drive_registrations
  for each row execute function public.enforce_drive_registration_transition();

-- A drive that is completed or cancelled, or whose start has passed, cannot
-- accept NEW interest. Keeps a "join a drive that ended last month" out of the
-- roster without any application-side race.
create or replace function public.guard_drive_registration_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.campus_blood_drives%rowtype;
begin
  select * into d from public.campus_blood_drives where id = new.drive_id;
  if not found then
    raise exception using errcode = 'RS002', message = 'That drive does not exist.';
  end if;
  if not d.published then
    raise exception using errcode = 'RS002', message = 'That drive is not open for registration yet.';
  end if;
  if d.status in ('completed', 'cancelled') then
    raise exception using errcode = 'RS002', message = 'This drive is no longer open for registration.';
  end if;
  if d.starts_at <= now() then
    raise exception using errcode = 'RS002', message = 'This drive has already started. Contact the organizers if you can still attend.';
  end if;
  return new;
end;
$$;

drop trigger if exists campus_drive_registrations_guard on public.campus_drive_registrations;
create trigger campus_drive_registrations_guard
  before insert on public.campus_drive_registrations
  for each row execute function public.guard_drive_registration_insert();


-- ---------------------------------------------------------------------------
-- 3. RLS — drives and registrations
-- ---------------------------------------------------------------------------
-- Drives: any signed-in user may read a PUBLISHED drive (it is public event
-- information: title, venue, date). Drafts and any write are admin-only.
revoke all on table public.campus_blood_drives from anon;
revoke all on table public.campus_blood_drives from authenticated;
grant select on table public.campus_blood_drives to authenticated;
grant insert, update (title, organizer, drive_date, starts_at, ends_at, venue,
                      locality, description, target_units, status, published)
  on table public.campus_blood_drives to authenticated;

alter table public.campus_blood_drives enable row level security;
alter table public.campus_blood_drives force row level security;

drop policy if exists "Published drives are readable" on public.campus_blood_drives;
create policy "Published drives are readable"
  on public.campus_blood_drives for select to authenticated
  using (published or public.is_current_user_admin());

drop policy if exists "Admins can create drives" on public.campus_blood_drives;
create policy "Admins can create drives"
  on public.campus_blood_drives for insert to authenticated
  with check (public.is_current_user_admin());

drop policy if exists "Admins can manage drives" on public.campus_blood_drives;
create policy "Admins can manage drives"
  on public.campus_blood_drives for update to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- Registrations.
revoke all on table public.campus_drive_registrations from anon;
revoke all on table public.campus_drive_registrations from authenticated;
grant select on table public.campus_drive_registrations to authenticated;
grant insert (drive_id, donor_id, status, note)
  on table public.campus_drive_registrations to authenticated;
grant update (status, note)
  on table public.campus_drive_registrations to authenticated;

alter table public.campus_drive_registrations enable row level security;
alter table public.campus_drive_registrations force row level security;

-- A donor sees ONLY their own row — so a public drive page can never expose
-- the roster, and a donor can never see who else signed up.
drop policy if exists "Donors can view own registration" on public.campus_drive_registrations;
create policy "Donors can view own registration"
  on public.campus_drive_registrations for select to authenticated
  using (donor_id = auth.uid());

-- Admins see the full roster; volunteers see it too because checking donors in
-- is exactly the on-the-ground coordination work their role already does. This
-- exposes a uuid and a state only — donor phone and location remain in
-- donor_profiles behind their own RLS and are never selected here.
drop policy if exists "Admins can view all registrations" on public.campus_drive_registrations;
create policy "Admins can view all registrations"
  on public.campus_drive_registrations for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists "Active volunteers can view drive registrations" on public.campus_drive_registrations;
create policy "Active volunteers can view drive registrations"
  on public.campus_drive_registrations for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
  ));

-- Registering: own row only, and only for an ACTIVE donor. The eligibility
-- check itself is NOT repeated here — a drive is a planned event, and who may
-- donate is decided by the blood bank on the day, not by RaktSetu.
drop policy if exists "Active donors can register" on public.campus_drive_registrations;
create policy "Active donors can register"
  on public.campus_drive_registrations for insert to authenticated
  with check (
    donor_id = auth.uid()
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'donor' and p.status = 'active'
    )
  );

-- Changing one's own registration (unregistering) and on-the-day check-in.
-- The transition trigger restricts WHICH moves are legal, so a volunteer can
-- only advance registered -> checked_in (or cancel), never fabricate a
-- participation, and a settled row is final.
drop policy if exists "Own registration can be updated" on public.campus_drive_registrations;
create policy "Own registration can be updated"
  on public.campus_drive_registrations for update to authenticated
  using (donor_id = auth.uid())
  with check (donor_id = auth.uid());

drop policy if exists "Admins and volunteers can check in" on public.campus_drive_registrations;
create policy "Admins and volunteers can check in"
  on public.campus_drive_registrations for update to authenticated
  using (
    public.is_current_user_admin()
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
    )
  )
  with check (
    public.is_current_user_admin()
    or exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'volunteer' and p.status = 'active'
    )
  );


-- ---------------------------------------------------------------------------
-- 4. Drive donations land in the EXISTING donation ledger
-- ---------------------------------------------------------------------------
-- Reusing donation_history is the whole point: the 0012 trigger
-- sync_donor_profile_from_donation() fires AFTER INSERT on this table with no
-- condition on request_id, so a drive donation automatically starts the
-- donor's availability interval and refreshes their donation count. There is
-- deliberately no second eligibility or cooldown system.
alter table public.donation_history
  add column if not exists drive_id uuid
    references public.campus_blood_drives (id) on delete set null;
alter table public.donation_history
  add column if not exists blood_component text
    check (blood_component is null or blood_component in ('whole_blood', 'platelets'));

comment on column public.donation_history.drive_id is
  'Set when the donation was collected at a campus drive; null for emergency-request donations. Exactly one of drive_id / request_id identifies the occasion.';

-- Duplicate prevention, done properly.
-- The 0010 constraint is UNIQUE (donor_id, request_id, donated_on). In SQL a
-- NULL never equals another NULL, so for a drive donation (request_id IS NULL)
-- that constraint enforces NOTHING — the same donor could be recorded twice at
-- one drive, or twice on one day, and the database would happily accept it.
-- This partial index closes that hole for the drive case.
create unique index if not exists donation_history_drive_once_uidx
  on public.donation_history (donor_id, drive_id)
  where drive_id is not null;

-- A drive donation must name its drive. Emergency donations are unaffected.
alter table public.donation_history
  drop constraint if exists donation_history_occasion_check;
alter table public.donation_history
  add constraint donation_history_occasion_check check (
    (drive_id is not null and request_id is null)
    or (drive_id is null)
  );

-- Deliberately NO update grant is added here. Nothing in the application
-- amends a recorded donation — a donation is an immutable ledger entry, and
-- granting any UPDATE on it would risk a donor rewriting their own drive_id and
-- corrupting both their history and the drive aggregates.


-- ---------------------------------------------------------------------------
-- 5. In-app drive notifications
-- ---------------------------------------------------------------------------
-- In-app ONLY. No SMS, e-mail, WhatsApp, Telegram or any external provider is
-- introduced anywhere in this migration.
--
-- notifications needs a stable drive reference. Without one, the 0013 event
-- key (user, kind, request_id, alert_id) would collapse every drive event for
-- a donor to (user, kind, NULL, NULL) — meaning a donor could receive exactly
-- ONE drive reminder in the product's lifetime. drive_id makes the key real.
alter table public.notifications
  add column if not exists drive_id uuid
    references public.campus_blood_drives (id) on delete cascade;

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
    -- 0015: campus blood drives (in-app only)
    'drive_registered', 'drive_upcoming_reminder', 'drive_updated',
    'drive_completed'
  ));

comment on column public.notifications.drive_id is
  'Set for campus blood drive events, so the same donor gets at most one of each drive event per drive.';

-- Re-point the event-once index at the drive-aware key. Recreated (dropped
-- first) because the key now includes drive_id; the exception guard mirrors
-- 0013 so a historical duplicate can never make the migration fail.
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
        coalesce(drive_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
      where kind not in (
        'eligibility_updated', 'admin_report_received', 'account_status_changed'
      );
  exception when unique_violation then
    raise notice 'historical duplicate notification rows found; the event-once index was skipped. New duplicates are still prevented by the BEFORE INSERT guard.';
  end;
end $$;

-- The BEFORE INSERT guard is the real guarantee (it covers every insert path
-- and skips rather than raising). Recreated with drive_id in both the advisory
-- lock key and the existence test.
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
    coalesce(new.drive_id::text, '')
  );
  perform pg_advisory_xact_lock(hashtextextended(v_event_key, 0));

  if exists (
    select 1
      from public.notifications n
     where n.user_id = new.user_id
       and n.request_id is not distinct from new.request_id
       and n.alert_id is not distinct from new.alert_id
       and n.drive_id is not distinct from new.drive_id
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

-- notify_user gains a trailing p_drive_id. The 7-argument overload is DROPPED
-- rather than left in place: keeping both would make every existing 7-argument
-- call ambiguous at runtime and break the ring engine. The first seven
-- parameters keep their defaults, so all existing 0011–0013 call sites resolve
-- unchanged against the new signature.
drop function if exists public.notify_user(uuid, text, text, text, uuid, bigint, text);

create or replace function public.notify_user(
  p_user_id    uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_request_id uuid   default null,
  p_alert_id   bigint default null,
  p_link       text   default null,
  p_drive_id   uuid   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, request_id, alert_id, link, drive_id)
  values (p_user_id, p_kind, p_title, p_body, p_request_id, p_alert_id, p_link, p_drive_id);
end;
$$;

-- The recreated function has the default PUBLIC execute grant, so the revoke
-- from 0011 must be re-applied to the NEW signature. Skipping this would expose
-- the emitter helper to every client.
revoke all on function public.notify_user(uuid, text, text, text, uuid, bigint, text, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Drive emitters — one in-app notice per donor per drive per event
-- ---------------------------------------------------------------------------
-- Registration confirmation. Fires once per (donor, drive); the drive-aware
-- duplicate guard makes a re-insert a no-op.
create or replace function public.emit_drive_registered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.campus_blood_drives%rowtype;
begin
  select * into d from public.campus_blood_drives where id = new.drive_id;
  if not found then
    return null;
  end if;

  perform public.notify_user(
    new.donor_id,
    'drive_registered',
    'You are registered for ' || d.title,
    d.organizer || ' · ' || d.drive_date || ' at ' || d.venue || ', ' ||
      d.locality || '. Bring a photo ID. Registration is an expression of '
      'interest only — the organisers and the blood bank decide who can donate '
      'on the day.',
    null,
    null,
    '/drives/' || d.id::text,
    d.id
  );
  return null;
end;
$$;

revoke all on function public.emit_drive_registered() from public, anon, authenticated;

drop trigger if exists campus_drive_registrations_emit_registered on public.campus_drive_registrations;
create trigger campus_drive_registrations_emit_registered
  after insert on public.campus_drive_registrations
  for each row execute function public.emit_drive_registered();

-- Schedule change or cancellation, told to everyone still on the roster. Keyed
-- on (donor, drive_updated, drive) so a drive edited twice sends one notice.
create or replace function public.emit_drive_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cancelled boolean;
begin
  v_cancelled := new.status = 'cancelled' and old.status is distinct from 'cancelled';

  -- Completing a drive has its own acknowledgement emitter. Returning here stops
  -- the same status change from ALSO producing a "details changed" notice, so a
  -- donor gets one clear message per event instead of two overlapping ones.
  if new.status = 'completed' and old.status is distinct from 'completed' then
    return null;
  end if;

  if new.status is not distinct from old.status
     and new.starts_at is not distinct from old.starts_at
     and new.ends_at   is not distinct from old.ends_at
     and new.venue     is not distinct from old.venue
     and new.locality  is not distinct from old.locality then
    return null;  -- nothing a registered donor would care about
  end if;

  for r in
    select g.donor_id
      from public.campus_drive_registrations g
     where g.drive_id = new.id
       and g.status in ('registered', 'checked_in')
  loop
    perform public.notify_user(
      r.donor_id,
      'drive_updated',
      case when v_cancelled then 'Drive cancelled: ' || new.title
           else 'Drive details changed: ' || new.title end,
      case when v_cancelled then
        new.organizer || ' has cancelled this drive. Your registration has been '
        'released and you will not be alerted about it again.'
      else
        new.organizer || ' updated this drive. It is now on ' || new.drive_date ||
        ', ' || to_char(new.starts_at at time zone 'Asia/Kolkata', 'DD Mon, HH24:MI') ||
        ' IST at ' || new.venue || ', ' || new.locality || '.'
      end,
      null,
      null,
      '/drives/' || new.id::text,
      new.id
    );
  end loop;

  -- A cancelled drive is over: release the roster so nobody is checked in to it.
  -- The settle flag lets this run even though the drive is already cancelled
  -- (the AFTER trigger sees the terminal status); a client cannot set it.
  if v_cancelled then
    perform set_config('raktsetu.drive_settle', '1', true);
    update public.campus_drive_registrations
       set status = 'cancelled'
     where drive_id = new.id
       and status in ('registered', 'checked_in');
  end if;

  return null;
end;
$$;

revoke all on function public.emit_drive_updated() from public, anon, authenticated;

drop trigger if exists campus_blood_drives_emit_updated on public.campus_blood_drives;
create trigger campus_blood_drives_emit_updated
  after update on public.campus_blood_drives
  for each row execute function public.emit_drive_updated();


-- Completion acknowledgement, and the roster settles so the drive is read-only
-- afterwards. Settled rows are updated BEFORE the drive is marked completed in
-- practice; this ordering is safe either way because the transition trigger only
-- blocks changes to a drive that is ALREADY closed.
create or replace function public.emit_drive_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.status is distinct from 'completed' or old.status = 'completed' then
    return null;
  end if;

  for r in
    select g.donor_id
      from public.campus_drive_registrations g
     where g.drive_id = new.id
       and g.status in ('registered', 'checked_in')
  loop
    perform public.notify_user(
      r.donor_id,
      'drive_completed',
      'Thank you for ' || new.title,
      new.organizer || ' has completed this drive. Thank you for helping — if '
      'a donation was recorded for you, your availability interval has been '
      'updated. The blood bank remains the authority on eligibility.',
      null,
      null,
      '/drives/' || new.id::text,
      new.id
    );
  end loop;

  -- The roster is settled HERE, deliberately in the same function and AFTER the
  -- notification loop above. It used to be a separate BEFORE UPDATE trigger,
  -- which ran first and flipped every registration to 'participated' — leaving
  -- this loop's `status in ('registered','checked_in')` filter matching nothing,
  -- so completing a drive silently sent ZERO acknowledgements. Keeping both
  -- steps in one trigger makes the order explicit instead of depending on when
  -- PostgreSQL happens to fire a BEFORE trigger.
  --
  -- The settle flag is required because by AFTER time the drive row already
  -- reads 'completed', and the registration transition guard would otherwise
  -- (correctly) refuse this system write.
  perform set_config('raktsetu.drive_settle', '1', true);
  update public.campus_drive_registrations
     set status = 'participated'
   where drive_id = new.id
     and status in ('registered', 'checked_in');

  return null;
end;
$$;

revoke all on function public.emit_drive_completed() from public, anon, authenticated;

drop trigger if exists campus_blood_drives_emit_completed on public.campus_blood_drives;
create trigger campus_blood_drives_emit_completed
  after update on public.campus_blood_drives
  for each row execute function public.emit_drive_completed();

-- Any earlier version of the separate settle trigger is removed, so a re-run
-- cannot leave it in place to pre-empt the acknowledgement loop above.
drop trigger if exists campus_blood_drives_settle_registrations on public.campus_blood_drives;
drop function if exists public.settle_drive_registrations_on_completion();

-- One upcoming reminder per drive, guarded by reminder_sent_at so a repeated
-- sweep or a second scheduler run cannot re-notify. Row locks + skip locked
-- keep two concurrent sweeps from double-sending.
create or replace function public.emit_drive_reminders(p_within_hours integer default 48)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d      public.campus_blood_drives%rowtype;
  r      record;
  v_sent integer := 0;
begin
  for d in
    select * from public.campus_blood_drives
     where published
       and status = 'upcoming'
       and reminder_sent_at is null
       and starts_at > now()
       and starts_at <= now() + make_interval(
             hours => least(greatest(coalesce(p_within_hours, 48), 1), 168)
           )
     order by starts_at asc
     limit 50
     for update skip locked
  loop
    for r in
      select g.donor_id
        from public.campus_drive_registrations g
       where g.drive_id = d.id
         and g.status in ('registered', 'checked_in')
    loop
      perform public.notify_user(
        r.donor_id,
        'drive_upcoming_reminder',
        'Coming up: ' || d.title,
        d.organizer || ' · ' || d.drive_date || ', ' ||
          to_char(d.starts_at at time zone 'Asia/Kolkata', 'HH24:MI') ||
          ' IST at ' || d.venue || ', ' || d.locality ||
          '. Check the details, and cancel your registration if you can no longer attend.',
        null,
        null,
        '/drives/' || d.id::text,
        d.id
      );
    end loop;

    update public.campus_blood_drives
       set reminder_sent_at = now()
     where id = d.id;
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.emit_drive_reminders(integer) from public, anon, authenticated;
-- Granted to authenticated precisely so the application tick (tickDriveReminders
-- in src/lib/actions/drives.ts) can call it by RPC, mirroring 0012's
-- emit_alert_expiring() grant. Without this the sweep would only ever run under
-- pg_cron, and reminders would silently never fire where pg_cron is absent —
-- the exact fallback this design claims to cover. The function is a safe,
-- idempotent, self-limiting notification sweep: it can only notify donors who
-- already registered for a public drive.
grant execute on function public.emit_drive_reminders(integer) to authenticated;

-- Same guarded pg_cron pattern as 0011/0012 — one job, no new worker, and the
-- safe default is that nothing is sent rather than something failing loudly.
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
     where v.jobname = 'raktsetu-drive-reminders';
    perform cron.schedule(
      'raktsetu-drive-reminders',
      '15 * * * *',
      'select public.emit_drive_reminders(48)'
    );
  else
    raise notice 'cron schema missing; drive reminders rely on the application tick';
  end if;
exception when others then
  raise notice 'drive reminder scheduler not installed (%)', sqlerrm;
end $$;

-- End of migration 0015_campus_blood_drives.sql.

-- ---------------------------------------------------------------------------
-- 7. Aggregate operational view (no individual data)
-- ---------------------------------------------------------------------------
-- Counts only. SECURITY DEFINER because donors cannot join registrations or
-- donor_profiles across rows under RLS, so the aggregates are computed in one
-- place and gated here. The blood-group breakdown is a COUNT per group, never a
-- roster, so it cannot be turned back into individuals by a small group either.
create or replace function public.campus_drive_stats(p_drive_id uuid)
returns table (
  registered          integer,
  checked_in          integer,
  participated        integer,
  cancelled           integer,
  units_collected     integer,
  target_units        integer,
  group_breakdown     jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admin or an active volunteer. A donor, an unauthenticated caller, or a
  -- suspended account gets an empty result rather than a hint that it exists.
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active'
       and (p.role = 'admin' or p.role = 'volunteer')
  ) then
    return;
  end if;

  if not exists (select 1 from public.campus_blood_drives where id = p_drive_id) then
    return;
  end if;

  return query
  select
    (select count(*)::int from public.campus_drive_registrations g
      where g.drive_id = p_drive_id and g.status = 'registered'),
    (select count(*)::int from public.campus_drive_registrations g
      where g.drive_id = p_drive_id and g.status = 'checked_in'),
    (select count(*)::int from public.campus_drive_registrations g
      where g.drive_id = p_drive_id and g.status = 'participated'),
    (select count(*)::int from public.campus_drive_registrations g
      where g.drive_id = p_drive_id and g.status = 'cancelled'),
    (select coalesce(sum(h.units), 0)::int from public.donation_history h
      where h.drive_id = p_drive_id),
    (select d.target_units from public.campus_blood_drives d where d.id = p_drive_id),
    (
      select coalesce(jsonb_object_agg(x.blood_group, x.n), '{}'::jsonb)
        from (
          select dp.blood_group, count(*)::int as n
            from public.campus_drive_registrations g
            join public.donor_profiles dp on dp.user_id = g.donor_id
           where g.drive_id = p_drive_id
             and g.status in ('registered', 'checked_in', 'participated')
             and dp.blood_group is not null
           group by dp.blood_group
        ) x
    );
end;
$$;

revoke all on function public.campus_drive_stats(uuid) from public, anon;
grant execute on function public.campus_drive_stats(uuid) to authenticated;

comment on function public.campus_drive_stats(uuid) is
  'Aggregate campus-drive numbers for admins and active volunteers: registered, checked in, participated, cancelled, units collected vs target, and a blood-group COUNT breakdown. No individual donor row, phone, location or medical data is ever returned.';

-- ---------------------------------------------------------------------------
-- 8. Donor donation history now carries its drive context
-- ---------------------------------------------------------------------------
-- Recreated (return type changed, so CREATE OR REPLACE is not possible). The
-- own-row donor-role gate and the body are unchanged from 0012: still the
-- CALLER's own records only, still no requester contact and no coordinates.
-- A drive donation simply has null request columns and a drive title instead.
drop function if exists public.donor_donation_history(integer);

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
  request_id uuid,
  drive_id uuid,
  drive_title text
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
         coalesce(h.blood_component, r.blood_component),
         r.hospital_name,
         r.hospital_locality,
         r.status,
         h.request_id,
         h.drive_id,
         d.title
    from public.donation_history h
    left join public.blood_requests r on r.id = h.request_id
    left join public.campus_blood_drives d on d.id = h.drive_id
   where h.donor_id = auth.uid()
   order by h.donated_on desc, h.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.donor_donation_history(integer) from public, anon;
grant execute on function public.donor_donation_history(integer) to authenticated;


