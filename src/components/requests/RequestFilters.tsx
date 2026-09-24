import Link from "next/link";

import {
  REQUEST_BLOOD_GROUPS,
  REQUEST_COMPONENTS,
  REQUEST_SORTS,
  REQUEST_STATUSES,
  REQUEST_URGENCIES,
  type RequestFilters,
} from "@/lib/request-filters";
import {
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  URGENCY_LABELS,
} from "@/lib/constants";

const control =
  "mt-1.5 w-full rounded-md border border-ink-200 bg-white px-4 py-3 text-base shadow-sm";

/**
 * Filter bar shared by requester history + admin oversight (Prompt 24).
 * Plain GET form — filters live in the URL so the database filters
 * server-side on every navigation. No client-side filtering anywhere.
 */
export function RequestFilterBar({
  filters,
  basePath,
  allowSearch = false,
  showStatus = true,
}: {
  filters: RequestFilters;
  basePath: string;
  allowSearch?: boolean;
  showStatus?: boolean;
}) {
  return (
    <form
      method="get"
      action={basePath}
      className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {showStatus && (
          <label className="block text-base font-semibold text-ink-900">
            Status
            <select name="status" defaultValue={filters.status} className={control}>
              <option value="all">All statuses</option>
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-base font-semibold text-ink-900">
          Blood group
          <select name="group" defaultValue={filters.bloodGroup} className={control}>
            <option value="all">All groups</option>
            {REQUEST_BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-base font-semibold text-ink-900">
          Component
          <select name="component" defaultValue={filters.component} className={control}>
            <option value="all">All components</option>
            {REQUEST_COMPONENTS.map((c) => (
              <option key={c} value={c}>
                {BLOOD_COMPONENT_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-base font-semibold text-ink-900">
          Urgency
          <select name="urgency" defaultValue={filters.urgency} className={control}>
            <option value="all">All urgencies</option>
            {REQUEST_URGENCIES.map((u) => (
              <option key={u} value={u}>
                {URGENCY_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-base font-semibold text-ink-900">
          From date
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={control} />
        </label>
        <label className="block text-base font-semibold text-ink-900">
          To date
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={control} />
        </label>
        <label className="block text-base font-semibold text-ink-900">
          Sort by
          <select name="sort" defaultValue={filters.sort} className={control}>
            {REQUEST_SORTS.map((s) => (
              <option key={s} value={s}>
                {s === "newest" ? "Newest first" : s === "required_by" ? "Required-by time" : "Most urgent first"}
              </option>
            ))}
          </select>
        </label>
        {allowSearch && (
          <label className="block text-base font-semibold text-ink-900">
            Hospital / locality
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              maxLength={80}
              placeholder="e.g. Fortis, Indiranagar"
              className={control}
            />
          </label>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-blood-700 px-6 py-3 text-base font-semibold text-white hover:bg-blood-800"
        >
          Apply filters
        </button>
        <Link
          href={basePath}
          className="rounded-md border border-ink-200 bg-white px-6 py-3 text-base font-semibold text-ink-900 hover:bg-ink-100"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
