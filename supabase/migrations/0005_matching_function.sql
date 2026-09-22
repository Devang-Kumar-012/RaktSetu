-- RaktSetu migration 0005: donor matching foundation.
-- Requires migrations 0001–0004. Idempotent — safe to re-run.
--
-- What this provides:
--   * Approximate hospital coordinates on blood_requests (for distance
--     calculations only — never displayed, never an exact address).
--   * haversine_km() for straight-line distance between two coordinates.
--   * blood_groups_compatible(): application-level compatibility rules for
--     whole blood and platelets. NOT medical advice — the blood bank's
--     screening is always authoritative. Kept in sync with
--     src/lib/blood-compat.ts (same file-pair pattern as the donation
--     interval in 0003 / donation-config.ts).
--   * match_donors_for_request(): the single reusable matching function.
--     Only ACTIVE requests are matchable. Donors come from donor_directory
--     (already excludes paused + cooldown-filtered donors) and must have an
--     active donor profile. Returns ONLY minimal public fields — no names,
--     phones, emails, or coordinates. Ordered by distance (closest first).

-- ---------------------------------------------------------------------------
-- Hospital coordinates on requests (approximate; set later by the locality
-- geocoding step — users cannot set them from the client)
-- ---------------------------------------------------------------------------
alter table public.blood_requests
  add column if not exists hospital_latitude numeric(9, 6),
  add column if not exists hospital_longitude numeric(9, 6);

comment on column public.blood_requests.hospital_latitude is
  'Approximate coordinate of the hospital locality for distance matching. Not an exact address. Not user-editable; never displayed.';
comment on column public.blood_requests.hospital_longitude is
  'Approximate coordinate of the hospital locality for distance matching. Not an exact address. Not user-editable; never displayed.';

-- ---------------------------------------------------------------------------
-- Distance + compatibility helpers
-- ---------------------------------------------------------------------------
create or replace function public.haversine_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371.0 * 2 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )
  );
$$;

create or replace function public.blood_groups_compatible(
  p_donor text,
  p_recipient text,
  p_component text
)
returns boolean
language sql
stable
as $$
  select case
    when p_component not in ('whole_blood', 'platelets') then false
    when p_component = 'platelets' then
      -- Platelets (application rule, pending blood-bank confirmation):
      -- ABO-identical only; an Rh-negative donor may give an Rh-positive
      -- recipient; Rh-positive donors may not give Rh-negative recipients.
      left(p_donor, char_length(p_donor) - 1) = left(p_recipient, char_length(p_recipient) - 1)
      and (right(p_donor, 1) = '-' or right(p_donor, 1) = right(p_recipient, 1))
    else
      -- Whole blood (standard ABO/Rh matrix as an application filter):
      -- Rh-negative donors work for everyone; Rh-positive only for Rh-positive.
      -- O donates to any ABO; AB receives from any ABO; otherwise ABO must match.
      (right(p_donor, 1) = '-' or right(p_donor, 1) = right(p_recipient, 1))
      and (
        left(p_donor, char_length(p_donor) - 1) = 'O'
        or left(p_recipient, char_length(p_recipient) - 1) = 'AB'
        or left(p_donor, char_length(p_donor) - 1) = left(p_recipient, char_length(p_recipient) - 1)
      )
  end;
$$;

revoke all on function public.haversine_km(double precision, double precision, double precision, double precision) from anon;
revoke all on function public.blood_groups_compatible(text, text, text) from anon;

-- ---------------------------------------------------------------------------
-- The reusable matching function.
-- Isolated so the upcoming 3 km → 7 km → 15 km alert-ring system can call it
-- and filter on distance_km. Returns minimal fields only.
-- ---------------------------------------------------------------------------
create or replace function public.match_donors_for_request(
  p_request_id uuid,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  blood_group text,
  locality text,
  distance_km double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_id uuid;
  v_request_group text;
  v_request_component text;
  v_lat numeric;
  v_lng numeric;
begin
  -- The caller must own the request (or be an admin), and it must be active.
  select r.requester_id, r.blood_group, r.blood_component,
         r.hospital_latitude, r.hospital_longitude
    into v_requester_id, v_request_group, v_request_component, v_lat, v_lng
  from public.blood_requests r
  where r.id = p_request_id
    and r.status = 'active'
    and (
      r.requester_id = auth.uid()
      or exists (
        select 1 from public.profiles a
        where a.id = auth.uid() and a.role = 'admin'
      )
    );

  if v_request_group is null then
    return;
  end if;

  return query
    select
      d.user_id,
      d.blood_group,
      d.locality,
      case
        when v_lat is null or d.latitude is null or d.longitude is null then null
        else public.haversine_km(d.latitude, d.longitude, v_lat, v_lng)
      end
    from public.donor_directory d
    join public.profiles p
      on p.id = d.user_id and p.role = 'donor' and p.status = 'active'
    where public.blood_groups_compatible(d.blood_group, v_request_group, v_request_component)
    order by
      case
        when v_lat is null or d.latitude is null or d.longitude is null then null
        else public.haversine_km(d.latitude, d.longitude, v_lat, v_lng)
      end asc nulls last
    limit least(greatest(p_limit, 1), 200);
end;
$$;

revoke all on function public.match_donors_for_request(uuid, integer) from anon;
grant execute on function public.match_donors_for_request(uuid, integer) to authenticated;

comment on function public.match_donors_for_request is
  'Returns eligible donors for an ACTIVE blood request, ordered by distance. Eligibility = available (donor_directory), cooldown-passed, active donor profile, blood-group compatible. Exposes only user_id, blood_group, locality, distance_km — never contact details. Application-level rules only; blood bank screening is authoritative.';
