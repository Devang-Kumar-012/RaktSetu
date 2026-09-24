-- ---------------------------------------------------------------------------
-- Migration 0018 — losing-donor notice (real-time correctness)
-- ---------------------------------------------------------------------------
-- Requires migrations 0001–0017. Idempotent — safe to re-run.
--
-- THE GAP THIS CLOSES
--
-- mark_alert_responded() atomically retires every other outstanding alert the
-- moment one donor accepts:
--
--     update public.donor_alerts set status = 'expired'
--      where request_id = v_request.id and id <> p_alert_id
--        and status in ('queued', 'sent', 'opened');
--
-- That update is correct and necessary — it stops the rings. But it emitted NO
-- notification, and the losing donor's dashboard has no live channel of its own.
-- So a donor who was mid-screen on a request saw an alert they could still
-- press "I can help" on for a request that already had a winner. The click was
-- correctly REJECTED server-side (mark_alert_responded returns 'already_taken',
-- checked before the status branch precisely so the donor learns the true
-- reason) — so this was never a safety hole. It was a dead end: the donor found
-- out only by trying, and only after the fact.
--
-- The 'already_accepted' notification kind already existed in every allowed-
-- kinds constraint from 0012 onward, but nothing ever emitted it. This
-- migration wires it to the transition it was always meant to describe.
--
-- WHY A TRIGGER, NOT A REWRITE OF mark_alert_responded()
--
-- The acceptance path is the most safety-critical code in the project: it runs
-- under a request-row lock and is the single atomic winner-selection point. It
-- is deliberately NOT edited. An AFTER UPDATE trigger observing the already-
-- committed transition is additive — it cannot change who wins, cannot reorder
-- the lock, and cannot abort the acceptance, because it only ever returns NULL.
-- That also means it cannot collide with the 0014 anti-abuse rate-limit guard
-- on donor_alerts, which is a BEFORE UPDATE OF response trigger: this one is
-- AFTER UPDATE and never assigns `response`.
-- ---------------------------------------------------------------------------

create or replace function public.emit_already_accepted_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the "lost the race" transition: an OPEN alert being retired.
  -- A donor who already answered is not queued for anything, so both the
  -- status precondition and the response guard below keep this quiet for them.
  if new.status <> 'expired' then
    return null;
  end if;
  if old.status not in ('queued', 'sent', 'opened') then
    return null;
  end if;
  if new.response is not null then
    return null;
  end if;

  -- There must be a winner for THIS request. Without one this is the ordinary
  -- close-out sweep (request cancelled / fulfilled / expired), which already
  -- emits 'request_closed' to the same donors. Notifying again here would
  -- double-notify on every ordinary close, which is exactly the storm this
  -- project is meant to avoid.
  if not exists (
    select 1
      from public.donor_alerts w
     where w.request_id = new.request_id
       and w.response = 'accepted'
  ) then
    return null;
  end if;

  -- Deliberately reveals NOTHING about the winning donor: no name, no contact,
  -- no locality. The requester's authorised reveal path is the only place that
  -- data is ever exposed, and that donor has not been authorised for anything.
  perform public.notify_user(
    new.donor_id,
    'already_accepted',
    'Another donor responded first',
    'Someone else accepted the blood request you were alerted about, so your '
      || 'response is no longer needed. No action is required — thank you for '
      || 'being ready to help.',
    new.request_id,
    new.id,
    '/dashboard/donor'
  );

  return null;
end;
$$;

revoke all on function public.emit_already_accepted_notice() from public, anon, authenticated;

drop trigger if exists donor_alerts_already_accepted_notice on public.donor_alerts;
create trigger donor_alerts_already_accepted_notice
  after update on public.donor_alerts
  for each row
  execute function public.emit_already_accepted_notice();

comment on function public.emit_already_accepted_notice() is
  'AFTER UPDATE trigger: notifies a donor whose open alert was retired because another donor accepted the same request. Fires only for that transition, never for the ordinary cancel/fulfil/expiry sweep (which already notifies via request_closed). Privacy-safe: identifies no other donor.';

-- ---------------------------------------------------------------------------
-- Index supporting the per-row winner lookup above.
-- ---------------------------------------------------------------------------
-- The trigger asks, once per retired alert, "does an accepted alert exist for
-- this request?". Without this the lookup degrades to a sequential scan of
-- donor_alerts on every close-out sweep.
create index if not exists donor_alerts_request_accepted_idx
  on public.donor_alerts (request_id)
  where response = 'accepted';

-- End of migration 0018_losing_donor_notice.sql.
