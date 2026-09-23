import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { formatDateTime } from "@/lib/utils";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS } from "@/lib/constants";
import { AdminReportControls } from "@/components/admin/AdminReportControls";
import type { RequestReport } from "@/types";

export const metadata = { title: "Reports — admin" };

/**
 * Abuse reports for blood requests. Reads flow through admin RLS
 * ("Admins can view all reports"); review actions are admin-only server
 * actions backed by the same policy.
 */
export default async function AdminReportsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("request_reports")
    .select("id, request_id, reporter_id, reason, details, status, reviewed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const reports = (data as RequestReport[] | null) ?? [];
  const open = reports.filter((r) => r.status === "open");

  return (
    <>
      <PageHeader
        eyebrow="Admin · Reports"
        title="Request reports"
        description={`${reports.length} report${reports.length === 1 ? "" : "s"} total · ${open.length} open.`}
      />
      <Section>
        <div className="space-y-6">
          {reports.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-ink-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-md bg-ink-100 px-3 py-1 text-sm font-bold text-ink-600">
                  {REPORT_STATUS_LABELS[r.status] ?? r.status}
                </span>
                <span className="text-base font-bold text-ink-900">
                  {REPORT_REASON_LABELS[r.reason] ?? r.reason}
                </span>
                <span className="text-sm text-ink-600">
                  {formatDateTime(r.created_at)}
                </span>
              </div>
              <p className="mt-3 text-base text-ink-700">
                {r.details ?? "No additional details provided."}
              </p>
              <p className="mt-2 text-sm text-ink-600">
                Request <span className="font-mono">{r.request_id.slice(0, 8)}…</span> ·
                Reporter <span className="font-mono">{r.reporter_id.slice(0, 8)}…</span>
                {r.reviewed_at && <> · Reviewed {formatDateTime(r.reviewed_at)}</>}
              </p>
              {r.status === "open" && (
                <div className="mt-4">
                  <AdminReportControls reportId={r.id} />
                </div>
              )}
            </div>
          ))}
          {reports.length === 0 && (
            <p className="text-base text-ink-600">
              No reports yet. Users can report a suspicious request from the volunteer
              request page.
            </p>
          )}
        </div>
      </Section>
    </>
  );
}
