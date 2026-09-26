import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { formatDateTime } from "@/lib/utils";
import { AdminRecordDonationForm } from "@/components/admin/AdminSettingsForm";
import type { DonationRecord } from "@/types";

export const metadata = { title: "Donations — admin" };

/**
 * Completed-donation records for administration. Deliberately minimal:
 * donor reference, related request, date, units — no medical data.
 * Reads flow through admin RLS (select-all) on donation_history.
 */
export default async function AdminDonationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("donation_history")
    .select("id, donor_id, request_id, donated_on, units, created_at")
    .order("donated_on", { ascending: false })
    .limit(100);

  const records = (data as DonationRecord[] | null) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Admin · Donations"
        title="Completed donations"
        description="Administration records only — who donated for which request, when, and how many units. RaktSetu keeps no medical data."
      />
      <Section>
        {/*
          `min-w-0` on the grid item is what makes the horizontal scroll work.
          A grid/flex item defaults to `min-width: auto`, so it refuses to shrink
          below its widest child — the 560px table — and pushes the whole page
          sideways instead of letting `overflow-x-auto` take over. The table keeps
          its minimum width so it stays readable and simply scrolls inside its
          column, which is the correct behaviour for a data table on a phone.
        */}
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Recent donations ({records.length})
            </h2>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-ink-200">
                    <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Donor ID</th>
                    <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Request</th>
                    <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Date</th>
                    <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b border-ink-100">
                      <td className="px-4 py-3 text-sm text-ink-600">{r.donor_id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 text-sm text-ink-600">
                        {r.request_id ? `${r.request_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-900">{r.donated_on}</td>
                      <td className="px-4 py-3 text-ink-600">{r.units}</td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-ink-600">
                        No donations recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Record a donation
            </h2>
            <p className="mt-2 text-base text-ink-600">
              Use the account and request IDs from the Users and Requests sections.
            </p>
            <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
              <AdminRecordDonationForm />
            </div>
            <Alert variant="info" title="Availability filter only" className="mt-6">
              Recording a donation updates administration data; the donor&apos;s own
              eligibility countdown continues to be an application-level availability
              filter, never a medical decision.
            </Alert>
          </div>
        </div>
        <p className="mt-8 text-sm text-ink-600">
          Latest record {records[0] ? formatDateTime(records[0].created_at) : "—"}.
        </p>
      </Section>
    </>
  );
}
