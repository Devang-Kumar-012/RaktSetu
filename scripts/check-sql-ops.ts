/**
 * The server rpc functions that used to read the (always empty on the server)
 * browser store now read and write SQL: volunteer views, verifications, admin
 * views and drive stats.
 *
 * Usage: npm run check:sql-ops
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "raktsetu-ops-"));
process.env.RAKTSETU_DATA_DIR = dir;
delete process.env.RAKTSETU_DATABASE_URL;

async function main() {
  const { getDriver, closeDriver } = await import("../src/lib/server/driver");
  const { runServerOpsRpc } = await import("../src/lib/server/sql-ops");
  const db = await getDriver();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();

  // Fixed-format ids: the verification actions only accept 36-char uuids.
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [requester, vol1, vol2, admin, donor, request, drive] = [1, 2, 3, 4, 5, 6, 7].map(id);
  for (const [uid, role] of [
    [requester, "requester"],
    [vol1, "volunteer"],
    [vol2, "volunteer"],
    [admin, "admin"],
    [donor, "donor"],
  ]) {
    await db.run(
      "INSERT INTO users (id, email, password_hash, full_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [uid, `${uid}@x.test`, "h", uid, role, now, now],
    );
    await db.run("INSERT INTO user_roles (user_id, role, is_primary, created_at) VALUES (?,?,1,?)", [uid, role, now]);
  }
  await db.run(
    `INSERT INTO blood_requests (id, requester_id, requester_name, requester_phone, blood_group, blood_component,
       units, locality, urgency, required_by, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)`,
    [request, requester, "R", "9999999999", "O+", "whole_blood", 2, "Indiranagar", "urgent", later, now, now],
  );

  const V1 = { id: vol1, role: "volunteer" };
  const V2 = { id: vol2, role: "volunteer" };
  const A = { id: admin, role: "admin" };
  const D = { id: donor, role: "donor" };
  const rpc = async (name: string, args: Record<string, unknown>, caller: { id: string; role: string }) =>
    (await runServerOpsRpc(name, args, caller))?.data;

  // Volunteer views read real rows (they used to be empty on the server).
  const active = (await rpc("volunteer_active_requests", {}, V1)) as Array<Record<string, unknown>>;
  assert.equal(active.length, 1, "a volunteer sees the active request");
  assert.equal(active[0].me_assisting, false);
  assert.deepEqual(await rpc("volunteer_active_requests", {}, D), [], "a donor gets nothing");

  // Verification: start, one pending per request, only the owner completes/escalates.
  assert.equal(await rpc("start_volunteer_verification", { p_request_id: request }, D), "volunteer_inactive");
  assert.equal(await rpc("start_volunteer_verification", { p_request_id: request }, V1), "success");
  assert.equal(await rpc("start_volunteer_verification", { p_request_id: request }, V2), "already_pending");
  const pending = (await rpc("my_pending_verifications", {}, V1)) as Array<Record<string, unknown>>;
  assert.equal(pending.length, 1, "the task shows in the volunteer's queue");
  assert.ok(Number(pending[0].minutes_left) <= 15);
  assert.equal(
    await rpc("complete_volunteer_verification", { p_request_id: request, p_outcome: "verified" }, V2),
    "not_your_task",
  );
  assert.equal(
    await rpc("escalate_volunteer_verification", { p_request_id: request, p_target_volunteer_id: vol1 }, V1),
    "self_target",
  );
  assert.equal(
    await rpc("escalate_volunteer_verification", { p_request_id: request, p_target_volunteer_id: donor }, V1),
    "invalid_target",
  );
  assert.equal(
    await rpc("escalate_volunteer_verification", { p_request_id: request, p_target_volunteer_id: vol2 }, V1),
    "success",
  );
  assert.deepEqual(await rpc("my_pending_verifications", {}, V1), [], "the escalated task leaves the old queue");
  assert.equal(
    await rpc("complete_volunteer_verification", { p_request_id: request, p_outcome: "verified" }, V2),
    "success_verified",
  );
  assert.equal(await rpc("start_volunteer_verification", { p_request_id: request }, V1), "already_verified");

  // Admin views: counted from stored records, refused to non-admins.
  const [overview] = (await rpc("admin_platform_overview", {}, A)) as Array<Record<string, number>>;
  assert.equal(overview.total_users, 6, "five fixtures plus the seeded demo admin");
  assert.equal(overview.total_volunteers, 2);
  assert.equal(overview.active_requests, 1);
  assert.deepEqual(await rpc("admin_platform_overview", {}, V1), [], "a non-admin gets nothing");
  assert.deepEqual(await rpc("admin_list_alerts", {}, A), []);

  await db.run(
    `INSERT INTO campus_blood_drives (id, title, organizer, drive_date, starts_at, venue, locality, target_units,
       created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [drive, "Drive", "Org", now.slice(0, 10), now, "Hall", "Indiranagar", 20, now, now],
  );
  await db.run(
    "INSERT INTO campus_drive_registrations (id, drive_id, donor_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    [id(8), drive, donor, "checked_in", now, now],
  );
  await db.run("INSERT INTO donor_profiles (user_id, blood_group, locality, created_at, updated_at) VALUES (?,?,?,?,?)", [
    donor,
    "O+",
    "Indiranagar",
    now,
    now,
  ]);
  const [stats] = (await rpc("campus_drive_stats", { p_drive_id: drive }, A)) as Array<Record<string, unknown>>;
  assert.equal(stats.registered, 0);
  assert.equal(stats.checked_in, 1);
  assert.equal(stats.target_units, 20);
  assert.deepEqual(stats.group_breakdown, { "O+": 1 });

  assert.equal(await runServerOpsRpc("no_such_function", {}, A), null, "unknown names are reported, not faked");

  // A database created before 'cancelled' existed is upgraded on open, keeping its rows.
  await db.exec(`ALTER TABLE campus_drive_registrations RENAME TO r_old;
    CREATE TABLE campus_drive_registrations (
      id TEXT PRIMARY KEY, drive_id TEXT NOT NULL, donor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','checked_in','participated','absent')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (drive_id, donor_id));
    INSERT INTO campus_drive_registrations SELECT * FROM r_old; DROP TABLE r_old;`);
  await closeDriver();
  const reopened = await getDriver();
  await reopened.run("UPDATE campus_drive_registrations SET status = 'cancelled' WHERE drive_id = ?", [drive]);
  const row = (await reopened.queryOne("SELECT status FROM campus_drive_registrations WHERE drive_id = ?", [drive])) as {
    status: string;
  };
  assert.equal(row.status, "cancelled", "an old database is migrated so a donor can cancel a drive registration");

  await closeDriver();
  rmSync(dir, { recursive: true, force: true });
  console.log("sql ops checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
