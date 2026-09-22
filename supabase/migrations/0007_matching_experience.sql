-- RaktSetu migration 0007: matching experience (radius + ring stats) and a fix.
-- Requires migrations 0001–0006. Idempotent — safe to re-run.
--
-- FIX: match_donors_for_request() (0005) selected d.latitude / d.longitude
-- from the donor_directory view, but that view intentionally exposes only
-- user_id, blood_group, locality, availability — so the function would fail
-- the moment it ran. Coordinates are now read from donor_profiles (the
-- private table) inside this SECURITY DEFINER function, and only the
-- calculated distance_km is returned. donor_directory stays coordinate-free,
-- so the public/authenticated surface is unchanged and still minimal.
--
-- Also adds:
--   * p_radius_km — maximum straight-line radius, for the upcoming
--     3 km → 7 km → 15 km alert rings. NULL = no radius cap. With a radius
--     set, donors without usable location data are excluded (they cannot be
--     proven to be inside the ring).
--   * availability + cooldown_clear columns, so the UI shows each matched
--     donor's real status instead of assuming it.
--   * matching_donor_stats() — counts per ring (3/7/15 km) plus the flags a
--     caller needs to explain an empty result honestly.

-- The 0005 signature is dropped to avoid an ambiguous overload: both
-- signatures accept (uuid, integer) positionally.
drop function if exists public.match_donors_for_request(uuid, integer);

-- ---------------------------------------------------------------------------
-- Matching: eligible donors for an ACTIVE request, nearest first.
-- ---------------------------------------------------------------------------
create or replace function public.match_donors_for_request(
  p_request_id uuid,
  p_radius_km double precision default null,
  p_limit integer default 50
)
returns table (
  user_id uuid,
  blood_group text,
  locality text,
  distance_km double precision,
  availability text,
  cooldown_clear boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_group text;
  v_request_component text;
  v_lat numeric;
  v_lng numeric;
  v_radius double precision;
begin
  -- Caller must own the request (or be an admin) and the request must be
  -- active. Anything else returns no rows.
  select r.blood_group, r.blood_component, r.hospital_latitude, r.hospital_longitude
    into v_request_group, v_request_component, v_lat, v_lng
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

  -- Normalise the radius: null stays null (no cap); otherwise keep it within
  -- a sane application range.
  v_radius := case
    when p_radius_km is null then null
    else least(greatest(p_radius_km, 0.5), 500)
  end;

  return query
  with candidates as (
    select
      d.user_id,
      d.blood_group,
      d.locality,
      d.availability,
      -- Re-stated explicitly (donor_directory already enforces it) so the UI
      -- can show the donor's real cooldown status.
      public.donor_is_currently_eligible(dp.last_donation_date) as cooldown_clear,
      case
        when v_lat is null or dp.latitude is null or dp.longitude is null then null
        else public.haversine_km(dp.latitude, dp.longitude, v_lat, v_lng)
      end as dist
    from public.donor_directory d
    join public.donor_profiles dp on dp.user_id = d.user_id
    join public.profiles p
      on p.id = d.user_id and p.role = 'donor' and p.status = 'active'
    where public.blood_groups_compatible(d.blood_group, v_request_group, v_request_component)
  )
  select c.user_id, c.blood_group, c.locality, c.dist, c.availability, c.cooldown_clear
  from candidates c
  where v_radius is null
     or (c.dist is not null and c.dist <= v_radius)
  order by c.dist asc nulls last, c.user_id asc
  limit least(greatest(p_limit, 1), 200);
end;
$$;

revoke all on function public.match_donors_for_request(uuid, double precision, integer) from anon;
grant execute on function public.match_donors_for_request(uuid, double precision, integer) to authenticated;

comment on function public.match_donors_for_request is
  'Eligible donors for an ACTIVE blood request, nearest first. Eligibility = available + past the application cooldown (donor_directory), active donor profile, blood-group compatible, and within p_radius_km when given. Returns only user_id, blood_group, locality, distance_km, availability, cooldown_clear — never names, phones, emails, or coordinates. Application-level filter only; blood bank screening is authoritative.';


-- ---------------------------------------------------------------------------
-- Ring stats: counts per alert ring, plus the flags needed to explain an
-- empty result honestly (request inactive? hospital location missing?).
-- Prepares the 3 km → 7 km → 15 km alert sequence; sends nothing itself.
-- ---------------------------------------------------------------------------
create or replace function public.matching_donor_stats(p_request_id uuid)
returns table (
  is_active boolean,
  hospital_has_location boolean,
  total_compatible integer,
  with_location integer,
  within_3km integer,
  within_7km integer,
  within_15km integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_active boolean;
  v_lat numeric;
  v_lng numeric;
  v_request_group text;
  v_request_component text;
begin
  select
      (r.status = 'active'),
      r.hospital_latitude,
      r.hospital_longitude,
      r.blood_group,
      r.blood_component
    into v_is_active, v_lat, v_lng, v_request_group, v_request_component
  from public.blood_requests r
  where r.id = p_request_id
    and (
      r.requester_id = auth.uid()
      or exists (
        select 1 from public.profiles a
        where a.id = auth.uid() and a.role = 'admin'
      )
    );

  -- Not found, or the caller may not see it: no row at all.
  if v_is_active is null then
    return;
  end if;

  -- An inactive request has no matches by definition.
  if not v_is_active then
    return query select false, (v_lat is not null and v_lng is not null), 0, 0, 0, 0, 0;
    return;
  end if;

  return query
  with compatible as (
    select
      case
        when v_lat is null or dp.latitude is null or dp.longitude is null then null
        else public.haversine_km(dp.latitude, dp.longitude, v_lat, v_lng)
      end as dist
    from public.donor_directory d
    join public.donor_profiles dp on dp.user_id = d.user_id
    join public.profiles p
      on p.id = d.user_id and p.role = 'donor' and p.status = 'active'
    where public.blood_groups_compatible(d.blood_group, v_request_group, v_request_component)
  )
  select
    true,
    (v_lat is not null and v_lng is not null),
    count(*)::int,
    count(dist)::int,
    (count(*) filter (where dist <= 3))::int,
    (count(*) filter (where dist <= 7))::int,
    (count(*) filter (where dist <= 15))::int
  from compatible;
end;
$$;

revoke all on function public.matching_donor_stats(uuid) from anon;
grant execute on function public.matching_donor_stats(uuid) to authenticated;

comment on function public.matching_donor_stats is
  'Counts of compatible donors for a request the caller owns (or admins): total, with usable location, and per 3/7/15 km ring. Used for empty states and as the basis of the future alert-ring sequence. No donor-identifying data.';
