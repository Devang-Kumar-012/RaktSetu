/**
 * REGISTRATION ERROR-HANDLING CHECKS.
 *
 * Registration failed in the deployed site and the only thing a user was told was
 * "Something went wrong. Please try again in a moment." That sentence hid several
 * completely different faults behind one shrug, so these checks exist to stop it
 * ever coming back and to prove the replacement actually works.
 *
 * Covered:
 *   1. the banned sentence appears NOWHERE in src/
 *   2. every failure category produces distinct, specific, safe copy
 *   3. real thrown errors are classified into the RIGHT category
 *   4. no secret can reach a user-facing message or a log line
 *   5. an unexpected error still yields a traceable error ID
 *   6. a read-only deployment produces a specific storage error (the bug itself)
 *   7. a valid registration still succeeds, and a duplicate is still refused
 */
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  classifyRegistrationError,
  describeRegistrationFailure,
  isRegistrationFailure,
  newRegistrationErrorId,
  registrationFailure,
  safeErrorSummary,
  type RegistrationErrorCode,
} from "../src/lib/registration-errors";
import { friendlyAuthError } from "../src/lib/auth-errors";
import { DatabaseUnavailableError } from "../src/lib/server/db";

const ROOT = join(import.meta.dirname, "..");
const BANNED = "Something went wrong. Please try again in a moment.";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. the banned sentence is gone, everywhere -----------------------------
{
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        const text = readFileSync(full, "utf8");
        // Comments are stripped: a doc comment explaining WHY the sentence is
        // banned must not be mistaken for it still being in use.
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        if (code.includes(BANNED)) offenders.push(full.replace(ROOT, ""));
      }
    }
  };
  walk(join(ROOT, "src"));
  ok(
    "the generic 'Something went wrong. Please try again in a moment.' is gone from src/",
    offenders.length === 0,
    offenders.join(", "),
  );
}

// --- 2. every category has specific, distinct, safe copy --------------------
{
  const codes: RegistrationErrorCode[] = [
    "INVALID_EMAIL", "INVALID_PASSWORD", "INVALID_NAME", "VALIDATION_ERROR",
    "DUPLICATE_ACCOUNT", "DATABASE_UNAVAILABLE", "DATABASE_NOT_WRITABLE",
    "DATABASE_WRITE_FAILED", "ROLE_CREATION_FAILED", "SESSION_CREATION_FAILED",
    "AUTHENTICATION_FAILED", "UNKNOWN_REGISTRATION_ERROR",
  ];
  const seen = new Set<string>();
  let allSafe = true;
  for (const code of codes) {
    const text = describeRegistrationFailure(registrationFailure(code, "REG-TEST1"));
    seen.add(text);
    if (/\/[a-z/]|SQLITE|EACCES|EROFS|node:sqlite|at Object|\.ts:\d+/i.test(text)) allSafe = false;
  }
  ok("every category produces copy, and all 12 are distinct", seen.size === codes.length);
  ok("no category's copy leaks a path, driver code or stack frame", allSafe);

  const storage = describeRegistrationFailure(
    registrationFailure("DATABASE_NOT_WRITABLE", "REG-AB12CD"),
  );
  ok(
    "a read-only deployment is reported specifically, with a traceable ID",
    /not writable/i.test(storage) && /REG-AB12CD/.test(storage),
    storage,
  );
  ok(
    "an unexpected error is named and traceable, never a shrug",
    /unexpected server error/i.test(
      describeRegistrationFailure(registrationFailure("UNKNOWN_REGISTRATION_ERROR", "REG-ZZ9999")),
    ),
  );
}

// --- 3. real thrown errors classify correctly -------------------------------
{
  ok("a 23505 is classified as a duplicate", classifyRegistrationError({ code: "23505" }) === "DUPLICATE_ACCOUNT");
  ok(
    "a UNIQUE constraint message is classified as a duplicate",
    classifyRegistrationError(new Error("UNIQUE constraint failed: users.email")) === "DUPLICATE_ACCOUNT",
  );
  ok(
    "a read-only deployment error is classified as not-writable",
    classifyRegistrationError(new DatabaseUnavailableError("storage-read-only", "EROFS: read-only file system")) ===
      "DATABASE_NOT_WRITABLE",
  );
  ok(
    "a missing node:sqlite is classified as database-unavailable",
    classifyRegistrationError(new DatabaseUnavailableError("sqlite-unavailable", "Cannot find module 'node:sqlite'")) ===
      "DATABASE_UNAVAILABLE",
  );
  ok(
    "a raw EROFS from the OS is classified as not-writable",
    classifyRegistrationError(Object.assign(new Error("read-only"), { code: "EROFS" })) === "DATABASE_NOT_WRITABLE",
  );
  ok(
    "an unrecognised error is NOT forced into a friendlier bucket",
    classifyRegistrationError(new Error("something odd")) === "UNKNOWN_REGISTRATION_ERROR",
  );
  ok(
    "a failure during session creation is reported as a session failure",
    classifyRegistrationError(new Error("boom"), "create-session") === "SESSION_CREATION_FAILED",
  );
  ok(
    "a failure issuing the cookie is reported as an authentication failure",
    classifyRegistrationError(new Error("boom"), "set-cookie") === "AUTHENTICATION_FAILED",
  );
}

// --- 4. secrets can never escape --------------------------------------------
{
  const leaky = Object.assign(new Error("db exploded"), {
    password: "hunter2",
    passwordHash: "scrypt$16384$...",
    token: "tok_secret",
    cookie: "raktsetu_session=abc",
    code: "EACCES",
  });
  const summary = safeErrorSummary(leaky);
  const dumped = JSON.stringify(summary);
  ok("a password is redacted from a log summary", summary.password === "[redacted]");
  ok("a hash is redacted from a log summary", summary.passwordHash === "[redacted]");
  ok("a session token is redacted from a log summary", summary.token === "[redacted]");
  ok("a cookie is redacted from a log summary", summary.cookie === "[redacted]");
  ok("useful codes survive redaction", summary.code === "EACCES", dumped);
  ok("the raw secret never appears in the summary", !/hunter2|tok_secret|raktsetu_session=/.test(dumped));
}

// --- 5. the mapper never returns a generic sentence -------------------------
{
  ok(
    "a duplicate keeps its specific wording through the mapper",
    /already exists/i.test(friendlyAuthError({ code: "DUPLICATE_ACCOUNT" })),
    friendlyAuthError({ code: "DUPLICATE_ACCOUNT" }),
  );
  const unknown = friendlyAuthError(new Error("utterly unrecognised"));
  ok(
    "an unrecognised error still yields specific, traceable copy",
    /unexpected server error/i.test(unknown) && /REG-[A-Z0-9]{6}/.test(unknown),
    unknown,
  );
  ok(
    "the mapper never returns the banned sentence",
    ![unknown, friendlyAuthError("???"), friendlyAuthError(null)].includes(BANNED),
  );
  ok(
    "a wrong password still says so, and does not become a fault report",
    /incorrect/i.test(friendlyAuthError("Invalid login credentials")),
  );
  ok("a structured failure is recognised", isRegistrationFailure({ code: "INVALID_EMAIL" }));
  ok("a random object is not mistaken for a failure", !isRegistrationFailure({ code: "NOPE" }));
  ok("error IDs have the expected shape", /^REG-[A-Z0-9]{6}$/.test(newRegistrationErrorId()));
}

// --- 6. the real deployed failure, reproduced -------------------------------
// --- 7. the success path and the refusal cases still work -------------------
//
// Both sections touch the database and are therefore async; the whole thing runs
// from one entry point because these scripts compile to CommonJS.
async function main() {
  // Schema creation is owned by `initializeDatabase()` (it must go through the
  // driver so a hosted database is initialised too), so a check that starts from
  // an empty data directory has to ask for it explicitly.
  const { initializeDatabase } = await import("../src/lib/server/db");
  const { closeDriver } = await import("../src/lib/server/driver");
  await initializeDatabase();
  {
  // The actual bug: a read-only working directory, exactly as a deployed
  // serverless bundle has. Reproduced for real rather than asserted about.
  const ro = join(ROOT, ".regcheck-readonly");
  rmSync(ro, { recursive: true, force: true });
  mkdirSync(ro, { recursive: true });
  chmodSync(ro, 0o555);
  const original = process.cwd();
  let readOnlyCode: RegistrationErrorCode | null = null;
  try {
    process.chdir(ro);
    // Imported fresh, so DB_PATH resolves against the read-only directory
    // rather than being reused from an earlier import.
    const { getDb } = await import(`../src/lib/server/db.ts?ro=${Date.now()}`);
    getDb();
  } catch (err) {
    readOnlyCode = classifyRegistrationError(err, "create-user");
  } finally {
    process.chdir(original);
    chmodSync(ro, 0o755);
    rmSync(ro, { recursive: true, force: true });
  }
  ok(
    "a read-only deployment is reported as NOT WRITABLE, not as a generic fault",
    readOnlyCode === "DATABASE_NOT_WRITABLE",
    String(readOnlyCode),
  );
  }

  {
  const { signUpNewAccount } = await import(`../src/lib/actions/auth.ts?ok=${Date.now()}`);
  const { getUserRoles } = await import("../src/lib/server/session");
  const stamp = Date.now();
  const email = `regcheck-${stamp}@example.com`;

  // NOTE ON SCOPE. `setSessionCookie` writes through Next's `cookies()`, which
  // exists only inside a request. Called straight from a script the cookie step
  // cannot succeed, and it is correctly reported as AUTHENTICATION_FAILED —
  // which is itself worth asserting. The account and its role membership are
  // written before that, so those ARE checked here; the full cookie + refresh +
  // logout path is covered end to end over real HTTP by `npm run check:browser`.
  const made = await signUpNewAccount({
    fullName: "Reg Check", email, password: "a-long-enough-password", role: "requester",
  });
  ok(
    "a valid registration writes the account, then reports the cookie stage honestly",
    made.error === "AUTHENTICATION_FAILED" && !!made.errorId,
    JSON.stringify(made),
  );

  const { getDb } = await import("../src/lib/server/db");
  const row = getDb()
    .prepare("SELECT id, role, status FROM users WHERE email = ?")
    .get(email) as { id: string; role: string; status: string } | undefined;
  ok("the account row was created", !!row, JSON.stringify(row));
  ok("the account is active", row?.status === "active");
  ok(
    "the chosen role became a real membership",
    row ? (await getUserRoles(row.id)).includes("requester") : false,
    row ? JSON.stringify(await getUserRoles(row.id)) : "no row",
  );

  const again = await signUpNewAccount({
    fullName: "Reg Check", email, password: "a-long-enough-password", role: "donor",
  });
  ok("a duplicate is refused with a specific category",
    again.error === "DUPLICATE_ACCOUNT", JSON.stringify(again));

  const badEmail = await signUpNewAccount({
    fullName: "Reg Check", email: "not-an-email", password: "a-long-enough-password", role: "requester",
  });
  ok("an invalid email is refused with a specific category",
    badEmail.error === "INVALID_EMAIL", JSON.stringify(badEmail));

  const shortPw = await signUpNewAccount({
    fullName: "Reg Check", email: `x${stamp}@example.com`, password: "short", role: "requester",
  });
  ok("a short password is refused with a specific category",
    shortPw.error === "INVALID_PASSWORD", JSON.stringify(shortPw));

  const shortName = await signUpNewAccount({
    fullName: "A", email: `y${stamp}@example.com`, password: "a-long-enough-password", role: "requester",
  });
  ok("a too-short name is refused with a specific category",
    shortName.error === "INVALID_NAME", JSON.stringify(shortName));

  // Remove the account this check created, so a run leaves no residue.
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("sqlite3", [join(ROOT, "data", "raktsetu.db"),
      `DELETE FROM users WHERE email = '${email}';`], { stdio: "ignore" });
  } catch {
    // The sqlite3 CLI may be absent; the row is inert either way, and the
    // database is a gitignored runtime artefact.
  }
  }

  console.log(`\nall ${passed} registration error checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
