/**
 * Turns the database into files a person can open: one JSON file per table, plus a
 * plain-English `report.md` (names, dates, blood groups — no ids, no hashes).
 *
 * Used two ways, so both always look the same:
 *  - live, by the local SQLite driver after every committed write (data/);
 *  - on demand, by `npm run data:pull` against production Turso (data/production/).
 * A deployed site cannot write here itself: Vercel's disk is read-only and
 * temporary, which is why production data is pulled rather than pushed.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BLOOD_COMPONENT_LABELS, URGENCY_LABELS } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/utils";

type Row = Record<string, unknown>;
export type Snapshot = Record<string, { columns: string[]; rows: Row[] }>;

const TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
const columnsSql = (t: string) => `PRAGMA table_info("${t}")`;
const rowsSql = (t: string) => `SELECT * FROM "${t}"`;

/** Secrets never copied into any exported file. */
const REDACTED_COLUMNS = new Set(["password_hash", "token_hash"]);

/** Read every table through a synchronous query function (local node:sqlite). */
export function snapshotSync(all: (sql: string) => Row[]): Snapshot {
  const out: Snapshot = {};
  for (const { name } of all(TABLES_SQL) as Array<{ name: string }>) {
    out[name] = { columns: all(columnsSql(name)).map((c) => String(c.name)), rows: all(rowsSql(name)) };
  }
  return out;
}

/** Same as snapshotSync, for an async query function (remote Turso). */
export async function snapshotAsync(all: (sql: string) => Promise<Row[]>): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const { name } of (await all(TABLES_SQL)) as Array<{ name: string }>) {
    out[name] = { columns: (await all(columnsSql(name))).map((c) => String(c.name)), rows: await all(rowsSql(name)) };
  }
  return out;
}

/** Temp file + rename, so a crash mid-write never leaves a half-written file. */
function writeAtomic(file: string, text: string): void {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

/** Write `<dir>/json/<table>.json` (an array of row objects) for every table and `<dir>/report.md`. */
export function writeDataFiles(snapshot: Snapshot, dir: string): void {
  const jsonDir = join(dir, "json");
  mkdirSync(jsonDir, { recursive: true });
  for (const [name, { columns, rows }] of Object.entries(snapshot)) {
    const out = rows.map((row) =>
      Object.fromEntries(columns.map((c) => [c, REDACTED_COLUMNS.has(c) ? "[redacted]" : row[c]])),
    );
    // JSON.stringify throws on bigint, which SQLite can return for large integers.
    const json = JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    writeAtomic(join(jsonDir, `${name}.json`), json + "\n");
  }
  writeAtomic(join(dir, "report.md"), buildReport(snapshot));
}

/* ------------------------------------------------------------ the report */

const rowsOf = (s: Snapshot, t: string): Row[] => s[t]?.rows ?? [];
const text = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
const cap = (v: unknown): string => {
  const s = text(v).replaceAll("_", " ");
  return s === "—" ? s : s[0].toUpperCase() + s.slice(1);
};

/** A Markdown table; cell text is escaped so a typed "|" cannot break the layout. */
function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_Nothing yet._\n";
  const cell = (s: string) => s.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n") + "\n";
}

export function buildReport(s: Snapshot, now = new Date()): string {
  const users = rowsOf(s, "users");
  const nameOf = new Map(users.map((u) => [u.id, text(u.full_name)]));
  const rolesOf = new Map<unknown, string[]>();
  for (const r of rowsOf(s, "user_roles")) rolesOf.set(r.user_id, [...(rolesOf.get(r.user_id) ?? []), cap(r.role)]);
  const requests = rowsOf(s, "blood_requests");
  const drives = rowsOf(s, "campus_blood_drives");
  const driveTitle = new Map(drives.map((d) => [d.id, text(d.title)]));
  const requestArea = new Map(requests.map((r) => [r.id, `${text(r.blood_group)} request, ${text(r.locality)}`]));
  const registrations = rowsOf(s, "campus_drive_registrations");
  const donations = rowsOf(s, "donations");
  const byNewest = (a: Row, b: Row) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  const count = (rows: Row[], key: string, value: string) => rows.filter((r) => r[key] === value).length;

  return [
    "# RaktSetu data report",
    "",
    `Generated ${formatDateTime(now.toISOString())}. Passwords and login tokens are never included.`,
    "",
    "## At a glance",
    "",
    table(
      ["What", "How many"],
      [
        ["People signed up", String(users.length)],
        ["Blood requests (active now)", `${requests.length} (${count(requests, "status", "active")})`],
        ["Requests fulfilled", String(count(requests, "status", "fulfilled"))],
        ["Registered donors (available now)", `${rowsOf(s, "donor_profiles").length} (${count(rowsOf(s, "donor_profiles"), "availability", "available")})`],
        ["Donations recorded", String(donations.length)],
        ["Blood drives", String(drives.length)],
      ],
    ),
    "## People",
    "",
    table(
      ["Name", "Email", "Roles", "Account", "Joined"],
      [...users].sort(byNewest).map((u) => [
        text(u.full_name),
        text(u.email),
        (rolesOf.get(u.id) ?? [cap(u.role)]).join(", "),
        cap(u.status),
        formatDate(String(u.created_at ?? "")),
      ]),
    ),
    "## Blood requests",
    "",
    table(
      ["Blood group", "What", "Area", "Urgency", "Needed by", "Status", "Requested by", "Created"],
      [...requests].sort(byNewest).map((r) => [
        text(r.blood_group),
        `${BLOOD_COMPONENT_LABELS[String(r.blood_component)] ?? cap(r.blood_component)}, ${text(r.units)} unit(s)`,
        text(r.locality),
        URGENCY_LABELS[String(r.urgency)] ?? cap(r.urgency),
        formatDateTime(String(r.required_by ?? "")),
        cap(r.status),
        nameOf.get(r.requester_id) ?? text(r.requester_name),
        formatDateTime(String(r.created_at ?? "")),
      ]),
    ),
    "## Donors",
    "",
    table(
      ["Name", "Blood group", "Area", "Availability", "Last donation", "Donations"],
      rowsOf(s, "donor_profiles").map((d) => [
        nameOf.get(d.user_id) ?? "—",
        text(d.blood_group),
        text(d.locality),
        cap(d.availability),
        formatDate(String(d.last_donation_date ?? "")),
        text(d.donation_count ?? 0),
      ]),
    ),
    "## Donations",
    "",
    table(
      ["Donor", "Date", "Units", "For"],
      [...donations].sort(byNewest).map((d) => [
        nameOf.get(d.donor_id) ?? "—",
        formatDate(String(d.donated_on ?? "")),
        text(d.units),
        driveTitle.get(d.drive_id) ?? requestArea.get(d.request_id) ?? "—",
      ]),
    ),
    "## Blood drives",
    "",
    table(
      ["Title", "Organiser", "Date", "Venue", "Area", "Status", "Registered"],
      [...drives].sort(byNewest).map((d) => [
        text(d.title),
        text(d.organizer),
        formatDate(String(d.drive_date ?? "")),
        text(d.venue),
        text(d.locality),
        cap(d.status),
        String(registrations.filter((g) => g.drive_id === d.id && g.status !== "cancelled").length),
      ]),
    ),
  ].join("\n");
}
