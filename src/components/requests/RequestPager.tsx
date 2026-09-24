import Link from "next/link";

import { filtersToSearchParams, type RequestFilters } from "@/lib/request-filters";

/** Prev/next pager that preserves the active filter query string. */
export function RequestPager({
  filters,
  basePath,
  total,
  pageSize,
  allowSearch = false,
}: {
  filters: RequestFilters;
  basePath: string;
  total: number;
  pageSize: number;
  allowSearch?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const linkFor = (page: number) => {
    const qs = filtersToSearchParams({ ...filters, page }, { allowSearch }).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav aria-label="Request pages" className="mt-6 flex flex-wrap items-center gap-3">
      {filters.page > 1 && (
        <Link
          href={linkFor(filters.page - 1)}
          className="rounded-md border border-ink-200 bg-white px-5 py-2.5 text-base font-semibold text-ink-900 hover:bg-ink-100"
        >
          ← Previous
        </Link>
      )}
      <p className="text-base text-ink-600">
        Page {filters.page} of {totalPages} · {total} {total === 1 ? "request" : "requests"}
      </p>
      {filters.page < totalPages && (
        <Link
          href={linkFor(filters.page + 1)}
          className="rounded-md border border-ink-200 bg-white px-5 py-2.5 text-base font-semibold text-ink-900 hover:bg-ink-100"
        >
          Next →
        </Link>
      )}
    </nav>
  );
}
