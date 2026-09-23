import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { formatDateTime } from "@/lib/utils";
import {
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import type { BloodRequest } from "@/types";

export const metadata = { title: "Requests — admin" };

/**
 * Full request oversight. blood_requests has an admin SELECT policy (0004);
 * lifecycle rules and expiry are untouched — this view only reads.
 */
export default async function AdminRequestsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("blood_requests")
    .select(
      "id, blood_group, blood_component, units, hospital_name, hospital_locality, urgency, required_by, status, requester_id, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const requests = (data as BloodRequest[] | null) ?? [];
  const active = requests.filter((r) => r.status === "active");
  const past = requests.filter((r) => r.status !== "active");

  function Row({ r }: { r: BloodRequest }) {
    return (
      <tr className="border-b border-ink-100">
        <td className="px-4 py-4 font-mono text-sm text-ink-600">{r.id.slice(0, 8)}…</td>
        <td className="px-4 py-4 font-extrabold text-blood-700">{r.blood_group}</td>
        <td className="px-4 py-4 text-ink-600">
          {BLOOD_COMPONENT_LABELS[r.blood_component]} · {r.units}
        </td>
        <td className="px-4 py-4 text-ink-900">
          {r.hospital_name}
          <span className="text-ink-600"> — {r.hospital_locality}</span>
        </td>
        <td className="px-4 py-4 text-ink-600">{URGENCY_LABELS[r.urgency]}</td>
        <td className="px-4 py-4 text-sm text-ink-600">{formatDateTime(r.required_by)}</td>
        <td className="px-4 py-4 font-mono text-sm text-ink-600">
          {r.requester_id.slice(0, 8)}…
        </td>
        <td className="px-4 py-4">
          <span
            className={`rounded-md px-3 py-1 text-sm font-bold ${REQUEST_STATUS_STYLES[r.status]}`}
          >
            {REQUEST_STATUS_LABELS[r.status]}
          </span>
        </td>
        <td className="px-4 py-4 text-sm text-ink-600">{formatDateTime(r.created_at)}</td>
      </tr>
    );
  }

  const header = (
    <thead>
      <tr className="border-b border-ink-200">
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">ID</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Group</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Component</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Hospital</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Urgency</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Required by</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Requester</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Status</th>
        <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Created</th>
      </tr>
    </thead>
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin · Requests"
        title="Blood request oversight"
        description={`${active.length} active · ${past.length} historical. Lifecycle rules are unchanged — admins observe here, the requester always owns fulfill/cancel.`}
      />
      <Section>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
          Active requests ({active.length})
        </h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            {header}
            <tbody>
              {active.map((r) => (
                <Row key={r.id} r={r} />
              ))}
              {active.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-ink-600">
                    No active requests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Historical requests ({past.length})
        </h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            {header}
            <tbody>
              {past.map((r) => (
                <Row key={r.id} r={r} />
              ))}
              {past.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-ink-600">
                    No historical requests.
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
