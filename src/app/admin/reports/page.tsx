import Link from "next/link";

import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { formatDateTime } from "@/lib/utils";
import {
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  REPORT_STATUS_LABELS,
  REPORT_STATUSES,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import { AdminReportControls } from "@/components/admin/AdminReportControls";
import type { ReportStatus, RequestReport } from "@/types";

export const metadata = { title: "Reports — admin" };

// Session-gated: the moderation queue is admin-only and must never be baked
// into a static render.
export const dynamic = "force-dynamic";

/** One bounded page of the queue — never the whole table in the browser. */
const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Abuse reports for blood requests — the existing admin moderation view, not a
 * separate dashboard.
 *
 * Reads flow through admin RLS ("Admins can view all reports") and every
 * transition is an admin-only server action backed by the same policy. Filters
 * are whitelisted here and applied DATABASE-side, so a crafted query string
 * cannot widen access or pull an unbounded result set.
 *
 * Each row shows the associated request's own facts (group, hospital, urgency,
 * lifecycle status) so an admin can judge the report without leaving the queue.
 * Resolving a report only changes the REPORT's moderation state — it never
 * cancels, hides, or otherwise alters the request, which keeps the emergency
 * lifecycle entirely separate.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRolePage("admin");
  const params = await searchParams;

  const statusRaw = first(params.status).trim();
  const reasonRaw = first(params.reason).trim();
  const status = (REPORT_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as ReportStatus)
    : null;
  const reason = (REPORT_REASONS as readonly { value: string }[]).some(
    (r) => r.value === reasonRaw
  )
    ? reasonRaw
    : null;
  const filtering = status !== null || reason !== null;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("request_reports")
    .select("id, request_id, reporter_id, reason, details, status, reviewed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (status) query = query.eq("status", status);
  if (reason) query = query.eq("reason", reason);

  const { data } = await query;
  const reports = (data as RequestReport[] | null) ?? [];

  // Queue counts for the three operational buckets. These count the report
  // table only — they say nothing about the requests behind them.
  const { count: openCount } = await supabase
    .from("request_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  const { count: underReviewCount } = await supabase
    .from("request_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "under_review");
  const { count: resolvedCount } = await supabase
    .from("request_reports")
    .select("id", { count: "exact", head: true })
    .in("status", ["reviewed", "dismissed"]);

  // The requests behind the visible reports, so each row can show its facts.
  // Admin SELECT on blood_requests already exists (migration 0004); only the
  // non-private coordination fields are read here.
  const requestIds = [...new Set(reports.map((r) => r.request_id))];
  const { data: requestRows } = requestIds.length
    ? await supabase
      .from("blood_requests")
      .select("id, blood_group, units, hospital_name, hospital_locality, urgency, status, created_at")
      .in("id", requestIds)
    : { data: [] as unknown[] };
  const requestById = new Map(
    ((requestRows ?? []) as {
      id: string;
      blood_group: string;
      units: number;
      hospital_name: string;
      hospital_locality: string;
      urgency: string;
      status: string;
      created_at: string;
    }[]).map((r) => [r.id, r])
  );

  /** Builds a filter link that replaces one facet and keeps the other. */
  const filterHref = (next: { status?: string; reason?: string }) => {
    const p = new URLSearchParams();
    const s = next.status ?? status ?? "";
    const r = next.reason ?? reason ?? "";
    if (s) p.set("status", s);
    if (r) p.set("reason", r);
    const qs = p.toString();
    return qs ? `/admin/reports?${qs}` : "/admin/reports";
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Reports"
        title="Request reports"
        description="Suspicious or incorrect requests reported by users. Reviewing a report never cancels or hides the request itself."
      />
      <Section>
        <div className="space-y-6">
          {/* Queue summary — real counts from the database, not analytics. */}
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              {
                label: "Open",
                value: openCount ?? 0,
                href: filterHref({ status: "open", reason: "" }),
              },
              {
                label: "Under review",
                value: underReviewCount ?? 0,
                href: filterHref({ status: "under_review", reason: "" }),
              },
              {
                label: "Resolved",
                value: resolvedCount ?? 0,
                href: filterHref({ status: "reviewed", reason: "" }),
              },
            ].map((bucket) => (
              <div key={bucket.label} className="glass rounded-lg p-5">
                <dt className="text-sm font-bold uppercase tracking-widest text-ink-500">
                  {bucket.label}
                </dt>
                <dd className="mt-1 text-3xl font-extrabold text-ink-900">{bucket.value}</dd>
                <Link
                  href={bucket.href}
                  className="mt-2 inline-block text-sm font-semibold text-blood-700 underline"
                >
                  View {bucket.label.toLowerCase()}
                </Link>
              </div>
            ))}
          </dl>

          {/* Filters — whitelisted values, applied database-side. */}
          <form
            method="get"
            action="/admin/reports"
            className="flex flex-wrap items-end gap-4 rounded-lg border border-ink-200 bg-white p-5 shadow-sm"
          >
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold uppercase tracking-widest text-ink-500">
                Status
              </span>
              <select
                name="status"
                defaultValue={status ?? ""}
                className="rounded-md border border-ink-200 bg-white px-3 py-2 text-base text-ink-900 focus:border-blood-600 focus:outline-none focus:ring-2 focus:ring-blood-100"
              >
                <option value="">All statuses</option>
                {REPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REPORT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold uppercase tracking-widest text-ink-500">
                Reason
              </span>
              <select
                name="reason"
                defaultValue={reason ?? ""}
                className="rounded-md border border-ink-200 bg-white px-3 py-2 text-base text-ink-900 focus:border-blood-600 focus:outline-none focus:ring-2 focus:ring-blood-100"
              >
                <option value="">All reasons</option>
                {REPORT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-blood-700 px-4 py-2 text-base font-semibold text-white hover:bg-blood-800"
            >
              Apply
            </button>
            {filtering && (
              <Link
                href="/admin/reports"
                className="rounded-md border border-ink-200 px-4 py-2 text-base font-semibold text-ink-700 hover:bg-ink-50"
              >
                Clear
              </Link>
            )}
          </form>
          {reports.map((r) => {
            const request = requestById.get(r.request_id);
            return (
              <article
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
                    Reported {formatDateTime(r.created_at)}
                  </span>
                </div>

                {r.details && (
                  <p className="mt-3 max-w-3xl text-base text-ink-700">{r.details}</p>
                )}

                {/* The associated request's own facts, so a report can be judged
                    in place. No requester contact details are ever read here. */}
                <dl className="mt-4 grid gap-x-6 gap-y-2 rounded-md bg-ink-50 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-bold uppercase tracking-widest text-ink-500">
                      Request
                    </dt>
                    <dd className="mt-1 font-mono text-ink-700">
                      {r.request_id.slice(0, 8)}…
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold uppercase tracking-widest text-ink-500">
                      Reporter
                    </dt>
                    <dd className="mt-1 font-mono text-ink-700">
                      {r.reporter_id.slice(0, 8)}…
                    </dd>
                  </div>
                  {request && (
                    <>
                      <div>
                        <dt className="font-bold uppercase tracking-widest text-ink-500">
                          Need
                        </dt>
                        <dd className="mt-1 text-ink-800">
                          {request.blood_group} · {request.units}{" "}
                          {request.units === 1 ? "unit" : "units"} ·{" "}
                          {URGENCY_LABELS[request.urgency] ?? request.urgency}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold uppercase tracking-widest text-ink-500">
                          Hospital
                        </dt>
                        <dd className="mt-1 text-ink-800">
                          {request.hospital_name}, {request.hospital_locality}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold uppercase tracking-widest text-ink-500">
                          Request status
                        </dt>
                        <dd className="mt-1">
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-bold ${REQUEST_STATUS_STYLES[request.status] ??
                              "bg-ink-100 text-ink-600"
                              }`}
                          >
                            {REQUEST_STATUS_LABELS[request.status] ?? request.status}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold uppercase tracking-widest text-ink-500">
                          Created
                        </dt>
                        <dd className="mt-1 text-ink-800">
                          {formatDateTime(request.created_at)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>

                {r.reviewed_at && (
                  <p className="mt-3 text-sm text-ink-600">
                    Last moderation change {formatDateTime(r.reviewed_at)}
                  </p>
                )}

                <div className="mt-4">
                  <AdminReportControls reportId={r.id} status={r.status} />
                </div>
              </article>
            );
          })}
          {reports.length === 0 && (
            <p className="text-base text-ink-600">
              {filtering
                ? "No reports match these filters."
                : "No reports yet. Users can report a suspicious or incorrect request from a request page."}
            </p>
          )}
        </div>
      </Section>
    </>
  );
}
