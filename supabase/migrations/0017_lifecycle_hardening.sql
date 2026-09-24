-- ---------------------------------------------------------------------------
-- Migration 0017 — request lifecycle hardening
-- ---------------------------------------------------------------------------
-- Requires migrations 0001–0016. Idempotent — safe to re-run.
--
-- Two invariants found during the Prompt 28 end-to-end audit. Nothing here
-- changes the authoritative lifecycle, which remains:
--
--     active → fulfilled
--     active → cancelled
--     active → expired   (existing expiry process)
--
-- There is still no 'accepted' request status: acceptance is a donor-alert
-- relationship, never a lifecycle state.
--
-- ---------------------------------------------------------------------------
-- 1. Fulfilling a request requires a real accepted donor
-- ---------------------------------------------------------------------------
-- The existing closeout emitter (0012) already assumed this: it notifies "the
-- winning donor ... IF THERE IS ONE", so a fulfilment with no accepting donor
-- was never an intended outcome. Without the guard it was still reachable, and
-- it is a genuinely bad state: a request claims blood was secured while no
-- donor ever agreed — indistinguishable from a lost donor, and it produces a
-- fulfilment nobody can explain or audit afterwards.
--
-- Enforced in the DATABASE, not the UI, so it holds for every client, script
-- and direct PostgREST call alike.
--
-- Deliberately NOT applied to 'cancelled' or 'expired':
--   * cancellation must always remain possible, INCLUDING after a donor has
--     accepted — an explicit requirement of the existing design;
--   * expiry is driven by the scheduler and must never be blocked, or a
--     past-deadline request could stay active and keep alerting donors.
create or replace function public.guard_request_fulfilment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the active -> fulfilled transition is guarded. Same-status updates and
  -- every other transition pass straight through.
  if new.status <> 'fulfilled' or old.status = 'fulfilled' then
    return new;
  end if;

  -- An admin may record the true outcome directly (for example a request
  -- fulfilled through a blood bank outside RaktSetu). This reuses authority
  -- admins already hold over donation_history; it grants nothing new.
  if public.is_current_user_admin() then
    return new;
  end if;

  if not exists (
    select 1
      from public.donor_alerts a
     where a.request_id = new.id
       and a.response = 'accepted'
  ) then
    raise exception using
      errcode = 'RS003',
      message = 'A request can only be marked fulfilled once a donor has accepted it. Cancel the request instead if the blood is no longer needed.';
  end if;

  return new;
end;
$$;

-- A trigger function is not meant to be called directly; revoke so nobody can.
revoke all on function public.guard_request_fulfilment() from public, anon, authenticated;

drop trigger if exists blood_requests_guard_fulfilment on public.blood_requests;
create trigger blood_requests_guard_fulfilment
  before update of status on public.blood_requests
  for each row execute function public.guard_request_fulfilment();

-- ---------------------------------------------------------------------------
-- 2. Notification preferences can never lock a user out of saving them
-- ---------------------------------------------------------------------------
-- Found in the same audit. Migration 0016 revoked INSERT from `authenticated`
-- and granted only SELECT plus a column-limited UPDATE, while the server
-- action performs an UPSERT. The backfill in 0016 covered only profiles that
-- existed when that migration ran, so any user who registered LATER had no
-- row — and the upsert needs INSERT to create it. Their very first save of
-- notification preferences would therefore fail with "Could not save your
-- preferences", permanently, with no way to recover from the UI.
--
-- Fixed in two layers, so neither alone is load-bearing:
--   a) every new profile gets a preferences row automatically (the normal
--      path — the action then always takes the UPDATE branch);
--   b) an own-row INSERT policy is the backstop, so even a row that somehow
--      went missing cannot lock the user out.
-- Both pin user_id to the caller's own id, so neither can touch another
-- user's preferences. DELETE stays revoked.
create or replace function public.create_notification_preferences_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_notification_preferences_row() from public, anon, authenticated;

drop trigger if exists profiles_create_notification_preferences on public.profiles;
create trigger profiles_create_notification_preferences
  after insert on public.profiles
  for each row execute function public.create_notification_preferences_row();

-- Backstop policy. Should never be reached in normal operation — that is the
-- point of (a) — but it guarantees the action can always write its own row.
drop policy if exists "Users can create own notification preferences" on public.notification_preferences;
create policy "Users can create own notification preferences"
  on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());

-- The INSERT grant is column-limited: a user may only ever set their own
-- preferences and only the real keys. created_at/updated_at stay system-owned.
grant insert (user_id, drive_updates, donor_reminders, recognition_updates)
  on table public.notification_preferences to authenticated;

-- Repair any row a partial earlier application may have missed. Harmless when
-- the trigger already created them.
insert into public.notification_preferences (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

-- End of migration 0017_lifecycle_hardening.sql.

