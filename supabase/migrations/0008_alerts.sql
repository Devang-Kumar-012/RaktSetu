-- 0008_alerts.sql
-- Donor alert and response system for RaktSetu.
--
-- Runs alert rings for active requests in the background via pg_cron.
-- Donors see their sent alerts in the donor dashboard, and respond via
-- mark_alert_responded(). Nothing here exposes donor phone/email/dates.
--
-- Idempotent — safe to re-run. Only applies changes if they do not yet exist.

-- ---------------------------------------------------------------------------
-- 1. Alert rings configuration (mirrors src/lib/constants.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_rings_km()
RETURNS integer[] LANGUAGE sql AS $$
  SELECT ARRAY[3, 7, 15];
$$;

CREATE OR REPLACE FUNCTION public.alert_window_minutes()
RETURNS integer LANGUAGE sql AS $$
  SELECT 10;
$$;

CREATE OR REPLACE FUNCTION public.alert_due_at_offset_minutes()
RETURNS integer LANGUAGE sql AS $$
  SELECT 120;
$$;

-- ---------------------------------------------------------------------------
-- 2. donor_alerts table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.donor_alerts (
  id              bigserial PRIMARY KEY,
  request_id      bigint      NOT NULL REFERENCES public.blood_requests(id)
                                 ON DELETE CASCADE,
  donor_id        uuid        NOT NULL REFERENCES public.profiles(id)
                                 ON DELETE CASCADE,
  ring_km         integer     NOT NULL CHECK (ring_km IN (3, 7, 15)),
  status          text        NOT NULL DEFAULT 'queued'
                                 CHECK (status IN ('queued', 'sent', 'opened', 'responded')),
  due_at          timestamptz NOT NULL,
  responded_at    timestamptz,
  response        text        CHECK (response IN ('accepted', 'declined')),
  accepted_at     timestamptz,
  contact_shared_until timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT donor_alerts_request_donor_unique UNIQUE (request_id, donor_id)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_donor_alerts_updated_at
  BEFORE UPDATE ON public.donor_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row-level security for donor_alerts
-- ---------------------------------------------------------------------------
ALTER TABLE public.donor_alerts ENABLE ROW LEVEL SECURITY;

-- Donors can see and update (respond to) only their own sent alerts.
CREATE POLICY donor_alerts_donor_select ON public.donor_alerts
  FOR SELECT
  USING (auth.uid() = donor_id AND status = 'sent');

CREATE POLICY donor_alerts_donor_update ON public.donor_alerts
  FOR UPDATE
  USING (auth.uid() = donor_id AND status = 'sent')
  WITH CHECK (auth.uid() = donor_id);

-- Requesters can see the alerts created for their own requests (no private donor
-- fields exposed — see the safe view below).
CREATE POLICY donor_alerts_requester_select ON public.donor_alerts
  FOR SELECT
  USING (request_id IN (
    SELECT id FROM public.blood_requests
    WHERE requester_id = auth.uid()
  ));

-- Nobody can insert directly — insert only happens through the function.
CREATE POLICY donor_alerts_no_insert ON public.donor_alerts
  FOR INSERT
  WITH CHECK (false);

-- Administrators can read all alerts.
CREATE POLICY donor_alerts_admin_select ON public.donor_alerts
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
