import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { ELIGIBILITY_DISCLAIMER } from "@/lib/donation-config";
import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import type { PlatformSettings } from "@/types";

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
        <div className="mt-8">
          <ButtonLink href="/admin" variant="secondary">
            Back to overview
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
