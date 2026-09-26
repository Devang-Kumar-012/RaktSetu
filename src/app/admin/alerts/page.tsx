import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { formatDateTime } from "@/lib/utils";
import { ALERT_STATUS_LABELS, REQUEST_STATUS_LABELS } from "@/lib/constants";
import type { AdminAlertRow, AdminRingProgressRow } from "@/types";

export const metadata = { title: "Alerts — admin" };

function responseLabel(row: AdminAlertRow): string {
  if (row.response === "accepted") return "Accepted";
  if (row.response === "declined") return "Declined";
  return "No response yet";
}

/**
 * Operational alert visibility for admins. Reads flow through
 * admin_list_alerts() (SECURITY DEFINER, admin-checked in the database).
 * Donor identities are references only — never names, phones, or coordinates.
 */
export default async function AdminAlertsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_list_alerts", { p_limit: 100 });
  const alerts = (data as AdminAlertRow[] | null) ?? [];
  const accepted = alerts.filter((a) => a.response === "accepted");

  // Ring-engine state for active administrators (admin_ring_progress — the
  // role check lives in the SECURITY DEFINER body).
  const { data: ringData } = await supabase.rpc("admin_ring_progress", {
    p_limit: 50,
  });
  const rings = (ringData as AdminRingProgressRow[] | null) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Admin · Alerts"
        title="Emergency alert rings"
        description={`${alerts.length} recent alerts · ${accepted.length} accepted donor relationships.`}
      />
      <Section>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
          Ring progress
        </h2>
        <p className="mt-2 text-base text-ink-600">
          Which ring each tracked request reached, when it started or finished,
          how many donors were alerted, and why the process stopped. One row per
          ring — idempotent by (request, ring index).
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Request</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Ring</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Started</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Finished</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Alerts sent</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Outcome</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Request status</th>
              </tr>
            </thead>
            <tbody>
              {rings.map((r) => (
                <tr
                  key={`${r.request_id}-${r.ring_index}`}
                  className="border-b border-ink-100"
                >
                  <td className="px-4 py-3 text-ink-600">
                    {r.blood_group} · {r.locality}
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink-900">
                    #{r.ring_index} · {r.ring_km} km
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-600">
                    {formatDateTime(r.started_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-600">
                    {r.finished_at ? formatDateTime(r.finished_at) : "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-600">{r.alerts_sent}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {r.outcome === null
                      ? "Running"
                      : r.outcome === "accepted"
                        ? "Donor accepted"
                        : r.outcome === "rings_exhausted"
                          ? "Rings exhausted"
                          : "Request closed"}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {REQUEST_STATUS_LABELS[r.request_status] ?? r.request_status}
                  </td>
                </tr>
              ))}
              {rings.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-ink-600">
                    No ring activity yet — the engine starts ring 1 on its next
                    tick after a request goes active.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Ring</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Alert status</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Donor response</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Request</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Donor</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Sent</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Due</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Responded</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.alert_id} className="border-b border-ink-100">
                  <td className="px-4 py-3 font-semibold text-ink-900">{a.ring_km} km</td>
                  <td className="px-4 py-3 text-ink-600">
                    {ALERT_STATUS_LABELS[a.status] ?? a.status}
                  </td>
                  <td className="px-4 py-3 text-ink-600">{responseLabel(a)}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {a.blood_group} · {a.locality}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-600">{a.donor_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-sm text-ink-600">{formatDateTime(a.created_at)}</td>
                  <td className="px-4 py-3 text-sm text-ink-600">{formatDateTime(a.due_at)}</td>
                  <td className="px-4 py-3 text-sm text-ink-600">
                    {a.responded_at ? formatDateTime(a.responded_at) : "—"}
                  </td>
                </tr>
              ))}
              {alerts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-ink-600">
                    No alerts have been queued yet — the alert job queues alerts for
                    active requests whose rings are not yet covered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
