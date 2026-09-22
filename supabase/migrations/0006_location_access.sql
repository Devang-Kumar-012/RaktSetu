-- RaktSetu migration 0006: donor-set approximate locations.
-- Requires migrations 0001–0005. Idempotent — safe to re-run.
--
-- What this changes:
--   * Donors may now store their OWN approximate coordinates on their
--     donor_profiles row (latitude/longitude exist since 0003, but were
--     write-restricted). Coordinates are rounded to 2 decimals (~1 km) by
--     the application before storage — never an exact home position.
--   * RLS is unchanged: a donor still reaches only their own row. The
--     donor_directory view still excludes coordinates, and the matching
--     function still computes distance inside the database and returns only
--     distance_km. Other users can never read stored coordinates.
--   * blood_requests hospital coordinates (0005) are written by the server
--     at insert time from the hospital locality — no grant changes needed.

grant insert (latitude, longitude) on table public.donor_profiles to authenticated;
grant update (latitude, longitude) on table public.donor_profiles to authenticated;

comment on column public.donor_profiles.latitude is
  'Approximate coordinate of the donor''s locality, set by the donor (rounded to ~1 km by the app). Used only for distance estimates in matching. Never exposed to other users; never an exact home address.';
comment on column public.donor_profiles.longitude is
  'Approximate coordinate of the donor''s locality, set by the donor (rounded to ~1 km by the app). Used only for distance estimates in matching. Never exposed to other users; never an exact home address.';

comment on column public.blood_requests.hospital_latitude is
  'Approximate coordinate of the hospital locality, geocoded by the server at creation (rounded to ~1 km). Used only for distance estimates. Never user-visible; never an exact address.';
comment on column public.blood_requests.hospital_longitude is
  'Approximate coordinate of the hospital locality, geocoded by the server at creation (rounded to ~1 km). Used only for distance estimates. Never user-visible; never an exact address.';
