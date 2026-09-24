import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ELIGIBILITY_DISCLAIMER, DONATION_INTERVAL_LABEL } from "@/lib/donation-config";
import { getDonorEligibility, getDonorProfileCompletion } from "@/lib/eligibility";
import { formatDate } from "@/lib/utils";
import type { DonorProfile, DonorRecognition } from "@/types";

const STATUS_STYLES: Record<string, string> = {
  available: "bg-green-50 text-green-900 border border-green-200",
  temporarily_unavailable: "bg-amber-50 text-amber-900 border border-amber-200",
  not_currently_eligible: "bg-ink-100 text-ink-600 border border-ink-200",
};

const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  temporarily_unavailable: "Temporarily unavailable",
  not_currently_eligible: "Not currently eligible",
};

/**
 * Donor dashboard summary: profile details, matching status
 * (availability + interval-based eligibility), and profile completion.
 * Server component — no interactivity needed.
 */
/**
 * Donor recognition panel (migration 0016).
 *
 * Rendered from donor_recognition(), which is computed from donation_history
 * alone. It therefore CANNOT count alerts received, "I can help" responses,
 * requests, or anything unverified — there is no such input in the data it
 * reads. A cancelled or expired request contributes nothing, because only a
 * recorded donation counts.
 *
 * Server component, no interactivity needed. Shows the donor's OWN record
 * only, and exposes no contact, location or profile detail.
 */
export function DonorRecognitionCard({
  recognition,
}: {
  recognition: DonorRecognition | null;
}) {
  if (!recognition) {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle>Your giving record</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-base text-ink-600">
            Your giving record could not be loaded. Completed donations appear
            here once an administrator records them.
          </p>
        </CardBody>
      </Card>
    );
  }

  const reached = (recognition.milestones ?? []).filter((m) => m.reached);
  const next = recognition.next_milestone;
  const toNext = next === null ? 0 : next - recognition.total_donations;

  return (
    <Card glass>
      <CardHeader>
        <CardTitle>Your giving record</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Completed donations
            </p>
            <p className="text-3xl font-extrabold text-blood-700">
              {recognition.total_donations}
            </p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Units recorded
            </p>
            <p className="text-3xl font-extrabold text-ink-900">
              {recognition.total_units}
            </p>
          </div>
          {recognition.last_donation && (
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Most recent
              </p>
              <p className="text-xl font-bold text-ink-900">
                {formatDate(recognition.last_donation)}
              </p>
            </div>
          )}
        </div>

        {recognition.total_donations === 0 ? (
          <p className="mt-6 text-base text-ink-600">
            No completed donations are recorded yet. When an administrator
            records one, your milestones appear here.
          </p>
        ) : (
          <>
            <p className="mt-6 text-base font-semibold text-ink-800">
              {next === null
                ? "You have reached every milestone we track. Thank you."
                : `${toNext} more ${toNext === 1 ? "donation" : "donations"} to reach ${next}.`}
            </p>

            {/* Ladder in normal document flow — no overlapping or floating
                badges. Reached rungs are filled, unreached are outlined. */}
            <ul className="mt-4 flex flex-wrap gap-2">
              {(recognition.milestones ?? []).map((m) => (
                <li
                  key={m.count}
                  className={
                    m.reached
                      ? "rounded-md border border-blood-200 bg-blood-50 px-3 py-1.5 text-sm font-bold text-blood-700"
                      : "rounded-md border border-dashed border-ink-200 px-3 py-1.5 text-sm font-semibold text-ink-500"
                  }
                >
                  {m.count} {m.count === 1 ? "donation" : "donations"}
                  {m.reached && <span className="sr-only"> — reached</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-6 text-sm text-ink-600">
          {reached.length > 0
            ? `Milestones reached: ${reached.map((m) => m.count).join(", ")}. `
            : ""}
          This counts completed donations recorded on your account only. It is
          never based on emergency alerts you received or requests you
          responded to, and it is not a statement about medical eligibility —
          the blood bank always decides that.
        </p>
      </CardBody>
    </Card>
  );
}

export function DonorStatusBadges({ donor }: { donor: DonorProfile }) {
  const eligibility = getDonorEligibility(donor);
  const completion = getDonorProfileCompletion(donor);

  return (
    <>
      <Card glass>
        <CardHeader>
          <CardTitle>Your donor details</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Blood group
            </p>
            <p className="text-2xl font-extrabold text-blood-700">{donor.blood_group}</p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Locality
            </p>
            <p className="text-xl font-bold text-ink-900">{donor.locality}</p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Location
            </p>
            <p className="text-xl font-bold text-ink-900">
              {donor.latitude !== null && donor.longitude !== null
                ? "Approximate point saved"
                : "Not set"}
            </p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Donations
            </p>
            <p className="text-xl font-bold text-ink-900">{donor.donation_count}</p>
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Last donation
            </p>
            <p className="text-xl font-bold text-ink-900">
              {formatDate(donor.last_donation_date)}
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardBody className="pt-6">
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Matching status
            </p>
            <p
              className={`mt-2 inline-block rounded-md px-4 py-2 text-lg font-bold ${STATUS_STYLES[eligibility.status]}`}
            >
              {STATUS_LABELS[eligibility.status]}
            </p>
            <p className="mt-3 text-base text-ink-600">
              {eligibility.status === "not_currently_eligible"
                ? `Your last donation was recent. Based on the ${DONATION_INTERVAL_LABEL} interval, you will automatically return to matching on your next eligible date.`
                : eligibility.status === "temporarily_unavailable"
                  ? "You paused matching yourself. Switch back to available in your donor profile when ready."
                  : "You can be matched when a nearby request needs your blood group."}
            </p>
            {eligibility.nextEligibleDate && (
              <p className="mt-2 text-base font-semibold text-ink-900">
                Next eligible date: {eligibility.nextEligibleLabel}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="pt-6">
            <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
              Profile completion
            </p>
            <p className="mt-2 text-2xl font-extrabold text-ink-900">
              {completion.complete ? "Complete" : `${completion.percent}%`}
            </p>
            <p className="mt-3 text-base text-ink-600">
              {completion.complete
                ? "Everything needed for matching is in place."
                : `Still needed: ${completion.missing.join(", ")}.`}
            </p>
            <div className="mt-4">
              <ButtonLink href="/profile/donor" variant="secondary">
                Edit donor profile
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </div>

      <Alert variant="info" className="mt-6" title="About eligibility">
        {ELIGIBILITY_DISCLAIMER}
      </Alert>
    </>
  );
}
