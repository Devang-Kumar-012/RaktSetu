import {
  ALERT_RING_LABELS,
  REQUEST_STATUS_LABELS,
} from "@/lib/constants";
import type { BloodRequestStatus } from "@/types";

/**
 * Read-only strip above the donor's open alerts: which ring the donor is in,
 * how many minutes remain to respond, and whether the request is still
 * active — server-rendered with the same clock that gated actionability.
 * A plain strip on purpose: it must never nest inside a Card. It uses the
 * shared blood-tinted glass surface so it reads as one layer with the alert
 * cards below while keeping its text fully opaque and high-contrast.
 */
export function RingStatusStrip({
  items,
}: {
  items: {
    ringKm: number;
    minutesLeft: number;
    requestStatus: BloodRequestStatus;
  }[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="glass-blood mt-6 rounded-lg px-4 py-3">
      <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
        Your open alerts
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item, index) => (
          <li
            key={`${item.ringKm}-${index}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-800"
          >
            <span className="font-bold text-ink-900">
              {ALERT_RING_LABELS[item.ringKm] ?? `${item.ringKm} km`}
            </span>
            <span aria-hidden="true" className="text-ink-400">
              ·
            </span>
            <span>{item.minutesLeft} min left</span>
            <span aria-hidden="true" className="text-ink-400">
              ·
            </span>
            <span
              className={
                item.requestStatus === "active"
                  ? "font-semibold text-green-900"
                  : "font-semibold text-ink-600"
              }
            >
              {item.requestStatus === "active"
                ? "Request active"
                : REQUEST_STATUS_LABELS[item.requestStatus]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}