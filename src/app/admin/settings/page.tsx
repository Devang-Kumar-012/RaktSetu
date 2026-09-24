import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { ELIGIBILITY_DISCLAIMER } from "@/lib/donation-config";
import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import { AdminSafetyLimitsForm } from "@/components/admin/AdminSafetyLimitsForm";
import { SAFETY_LIMITS_DEFAULTS } from "@/lib/constants";
import type { PlatformSafetyLimits, PlatformSettings } from "@/types";

export const metadata = { title: "Platform settings — admin" };

/**
 * Coordination settings (ring distances, wait window, alert offset, donation
 * interval). Admin-only: requireRolePage in the layout + RLS write policy.
 */
export default async function AdminSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("id, alert_rings_km, alert_window_minutes, alert_due_at_offset_minutes, donation_interval_days, updated_at")
    .eq("id", 1)
    .maybeSingle();

  const settings =
    (data as PlatformSettings | null) ??
    ({
      id: 1,
      alert_rings_km: [3, 7, 15],
      alert_window_minutes: 10,
      alert_due_at_offset_minutes: 120,
      donation_interval_days: 90,
      updated_at: new Date().toISOString(),
    } satisfies PlatformSettings);

  // Readable by any authenticated user (RLS "Anyone authenticated can read
  // safety limits"), but only an admin may change it. Defaults here mirror the
  // migration exactly, so the form is usable even before 0014 is applied.
  const { data: limitsRow } = await supabase
    .from("platform_safety_limits")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  const limits: PlatformSafetyLimits =
    (limitsRow as PlatformSafetyLimits | null) ??
    ({
      id: 1,
      max_active_requests_per_requester: SAFETY_LIMITS_DEFAULTS.maxActiveRequestsPerRequester,
      min_request_interval_seconds: SAFETY_LIMITS_DEFAULTS.minRequestIntervalSeconds,
      max_requests_per_hour: SAFETY_LIMITS_DEFAULTS.maxRequestsPerHour,
      max_reports_per_day: SAFETY_LIMITS_DEFAULTS.maxReportsPerDay,
      max_alert_responses_per_minute: SAFETY_LIMITS_DEFAULTS.maxAlertResponsesPerMinute,
      updated_at: new Date().toISOString(),
    } satisfies PlatformSafetyLimits);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Settings"
        title="Platform coordination settings"
        description={`Last updated ${formatDateTime(settings.updated_at)}.`}
      />
      <Section className="max-w-2xl">
        <Alert variant="warning" title="These are coordination rules, not medical rules">
          {ELIGIBILITY_DISCLAIMER}
        </Alert>
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
          <AdminSettingsForm settings={settings} />
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Platform safety limits
        </h2>
        <p className="mt-2 max-w-2xl text-base text-ink-600">
          Every anti-abuse limit RaktSetu enforces lives in one database row, so it
          can be tuned here without a code change. Limits only ever apply to
          signed-in users — service writes, migrations and admin tooling are never
          rate limited.
        </p>
        <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
          <AdminSafetyLimitsForm limits={limits} />
        </div>

        <div className="mt-8">
          <ButtonLink href="/admin" variant="secondary">
            Back to overview
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
