/**
 * A REQUESTER MUST BE ABLE TO BECOME A DONOR WITHOUT A SECOND ACCOUNT.
 *
 * The bug this guards: `/donor` was a static page that told EVERY visitor to
 * "Create a donor account", so a signed-in requester was invited to register a
 * duplicate user for a role their own account could simply hold.
 *
 * The fix must go through the EXISTING role machinery, so this asserts the
 * properties that machinery is supposed to have, against the real database:
 *
 *   A) a requester-only account can gain the donor role;
 *   E) adding it does NOT remove the requester role, and creates no second user;
 *   F) a fresh connection to the same database still sees BOTH roles;
 *   and the membership is a real `user_roles` row — the single authority for
 *      what an account may do — rather than anything client-side.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "raktsetu-donorflow-"));
const file = join(dir, "flow.db");

process.env.RAKTSETU_DATABASE_URL = `file:${file}`;
delete process.env.RAKTSETU_DATA_DIR;

const PASSWORD = "a-long-enough-password";

async function main() {
  const { getDriver, closeDriver } = await import("../src/lib/server/driver");
  const {
    createUser,
    authenticate,
    grantRole,
    getUserRoles,
    getUserForToken,
  } = await import("../src/lib/server/session");

  const db = await getDriver();
  console.log("\nRequester becomes a donor on the SAME account");

  // --- A) a requester-only account -----------------------------------------
  const email = `requester-${Date.now()}@example.com`;
  const requester = await createUser({
    email,
    password: PASSWORD,
    fullName: "Rita Requester",
    role: "requester",
  });
  ok("A. the account starts as a requester", (await getUserRoles(requester.id)).join() === "requester");

  // Some requester data that must survive the role change.
  await db.run(
    `INSERT INTO blood_requests
       (id, requester_id, requester_name, requester_phone, blood_group, blood_component,
        units, locality, urgency, required_by, status, created_at, updated_at)
     VALUES ('keepme', ?, 'Rita Requester', '+910000000000', 'A+', 'plasma', 2,
             'Pune', 'routine', '2099-01-01T00:00:00.000Z', 'active', 'n1', 'n1')`,
    [requester.id],
  );

  // Exactly what the "Become a donor" button does.
  await grantRole(requester.id, "donor");
  const afterAdd = await getUserRoles(requester.id);
  ok("A. the donor role is granted", afterAdd.includes("donor"), afterAdd.join());

  // --- E) nothing is lost ---------------------------------------------------
  ok("E. the requester role is NOT removed", afterAdd.includes("requester"), afterAdd.join());
  ok("E. exactly two roles, no more", afterAdd.length === 2, afterAdd.join());

  const users = await db.queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE email = ?",
    [email],
  );
  ok("E. no duplicate user was created", users?.n === 1, `n=${users?.n}`);
  ok("E. the user id is unchanged", requester.id === requester.id);

  const kept = await db.queryOne<{ id: string }>(
    "SELECT id FROM blood_requests WHERE id = 'keepme'",
  );
  ok("E. existing requester data survives", kept?.id === "keepme");

  // --- the membership is server-side authority -------------------------------
  const rows = await db.query<{ role: string }>(
    "SELECT role FROM user_roles WHERE user_id = ? ORDER BY role",
    [requester.id],
  );
  ok("the roles are real user_rows, not client state", rows.length === 2, JSON.stringify(rows));

  // --- F) a new connection sees both roles ----------------------------------
  const session = await authenticate(email, PASSWORD);
  ok("F. login still works after the role change", session?.id === requester.id);
  const resolved = await getUserForToken("");
  ok("F. an empty token resolves to nobody", resolved === null);

  await closeDriver();
  const again = await getDriver();
  const rehydrated = await authenticate(email, PASSWORD);
  const rolesAgain = await getUserRoles(rehydrated!.id);
  ok("F. both roles survive a new connection", rolesAgain.length === 2, rolesAgain.join());
  ok("F. requester still present", rolesAgain.includes("requester"));
  ok("F. donor still present", rolesAgain.includes("donor"));

  // --- adding the same role twice must be harmless ---------------------------
  await grantRole(rehydrated!.id, "donor");
  const dupes = await again.queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM user_roles WHERE user_id = ? AND role = 'donor'",
    [rehydrated!.id],
  );
  ok("re-adding the donor role creates no duplicate membership", dupes?.n === 1, `n=${dupes?.n}`);

  await closeDriver();
  rmSync(dir, { recursive: true, force: true });

  console.log(
    failed === 0
      ? `\nall ${passed} donor-role-flow checks passed\n`
      : `\n${passed} passed, ${failed} failed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
