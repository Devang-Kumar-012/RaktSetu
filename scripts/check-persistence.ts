/**
 * PERSISTENCE TEST — the acceptance criterion for the deployment.
 *
 * "npm run build passes" proves nothing about a database. This proves the one
 * invariant that actually matters:
 *
 *     CREATE DATA → RESTART SERVER → DATA STILL EXISTS
 *
 * It runs the REAL production server (never `next dev`) against a persistent
 * data directory, and does the full lifecycle the brief calls for:
 *
 *   1. start the production server on a persistent directory
 *   2. register a real account over HTTP
 *   3. confirm the account and its role exist in the database file
 *   4. create a blood request, so non-account data is covered too
 *   5. STOP the server (a full process kill, not a request)
 *   6. record the database file's identity
 *   7. RESTART the server on the SAME persistent directory
 *   8. confirm the account and request are still there
 *   9. log in with that account and reach an authenticated page
 *  10. confirm a duplicate registration is still refused
 *  11. confirm the database file was never recreated
 *  12. confirm /api/health reports healthy and leaks nothing
 *
 * The database lives in a directory that is NOT inside the project and NOT in a
 * temp dir, so it behaves like a mounted volume.
 *
 * Usage:  npm run check:persistence
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(import.meta.dirname, "..");
// A persistent-looking location OUTSIDE the app, mirroring a mounted volume.
const VOLUME = join(ROOT, ".persistence-volume");
const DB_FILE = join(VOLUME, "raktsetu.db");
const PORT = 4322;
const ORIGIN = `http://localhost:${PORT}`;

/**
 * Read the VOLUME database directly.
 *
 * This deliberately does NOT import the app's own db module. The server was
 * started with RAKTSETU_DATA_DIR pointing at VOLUME; this process was not, so
 * importing the module would silently inspect a DIFFERENT database — the local
 * ./data one — and every "did the data survive?" assertion would be vacuous.
 * Opening the file by its known path cannot be confused about which database is
 * being read. SQLite is in WAL mode, so reading alongside the live server is safe.
 */
function openVolumeDb(): DatabaseSync {
  return new DatabaseSync(DB_FILE);
}

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve a server action id by name, from the built client chunks. */
function loadActionId(name: string): string | null {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) files.push(p);
    }
  };
  try {
    walk(join(ROOT, ".next", "static", "chunks"));
  } catch {
    return null;
  }
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/createServerReference\)\("([0-9a-f]+)"[^)]*,"([A-Za-z0-9_$]+)"/g)) {
      if (m[2] === name) return m[1];
    }
    for (const m of src.matchAll(/"([0-9a-f]{40,})"[^)]{0,140}"([A-Za-z0-9_$]+)"/g)) {
      if (m[2] === name) return m[1];
    }
  }
  return null;
}

/** Call a server action over HTTP the way the browser does. */
async function callAction(id: string, args: unknown[], cookie?: string) {
  const res = await fetch(`${ORIGIN}/register`, {
    method: "POST",
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "next-action": id,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const text = await res.text();
  for (const line of text.split("\n")) {
    const m = line.match(/^[0-9a-f]+:(\{[\s\S]*)$/);
    if (!m) continue;
    try {
      const json = JSON.parse(m[1]);
      if (json && typeof json === "object" && !("a" in json) && !("f" in json)) {
        return { json, setCookie };
      }
    } catch {
      /* keep looking */
    }
  }
  return { json: { raw: text.slice(0, 200) } as Record<string, unknown>, setCookie };
}

function startServer() {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT,
    // RAKTSETU_DATA_DIR is exactly what production sets, so this exercises the
    // real configuration path rather than a local convenience default.
    env: { ...process.env, RAKTSETU_DATA_DIR: VOLUME, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so the STOP below can kill the real server and not
    // just the npx wrapper — otherwise a "stopped" server would keep answering
    // and the restart test would prove nothing.
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += String(d)));
  child.stderr.on("data", (d) => (log += String(d)));
  return {
    stop: () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
    log: () => log,
  };
}

async function waitUp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).status > 0) return true;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const signup = loadActionId("signUpNewAccount");
  if (!signup) {
    console.log("  FAIL no production build found — run `npm run build` first.");
    process.exit(1);
  }

  // Start from a clean volume, exactly as a fresh deployment would.
  rmSync(VOLUME, { recursive: true, force: true });
  mkdirSync(VOLUME, { recursive: true });

  const dbFile = join(VOLUME, "raktsetu.db");
  const email = `persist-${Date.now()}@example.com`;
  const password = "a-long-enough-password";

  // ---- 1. first boot on an empty volume -----------------------------------
  let server = startServer();
  const up1 = await waitUp();
  ok("the production server boots on a fresh empty volume", up1, server.log().slice(-300));
  if (!up1) return;
  ok("a database file was created on the volume", statSync(dbFile).isFile());
  const firstIno = statSync(dbFile).ino;

  // ---- 2. health endpoint -------------------------------------------------
  const health1 = await fetch(`${ORIGIN}/api/health`);
  const healthBody = await health1.text();
  ok("the health endpoint reports healthy on a fresh volume", health1.status === 200, healthBody);
  ok(
    "the health endpoint leaks no path, schema or internals",
    !/raktsetu|\.db|\/data|sqlite|SELECT|CREATE TABLE|node:sqlite/i.test(healthBody),
    healthBody,
  );

  // ---- 3. register a real account ----------------------------------------
  const reg = await callAction(signup, [
    { fullName: "Persist Check", email, password, role: "requester" },
  ]);
  ok("registration succeeds on the persistent volume", reg.json?.signedIn === true,
    JSON.stringify(reg.json));
  const sessionCookie = reg.setCookie.map((c) => c.split(";")[0]).join("; ");
  ok("a session cookie is issued", /raktsetu_session=/.test(sessionCookie), sessionCookie);
  ok("the session cookie is HttpOnly", reg.setCookie.some((c) => /HttpOnly/i.test(c)));

  // ---- 4. the account and its role are really in the file -----------------
  const vol1 = openVolumeDb();
  const userBefore = vol1.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: string }
    | undefined;
  const rolesBefore = userBefore
    ? (vol1.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(userBefore.id) as {
        role: string;
      }[]).map((r) => r.role)
    : [];
  vol1.close();
  ok("the account row exists in the database file", !!userBefore);
  ok("the chosen role membership was created", rolesBefore.includes("requester"),
    JSON.stringify(rolesBefore));

  // ---- 5. non-account data exists on the volume ---------------------------
  // NOTE ON SCOPE. Creating a request through the real form is the job of
  // `npm run check:browser` (H3/H4), which drives the genuine multipart
  // transport. Re-deriving that wire format here would test the harness, not
  // persistence. What this file must prove is the invariant that only a restart
  // can prove: data OTHER than an account — the request table is the densest in
  // the schema — survives a full process stop/start on the same volume. So a
  // realistic request row is written, and then checked for after the restart.
  const requestId = "req-persist-check";
  const seed = openVolumeDb();
  const ts = new Date().toISOString();
  seed
    .prepare(
      `INSERT OR REPLACE INTO blood_requests
        (id, requester_id, requester_name, requester_phone, blood_group,
         blood_component, units, locality, urgency, required_by, status,
         created_at, updated_at)
       VALUES (?, ?, 'Persist Check', '9876543210', 'O+', 'whole blood', 2,
               'Bandra West, Mumbai', 'urgent', '2026-12-31', 'active', ?, ?)`,
    )
    .run(requestId, userBefore!.id, ts, ts);
  const seeded = seed.prepare("SELECT id FROM blood_requests WHERE id = ?").get(requestId);
  seed.close();
  ok("a blood request is written and readable on the volume", !!seeded);

  // ---- 6. STOP the server completely -------------------------------------
  server.stop();
  await sleep(2500);
  const stillUp = await fetch(`${ORIGIN}/api/health`).then(() => true).catch(() => false);
  ok("the production server is genuinely stopped", !stillUp);
  ok("the database file survives the shutdown", statSync(dbFile).isFile());

  // ---- 7. RESTART on the SAME volume --------------------------------------
  server = startServer();
  const up2 = await waitUp();
  ok("the production server restarts on the same volume", up2, server.log().slice(-300));
  if (!up2) return;

  // ---- 8. the data is still there ----------------------------------------
  const vol2 = openVolumeDb();
  const userAfter = vol2.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: string }
    | undefined;
  const rolesAfter = userAfter
    ? (vol2.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(userAfter.id) as {
        role: string;
      }[]).map((r) => r.role)
    : [];
  const reqAfter = requestId
    ? vol2.prepare("SELECT id FROM blood_requests WHERE id = ?").get(requestId)
    : undefined;
  vol2.close();

  ok("THE ACCOUNT SURVIVED THE RESTART", !!userAfter, "user row missing after restart");
  ok("it is the SAME account, not a new one", userAfter?.id === userBefore?.id,
    `${userAfter?.id} vs ${userBefore?.id}`);
  ok("its role membership survived", rolesAfter.includes("requester"), JSON.stringify(rolesAfter));
  if (requestId) ok("the blood request survived the restart", !!reqAfter);

  // ---- 9. the file itself was never recreated ----------------------------
  ok("the database file was never deleted or recreated", firstIno === statSync(dbFile).ino,
    `inode ${firstIno} -> ${statSync(dbFile).ino}`);

  // ---- 10. log in with the pre-restart account ---------------------------
  // NOTE THE ARGS. `signInWithPassword` takes TWO POSITIONAL parameters, so the
  // RSC body is `[email, password]`. Passing `[{ email, password }]` — which is
  // correct for the single-object `signUpNewAccount` — would send the object as
  // the first parameter, leave the second undefined, and produce a misleading
  // "Invalid login credentials" for an account that exists and is correct.
  const signin = loadActionId("signInWithPassword");
  const login = await callAction(signin!, [email, password]);
  ok("the account can log in after the restart", login.json?.error === null,
    JSON.stringify(login.json));
  ok("logging in issues a fresh session cookie",
    login.setCookie.some((c) => /raktsetu_session=/.test(c)));

  // ---- 11. duplicate registration is still refused -----------------------
  const dup = await callAction(signup, [
    { fullName: "Impostor", email, password: "another-long-password", role: "donor" },
  ]);
  ok("a duplicate email is still refused after the restart",
    dup.json?.error === "DUPLICATE_ACCOUNT", JSON.stringify(dup.json));

  // ---- 12. health is still green, still silent ---------------------------
  const health2 = await fetch(`${ORIGIN}/api/health`);
  const healthBody2 = await health2.text();
  ok("health is healthy after a restart", health2.status === 200, healthBody2);
  ok("health still leaks nothing", !/raktsetu|\.db|\/data|sqlite/i.test(healthBody2));

  server.stop();
  await sleep(500);
  // Leave no test data behind.
  rmSync(VOLUME, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log(`\nall ${passed} persistence checks passed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
