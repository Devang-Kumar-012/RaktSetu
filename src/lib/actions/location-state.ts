/**
 * Location-lookup action state.
 *
 * This lives in a PLAIN module on purpose.
 *
 * `src/lib/actions/location.ts` is a `"use server"` module, and such a module
 * may only export async functions — every other export is replaced in the
 * client bundle by a server-reference proxy. The request form and donor profile
 * form are Client Components that need this *value* as their `useActionState`
 * initial state; importing it from the action module handed them a proxy
 * instead of the object, so the lookup area broke and `/request-blood` fell
 * through to the global error boundary.
 *
 * Server actions belong in the `"use server"` module; the state shape they
 * return belongs here, where both sides can import it safely.
 */
import type { GeocodeCandidate } from "@/lib/geocode";
import type { ProfileActionState } from "@/lib/actions/action-state";

/** Lookup action state — extends the shared shape with area candidates. */
export interface LocationLookupState extends ProfileActionState {
  candidates: GeocodeCandidate[];
}

export const initialLocationLookupState: LocationLookupState = {
  ok: false,
  error: null,
  candidates: [],
};
