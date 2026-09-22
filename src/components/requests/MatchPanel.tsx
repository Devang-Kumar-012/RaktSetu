import { MatchedDonor, MatchResult, MATCH_RINGS_KM } from "@/lib/matching";
import { formatDistance } from "@/lib/geo";
import { EmptyState } from "@/components/ui/States";
import { Alert } from "@/components/ui/Alert";


/**
 * Renders the matching result for one active blood request.
 *
 * Each branch of the MatchResult union maps to one honest UI state — there is
 * no guesswork here. A donor row shows only safe fields (blood group,
 * locality, rough distance, availability). No phone numbers, names, emails, or
 * coordinates are ever rendered.
 */
export function MatchPanel({ match }: { match: MatchResult }) {
  switch (match.kind) {
    case "not-found":
      return (
        <EmptyState
          title="Request not found"
          description="That request reference doesn't exist, or you aren't allowed to see it."
        />
      );

    case "inactive":
      return (
        <Alert variant="info" title="This request is no longer active">
          Matching only runs while a request is active. This one has been
          fulfilled, expired, or cancelled.
        </Alert>
      );

    case "no-donors":
      return (
        <EmptyState
          title="No matching donors nearby right now"
          description={
            match.summary.hospitalHasLocation
              ? "There are no eligible donors with the right blood group in the area at the moment."
              : "There are no eligible donors with the right blood group on record yet."
          }
        />
      );

    case "no-location":
      return (
        <EmptyState
          title="Matches found, but no distance yet"
          description={`There are ${match.summary.totalCompatible} compatible donor${match.summary.totalCompatible === 1 ? "" : "s"} nearby, but this request doesn't have a pinned hospital area, so donors can't be distance-sorted. Add a location to your next request, or ask a donor to set their locality.`}
        />
      );

    case "out-of-range":
      return (
        <EmptyState
          title="Donors are nearby, just a little farther"
          description={`There are compatible donors, but the nearest is beyond ${MATCH_RINGS_KM[MATCH_RINGS_KM.length - 1]} km from the hospital (searched within ${match.searchRadiusKm} km). Consider widening the search or posting in a wider area.`}
        />
      );


    case "matches":
      return (
        <>
          <MatchedDonorTable donors={match.donors} />

          {match.donors.length === 0 && (
            <EmptyState
              title="No donors in this search"
              description={`No one matched within ${match.searchRadiusKm} km right now. Try again later — donors come online throughout the day.`}
            />
          )}
        </>
      );
  }
}

/** The donor table shown when there are actual matches in range. */
function MatchedDonorTable({ donors }: { donors: MatchedDonor[] }) {
  if (donors.length === 0) return null;

  return (
    <div className="mt-4 divide-y divide-ink-200 rounded-md border border-ink-200 bg-white">
      <div className="grid grid-cols-12 gap-3 px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">
        <div className="col-span-1">Blood</div>
        <div className="col-span-4">Locality</div>
        <div className="col-span-3">Distance</div>
        <div className="col-span-3">Status</div>
        <div className="col-span-1 text-right">Cooldown</div>
      </div>
      {donors.map((d) => (
        <div
          key={d.user_id}
          className="grid grid-cols-12 gap-3 px-4 py-3 align-middle"
        >
          <div className="col-span-1 text-xl font-extrabold text-blood-700">
            {d.blood_group}
          </div>
          <div className="col-span-4 text-base text-ink-900">{d.locality}</div>
          <div className="col-span-3 text-base text-ink-700">
            {formatDistance(d.distance_km)}
          </div>
          <div className="col-span-3 text-base text-ink-700">{d.availability}</div>
          <div className="col-span-1 text-right text-base">
            {d.cooldown_clear ? "✓" : "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

