import Link from "next/link";

import { formatDateTime } from "@/lib/utils";
import {
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import type { BloodRequest } from "@/types";

const URGENCY_DOT: Record<string, string> = {
  critical: "bg-blood-700",
  urgent: "bg-amber-500",
  routine: "bg-ink-400",
};

/**
 * One shared, mobile-safe request table (Prompt 24). Requester history and
 * admin oversight render the SAME columns from the request model — blood
 * group, component, units, hospital, urgency, required-by, status, created —
 * so there is no second request-management system.
 *
 * Closed rows link to the existing details page but never render actions;
 * fulfil/cancel buttons live only on active request surfaces and call the
 * existing server actions in src/lib/actions/requests.ts.
 */
export function RequestTable({
  rows,
  detailsHref,
  showRequester = false,
  emptyTitle,
  emptyDescription,
}: {
  rows: BloodRequest[];
  /** When omitted the table renders no Open cell (e.g. admin oversight has no role-appropriate detail page). */
  detailsHref?: (id: string) => string;
  showRequester?: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-200 bg-white px-8 py-14 text-center">
        <h3 className="text-xl font-bold text-ink-900">{emptyTitle}</h3>
        <p className="mx-auto mt-2 max-w-md text-base text-ink-600">{emptyDescription}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white shadow-sm">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead>
          <tr className="border-b border-ink-200">
            <Th>Group</Th>
            <Th>Details</Th>
            <Th>Hospital</Th>
            <Th>Urgency</Th>
            <Th>Required by</Th>
            <Th>Status</Th>
            {showRequester && <Th>Requester</Th>}
            <Th>Created</Th>
            {detailsHref && <Th>Open</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-ink-100 align-top last:border-b-0">
              <td className="px-4 py-4 text-lg font-extrabold text-blood-700">{r.blood_group}</td>
              <td className="max-w-[220px] px-4 py-4 text-base text-ink-900">
                {BLOOD_COMPONENT_LABELS[r.blood_component]} · {r.units}{" "}
                {r.units === 1 ? "unit" : "units"}
                {!r.note && <span className="block text-sm text-ink-400">No note added</span>}
              </td>
              <td className="max-w-[240px] px-4 py-4 text-base text-ink-900">
                <span className="block max-w-[240px] truncate font-semibold" title={r.hospital_name}>
                  {r.hospital_name}
                </span>
                <span className="block truncate text-sm text-ink-600" title={r.hospital_locality}>
                  {r.hospital_locality}
                </span>
              </td>
              <td className="px-4 py-4">
                <span className="inline-flex items-center gap-2 text-base font-semibold text-ink-900">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 rounded-full ${URGENCY_DOT[r.urgency] ?? "bg-ink-400"}`}
                  />
                  {URGENCY_LABELS[r.urgency]}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-sm text-ink-600">
                {formatDateTime(r.required_by)}
              </td>
              <td className="px-4 py-4">
                <span
                  className={`inline-block whitespace-nowrap rounded-md px-3 py-1 text-sm font-bold ${REQUEST_STATUS_STYLES[r.status]}`}
                >
                  {REQUEST_STATUS_LABELS[r.status]}
                </span>
              </td>
              {showRequester && (
                <td className="px-4 py-4 font-mono text-sm text-ink-600">
                  {r.requester_id.slice(0, 8)}…
                </td>
              )}
              <td className="whitespace-nowrap px-4 py-4 text-sm text-ink-600">
                {formatDateTime(r.created_at)}
              </td>
              {detailsHref && (
                <td className="px-4 py-4">
                  <Link
                    href={detailsHref(r.id)}
                    className="inline-block min-h-11 rounded-md border border-ink-200 px-4 py-2.5 text-base font-semibold text-ink-900 hover:bg-ink-100"
                  >
                    Open
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-sm font-bold uppercase tracking-widest text-ink-400">
      {children}
    </th>
  );
}
