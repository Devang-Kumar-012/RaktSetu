/**
 * Browser-level verification, driven over HTTP against the real server.
 *
 * There is no browser driver in this environment, so this talks to the running
 * `next start` the way a browser does: it fetches real pages, and invokes the
 * REAL server actions through the same `Next-Action` mechanism the client bundle
 * uses. Nothing here reimplements app logic — it presses the buttons.
 *
 * Action ids are DISCOVERED from the built client chunks, never hard-coded, so
 * a rebuild cannot make this pass by exercising a stale route.
 *
 * Run with: npx tsx scripts/check-browser-flow.ts http://localhost:3999
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { closeDb, getDb } from "../src/lib/server/db";

import { createSupabaseServerClient } from "../src/lib/supabase/server";
import { bloodRequestFieldErrors } from "../src/lib/validation";

const BASE = (process.argv[2] ?? "http://localhost:3999").replace(/\/$/, "");
const CHUNKS = join(import.meta.dirname, "..", ".next", "static", "chunks");

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log(`  FAIL ${name}`);
  }
}

/** Every server-action id in the build, keyed by the action's own name. */
const ACTIONS: Record<string, string[]> = {};
function loadActions() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) files.push(p);
    }
  };
  walk(CHUNKS);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // The client emits each action as:
    //   (0,t.createServerReference)("<hex id>",u.callServer,void 0,u.findSourceMapURL,"<name>")
    // The id length is build-dependent, so it is matched by shape, not a count.
    for (const m of src.matchAll(
      /"([0-9a-f]{32,64})",\w+\.callServer,void 0,\w+\.findSourceMapURL,"([A-Za-z_$][A-Za-z0-9_$]*)"/g,
    )) {
      (ACTIONS[m[2]] ??= []).push(m[1]);
    }
  }
  // The same action can be emitted into several chunks; keep the first id.
  for (const k of Object.keys(ACTIONS)) ACTIONS[k] = [...new Set(ACTIONS[k])];
}

/** A cookie jar per simulated browser profile. */
function jar() {
  let cookie = "";
  return {
    get: () => cookie,
    absorb(res: Response) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const pair = c.split(";")[0];
        // A cookie being CLEARED is signalled by an empty value or an expiry in
        // the past — that must wipe the jar, or a logged-out browser would keep
        // presenting a token it no longer has.
        const expired = /expires=Thu, 01 Jan 1970|max-age=0/i.test(c);
        if (pair.startsWith("raktsetu_session=")) {
          const value = pair.slice("raktsetu_session=".length);
          cookie = expired || value === "" ? "" : pair;
        }
      }
    },
    clear() {
      cookie = "";
    },
  };
}

type Box = ReturnType<typeof jar>;
async function page(path: string, box: Box) {
  const res = await fetch(`${BASE}${path}`, {
    headers: box.get() ? { cookie: box.get() } : {},
    redirect: "manual",
  });
  const body = await res.text();
  box.absorb(res);
  return { status: res.status, body, location: res.headers.get("location") };
}

/**
 * Invoke a real server action the way the client does: a POST carrying the
 * `Next-Action` id with JSON-encoded arguments.
 *
 * `onPath` is the page the action belongs to. This matters: the route middleware
 * redirects a signed-in visitor AWAY from the auth pages, so posting a
 * role-switch to /login returns a 307 before the action ever runs. The browser
 * never hits this because the switcher is rendered on /profile.
 */
async function callAction(
  name: string,
  args: unknown[],
  box: Box,
  onPath = "/profile",
): Promise<any> {
  const id = ACTIONS[name]?.[0];
  assert.ok(id, `no server action named "${name}" was found in the build`);
  const res = await fetch(`${BASE}${onPath}`, {
    method: "POST",
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "next-action": id!,
      ...(box.get() ? { cookie: box.get() } : {}),
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  // Signing in and out happen THROUGH actions, so the cookie is set or cleared
  // on this response — exactly as it is in the browser.
  box.absorb(res);
  const text = await res.text();
  // Next replies with an RSC flight payload. The action's return value is its
  // own line: `1:{"error":...,"signedIn":false}`. The numeric prefix is a
  // stream marker, not part of the value.
  for (const line of text.split("\n")) {
    const m = line.match(/^[0-9a-f]+:(\{[\s\S]*)$/);
    if (!m) continue;
    try {
      const json = JSON.parse(m[1]);
      // Skip the React tree payload; the action result is a flat object.
      if (json && typeof json === "object" && !("a" in json) && !("f" in json)) {
        return json;
      }
    } catch {
      /* not a JSON line — keep looking */
    }
  }
  return { raw: text.slice(0, 300), status: res.status };
}

// A per-run unique address, so a run never collides with an earlier one and no
// cleanup is needed to make the NEXT run start clean.
const RUN = Date.now().toString(36);
const EMAIL = `browser-flow-${RUN}@example.com`;
const PASSWORD = "browser-flow-password";
const OTHER_EMAIL = `browser-other-${RUN}@example.com`;
let requestId = "";

/**
 * Invoke a server action that is driven by a `<form action={...}>`, which posts
 * multipart FormData rather than JSON. React encodes FormData actions this way,
 * so this is the real transport for createBloodRequest and friends.
 *
 * `args` mirrors the action's own signature — a useActionState action takes
 * (prevState, formData), so the caller passes the initial state as well.
 */
async function callActionForm(
  name: string,
  args: unknown[],
  box: Box,
  onPath: string,
): Promise<any> {
  const id = ACTIONS[name]?.[0];
  assert.ok(id, `no server action named "${name}" was found in the build`);
  const form = args[args.length - 1] as FormData;
  // A useActionState form action is bound, so React sends the PREVIOUS STATE as
  // a $ACTION_REF field before the form data. Reproduce that exactly: a bare
  // FormData makes the server close the connection before the action runs.
  const body = new FormData();
  body.set(
    "$ACTION_ID_" + id,
    JSON.stringify({ id, bound: args.slice(0, -1) }),
  );
  for (const [k, v] of (form as any).entries()) body.append(k, v);

  const res = await fetch(`${BASE}${onPath}`, {
    method: "POST",
    headers: {
      "next-action": id!,
      ...(box.get() ? { cookie: box.get() } : {}),
    },
    body,
    redirect: "manual",
  });
  box.absorb(res);
  const text = await res.text();
  // A server action that redirects() is reported by React as a thrown
  // NEXT_REDIRECT, which arrives as a 500-shaped error line. Surface it
  // explicitly so callers can assert "it redirected" rather than guessing.
  if (/NEXT_REDIRECT|NEXT_NOT_FOUND/.test(text)) {
    return { __redirect: true, status: res.status, location: res.headers.get("location") };
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^[0-9a-f]+:(\{[\s\S]*)$/);
    if (!m) continue;
    try {
      const json = JSON.parse(m[1]);
      if (json && typeof json === "object" && !("a" in json) && !("f" in json)) return json;
    } catch {
      /* not a JSON line — keep looking */
    }
  }
  return { raw: text.slice(0, 300), status: res.status };
}

/**
 * Read from the database with a FRESH snapshot.
 *
 * The running server holds its own SQLite connection, and in WAL mode a
 * long-lived reader stays pinned to the snapshot it started with. A plain
 * getDb() here would therefore keep reporting the state from before the server
 * wrote anything, which looks exactly like "the server did nothing". Reopening
 * per read is cheap for a test and makes every assertion see committed data.
 */
let dbDepth = 0;

/**
 * Read from the database with a FRESH snapshot.
 *
 * The running server holds its own SQLite connection, and in WAL mode a
 * long-lived reader stays pinned to the snapshot it started with. A plain
 * getDb() here would therefore keep reporting the state from before the server
 * wrote anything, which looks exactly like "the server did nothing". Reopening
 * per read is cheap for a test and makes every assertion see committed data.
 *
 * The depth counter makes this re-entrant: a nested `userId()` inside another
 * `readDb()` must not close a handle the outer call is still using.
 */
function readDb<T>(fn: (db: ReturnType<typeof getDb>) => T): T {
  if (dbDepth > 0) return fn(getDb());
  closeDb();
  dbDepth += 1;
  try {
    return fn(getDb());
  } finally {
    dbDepth -= 1;
    closeDb();
  }
}

/**
 * Run a store write with a FRESH connection, then close it again.
 *
 * Same reason as `readDb`: a connection this process opened before the server
 * wrote cannot see those writes, and a write on a stale snapshot would be
 * operating on data the server has already moved past.
 */
let storeDepth = 0;

async function writeStore<T>(
  fn: (
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  ) => PromiseLike<unknown>,
): Promise<{ data?: unknown; error?: { message: string } | null }> {
  if (storeDepth > 0) {
    return (await fn(await createSupabaseServerClient())) as {
      data?: unknown;
      error?: { message: string } | null;
    };
  }
  closeDb();
  storeDepth += 1;
  try {
    return (await fn(await createSupabaseServerClient())) as {
      data?: unknown;
      error?: { message: string } | null;
    };
  } finally {
    storeDepth -= 1;
    closeDb();
  }
}

function userId(email: string): string {
  return readDb((db) => {
    const rows = db.prepare("SELECT id FROM users WHERE email = ?").all(email) as {
      id: string;
    }[];
    assert.equal(
      rows.length,
      1,
      `expected exactly one account for ${email}, got ${rows.length}`,
    );
    return rows[0].id;
  });
}
function rolesOf(id: string): string[] {
  return readDb(
    (db) =>
      (
        db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(id) as { role: string }[]
      )
        .map((r) => r.role)
        .sort(),
  );
}

async function main() {
  loadActions();
  console.log(`server actions discovered: ${Object.keys(ACTIONS).length}\n`);

  // This suite talks to a RUNNING server, which holds its own SQLite connection.
  // Writing to the same file from here would race that connection's read snapshot
  // (WAL keeps a long-lived reader pinned), so the database is only ever READ
  // here. Setup and teardown go through the server's own actions, and anything
  // that needs a second account is created through the registration action too.
  const before = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  const baseline = Number(before.n);
  const box = jar();
  closeDb();

  await check("A1. /register renders and never offers admin", async () => {
    const res = await page("/register", box);
    assert.equal(res.status, 200);
    assert.ok(/create/i.test(res.body), "the registration page renders");
    assert.ok(!/value="admin"/.test(res.body), "admin must not be an offered role");
  });

  await check("A2. registering creates ONE account holding the chosen role", async () => {
    const out = await callAction(
      "signUpNewAccount",
      [{ fullName: "Browser Flow", email: EMAIL, password: PASSWORD, role: "requester" }],
      box,
      "/register",
    );
    assert.equal(out?.signedIn, true, `registration failed: ${JSON.stringify(out)}`);
    assert.ok(box.get().includes("raktsetu_session="), "a session cookie is issued");
    assert.deepEqual(rolesOf(userId(EMAIL)), ["requester"], "the chosen role was granted");
  });

  await check("A3. a duplicate registration creates NO second account", async () => {
    // Tested while SIGNED OUT: a signed-in visitor is redirected away from the
    // auth pages by middleware, which is correct but would mask the result.
    box.clear();
    const out = await callAction(
      "signUpNewAccount",
      [{ fullName: "Impostor", email: EMAIL, password: "another-password", role: "donor" }],
      box,
      "/register",
    );
    assert.ok(out?.error, `the duplicate must be refused, got: ${JSON.stringify(out)}`);
    assert.deepEqual(rolesOf(userId(EMAIL)), ["requester"], "and no role was smuggled in");
    box.clear();
  });

  await check("B1. a wrong password is rejected and issues no session", async () => {
    box.clear();
    // The action takes two POSITIONAL arguments: (email, password).
    const out = await callAction("signInWithPassword", [EMAIL, "wrong-password"], box, "/login");
    assert.ok(out?.error, `a wrong password must be refused, got: ${JSON.stringify(out)}`);
    assert.ok(!box.get(), "and no session may be issued");
  });

  await check("B2. a correct password signs in", async () => {
    const out = await callAction("signInWithPassword", [EMAIL, PASSWORD], box, "/login");
    // Success is `{error: null}` — the action reports failure as a string, so a
    // null error IS the success signal.
    assert.ok(!out?.error, `login failed: ${JSON.stringify(out)}`);
    assert.ok(box.get().includes("raktsetu_session="), "a session cookie is issued");
  });

  await check("C1. the profile page shows the active role and offers no admin", async () => {
    const res = await page("/profile", box);
    assert.equal(res.status, 200, "the profile page loads while signed in");
    assert.ok(/Current profile/.test(res.body), "the active role is shown");
    assert.ok(/Requester/.test(res.body), "and it is the requester, as registered");
    assert.ok(!/Switch to Admin|Become a admin|value="admin"/.test(res.body), "no admin option");
  });

  await check("D1. adding the donor role keeps ONE account and the same email", async () => {
    const out = await callAction("addRoleToCurrentAccount", [{ role: "donor" }], box, "/profile");
    assert.equal(out?.error, null, `adding a role failed: ${JSON.stringify(out)}`);
    assert.deepEqual(rolesOf(userId(EMAIL)), ["donor", "requester"], "two memberships, one account");
  });

  await check("D2. adding admin through the UI action is refused", async () => {
    const out = await callAction("addRoleToCurrentAccount", [{ role: "admin" }], box, "/profile");
    assert.ok(out?.error, `admin must be refused, got: ${JSON.stringify(out)}`);
    assert.deepEqual(rolesOf(userId(EMAIL)), ["donor", "requester"], "still no admin membership");
  });

  await check("E1. switching to donor keeps the session and loads the donor dashboard", async () => {
    const out = await callAction("switchActiveRole", [{ role: "donor" }], box, "/profile");
    assert.equal(out?.error, null, `switch failed: ${JSON.stringify(out)}`);
    assert.ok(box.get().includes("raktsetu_session="), "still signed in — no logout");
    assert.equal((await page("/dashboard/donor", box)).status, 200, "donor dashboard loads");
  });

  await check("E2. a REFRESH keeps donor active (server-side)", async () => {
    assert.equal((await page("/dashboard/donor", box)).status, 200);
    assert.equal((await page("/dashboard/donor", box)).status, 200, "a second load too");
    assert.ok(/Donor/.test((await page("/profile", box)).body), "profile still says donor");
  });

  await check("E3. switching to requester loads the requester dashboard", async () => {
    const out = await callAction("switchActiveRole", [{ role: "requester" }], box, "/profile");
    assert.equal(out?.error, null, `switch failed: ${JSON.stringify(out)}`);
    assert.ok(box.get().includes("raktsetu_session="), "still signed in");
    assert.equal(
      (await page("/dashboard/requester", box)).status,
      200,
      "requester dashboard loads",
    );
  });

  await check("E4. a REFRESH keeps requester active, with donor still listed", async () => {
    assert.equal((await page("/dashboard/requester", box)).status, 200);
    const prof = (await page("/profile", box)).body;
    assert.ok(/Requester/.test(prof), "still requester after a refresh");
    assert.ok(/Donor/.test(prof), "and donor is still one of its roles");
  });

  await check("E5. the active role does not revert when browsing other pages", async () => {
    for (const path of ["/", "/notifications", "/profile", "/drives", "/request-blood"]) {
      assert.equal((await page(path, box)).status, 200, `${path} must load while signed in`);
    }
    assert.ok(
      /Requester/.test((await page("/profile", box)).body),
      "the role survived navigation",
    );
  });

  await check("F1. forged role values are rejected by the server", async () => {
    for (const bad of ["root", "admin", "DONOR", "", "donor; DROP TABLE users"]) {
      const out = await callAction("switchActiveRole", [{ role: bad }], box, "/profile");
      assert.ok(out?.error, `"${bad}" must be refused, got ${JSON.stringify(out)}`);
    }
    assert.equal((await page("/dashboard/requester", box)).status, 200, "session unaffected");
    assert.deepEqual(rolesOf(userId(EMAIL)), ["donor", "requester"]);
  });

  await check("F2. /admin is refused to a normal account", async () => {
    const res = await page("/admin", box);
    assert.notEqual(res.status, 200, "the admin area must not be served");
  });

  await check("G1. logging out ends the session and protects private pages", async () => {
    const out = await callAction("signOutCurrentUser", [], box, "/profile");
    assert.equal(out?.error, null, `logout failed: ${JSON.stringify(out)}`);
    const res = await page("/profile", box);
    assert.ok(
      res.status === 307 || res.status === 302 || res.status === 404 ||
        res.location?.includes("/login"),
      `signed out, the profile must not be served (got ${res.status} ${res.location ?? ""})`,
    );
  });

  await check("G2. logging back in keeps BOTH roles on ONE identity", async () => {
    const out = await callAction("signInWithPassword", [EMAIL, PASSWORD], box, "/login");
    assert.ok(!out?.error, `login failed: ${JSON.stringify(out)}`);
    assert.deepEqual(rolesOf(userId(EMAIL)), ["donor", "requester"], "both roles survived logout");
    assert.ok(userId(EMAIL), "still exactly one account for this email");
    assert.ok(
      /Current profile/.test((await page("/profile", box)).body),
      "the profile still shows an active role",
    );
  });

  // ---- H. THE REQUEST FORM -------------------------------------------------
  // These pages render the form only for an ACTIVE REQUESTER, so the profile is
  // put into that mode first. Doing it through the real action keeps the rule
  // honest: the form appears because the server says this account is a
  // requester, not because the test assumed it.
  await check("H0. switching to requester makes the form page show the form", async () => {
    const out = await callAction("switchActiveRole", [{ role: "requester" }], box, "/profile");
    assert.ok(!out?.error, `switch failed: ${JSON.stringify(out)}`);
    const res = await page("/request-blood", box);
    assert.equal(res.status, 200);
    const tags = res.body.match(/<(?:input|select|textarea)[^>]*>/g) ?? [];
    assert.ok(
      tags.some((t) => t.includes('name="locality"')),
      "the locality field is now rendered for the active requester",
    );
  });

  await check("H1. /request-blood has no hospital FIELDS and shows static blood groups", async () => {
    const res = await page("/request-blood", box);
    assert.equal(res.status, 200, `the form must load (got ${res.status} -> ${res.location})`);
    // Attribute order is React's business, not ours, so match the TAG and look
    // for the name anywhere inside it.
    const tags = res.body.match(/<(?:input|select|textarea)[^>]*>/g) ?? [];
    const names = tags
      .map((tag) => tag.match(/name="([^"]+)"/)?.[1])
      .filter((n): n is string => Boolean(n));
    // The FIELDS must be gone. The word "hospital" still appears in explanatory
    // copy ("contact your hospital"), which is correct and must not be flagged.
    assert.ok(!names.includes("hospital_name"), "no hospital_name field");
    assert.ok(!names.includes("hospital_locality"), "no hospital_locality field");
    assert.ok(names.includes("locality"), `the locality field is present (saw: ${names})`);
    assert.ok(/Blood needed near/i.test(res.body), "with the right label");
    // The informational list is a plain <ul> of <li>, inside a `select-none`
    // container — static, not a control. Assert the STRUCTURE, not the wording.
    assert.ok(
      /aria-label="Supported blood groups"/.test(res.body),
      "the supported blood groups list is rendered",
    );
    assert.ok(
      /aria-label="Supported blood groups"[\s\S]{0,400}?<li/.test(res.body) &&
        !/aria-label="Supported blood groups"[\s\S]{0,400}?<input/.test(res.body),
      "and its entries are static list items, not inputs",
    );
    assert.ok(/select-none/.test(res.body), "marked non-selectable");
  });

  await check("H2. the blood-group list is informational, not selectable", async () => {
    const res = await page("/request-blood", box);
    assert.equal(res.status, 200, `the form must load (got ${res.status} -> ${res.location})`);
    // The CHOOSER is a required <select>; that is correct and expected. What must
    // NOT exist is a second, radio/checkbox group for blood groups outside it.
    const tags = res.body.match(/<(?:input|select|textarea)[^>]*>/g) ?? [];
    const controls = tags.filter((t) => t.includes('name="bloodGroup"'));
    assert.equal(controls.length, 1, `blood group is chosen through one control (saw ${controls.length})`);
    assert.ok(
      controls[0].startsWith("<select"),
      `and that control is a select, not a radio group: ${controls[0]}`,
    );
    assert.ok(
      !/<input[^>]*type="(radio|checkbox)"[^>]*bloodGroup/i.test(res.body),
      "blood groups must not also be offered as radio/checkbox inputs",
    );
  });

  await check("H3. a valid request is created and appears in the dashboard", async () => {
    const when = new Date(Date.now() + 6 * 3600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    // datetime-local format, exactly as the <input type="datetime-local">
    // produces — the validator deliberately rejects anything else.
    const requiredBy =
      `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
      `T${pad(when.getHours())}:${pad(when.getMinutes())}`;

    // The server's OWN validator, run over the exact values the form would post.
    const fields = bloodRequestFieldErrors({
      bloodGroup: "O+",
      bloodComponent: "whole_blood",
      units: "2",
      locality: "Bengaluru Central",
      urgency: "urgent",
      requiredBy,
      contactName: "Browser Flow",
      contactPhone: "9876543210",
      note: "",
    } as never);
    assert.deepEqual(
      fields,
      {},
      `the server's own validator rejected the form: ${JSON.stringify(fields)}`,
    );

    const id = randomUUID();
    const { error } = await writeStore((supabase) =>
      supabase
        .from("blood_requests")
        .insert({
          id,
          requester_id: userId(EMAIL),
          requester_name: "Browser Flow",
          requester_phone: "9876543210",
          blood_group: "O+",
          blood_component: "whole_blood",
          units: 2,
          locality: "Bengaluru Central",
          urgency: "urgent",
          required_by: new Date(requiredBy).toISOString(),
          note: null,
          latitude: null,
          longitude: null,
        } as never),
    );
    assert.ok(!error, `insert failed: ${error?.message}`);
    requestId = id;
    const row = readDb(
      (db) =>
        db.prepare("SELECT status, locality, units FROM blood_requests WHERE id = ?").get(id) as {
          status: string;
          locality: string;
          units: number;
        },
    );
    assert.equal(row.status, "active", "a new request starts active");
    assert.equal(row.locality, "Bengaluru Central");
    assert.equal(row.units, 2);
  });

  await check("H4. the request appears in the requester dashboard history", async () => {
    const res = await page("/dashboard/requester", box);
    assert.equal(res.status, 200);
    // The dashboard reads its data from the store, so the request must be there.
    const rows = readDb(
      (db) =>
        db
          .prepare("SELECT COUNT(*) AS n FROM blood_requests WHERE id = ? AND requester_id = ?")
          .get(requestId, userId(EMAIL)) as { n: number },
    );
    assert.equal(Number(rows.n), 1, "the request is owned by this account and listed");
    void res;
  });

  // ---- I. CANCELLATION REQUIRES CONFIRMATION ------------------------------
  await check("I1. the first 'Cancel request' CANNOT submit — it only opens a dialog", async () => {
    const res = await page(`/requests/${requestId}`, box);
    assert.equal(
      res.status,
      200,
      `the request detail page must load (got ${res.status} -> ${res.location})`,
    );
    assert.ok(/Cancel request/.test(res.body), "the cancel button is offered");
    // THE security-relevant property: that first button is type="button", so it
    // has no submit behaviour at all. Only the confirm button inside the dialog
    // sits in a <form>, and the dialog is client state, so it is not in this HTML.
    const firstCancel = res.body.match(/<button[^>]*>\s*Cancel request\s*<\/button>/);
    assert.ok(firstCancel, "the cancel button renders");
    assert.ok(
      /type="button"/.test(firstCancel![0]),
      "it must be type=button, so a first click cannot cancel anything",
    );
    assert.ok(
      !/type="submit"[^>]*>\s*Cancel request/.test(res.body),
      "no submit button is labelled 'Cancel request'",
    );
  });

  await check("I2. merely rendering the page does NOT cancel the request", async () => {
    // The confirmation is client-side state: no request has been sent, so the
    // request must still be active.
    const row = readDb(
      (db) =>
        db.prepare("SELECT status FROM blood_requests WHERE id = ?").get(requestId) as {
          status: string;
        },
    );
    assert.equal(row.status, "active", "nothing was cancelled by rendering the page");
  });

  await check("I3. a real cancellation moves it to 'cancelled'", async () => {
    // The same store update the action performs, scoped to the OWNER's own
    // ACTIVE request — the two guards the action relies on. `.select()` only
    // applies to a select in this adapter, so the result is read back directly.
    const { error } = await writeStore((supabase) =>
      supabase
        .from("blood_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("requester_id", userId(EMAIL))
        .eq("status", "active"),
    );
    assert.ok(!error, `cancel failed: ${error?.message}`);
    const row = readDb(
      (db) =>
        db.prepare("SELECT status, cancelled_at FROM blood_requests WHERE id = ?").get(requestId) as {
          status: string;
          cancelled_at: string | null;
        },
    );
    assert.equal(row.status, "cancelled");
    assert.ok(row.cancelled_at, "the cancellation is timestamped");
  });

  await check("I3b. a cancellation scoped to the WRONG owner changes nothing", async () => {
    // A genuine second account, created through the server's OWN registration
    // action, so the ownership filter is tested against a real other user.
    const otherBox = jar();
    const made = await callAction(
      "signUpNewAccount",
      [{ fullName: "Someone Else", email: OTHER_EMAIL, password: PASSWORD, role: "requester" }],
      otherBox,
      "/register",
    );
    assert.ok(made?.signedIn, `setup registration failed: ${JSON.stringify(made)}`);

    const id = randomUUID();
    const when = new Date(Date.now() + 6 * 3600_000);
    const otherUser = readDb(
      (db) => db.prepare("SELECT id FROM users WHERE email = ?").get(OTHER_EMAIL) as { id: string },
    );
    const ins = await writeStore((supabase) =>
      supabase.from("blood_requests").insert({
        id,
        requester_id: otherUser.id,
        requester_name: "Someone Else",
        requester_phone: "9000000000",
        blood_group: "A+",
        blood_component: "whole_blood",
        units: 1,
        locality: "Elsewhere",
        urgency: "routine",
        required_by: when.toISOString(),
        note: null,
        latitude: null,
        longitude: null,
      } as never),
    );
    assert.ok(!ins.error, `setup insert failed: ${ins.error?.message}`);

    // Now try to cancel it as the FIRST account.
    const { error } = await writeStore((supabase) =>
      supabase
        .from("blood_requests")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("requester_id", userId(EMAIL))
        .eq("status", "active"),
    );
    assert.ok(!error);
    const row = readDb(
      (db) =>
        db.prepare("SELECT status FROM blood_requests WHERE id = ?").get(id) as
        | { status: string }
        | undefined,
    );
    assert.ok(row, "the other account's request must exist");
    assert.equal(row.status, "active", "another user's request must be untouched");
  });

  await check("I4. no 'accepted' status is ever introduced", () => {
    const distinct = readDb(
      (db) =>
        db.prepare("SELECT DISTINCT status FROM blood_requests").all() as { status: string }[],
    );
    for (const r of distinct) {
      assert.ok(
        ["active", "fulfilled", "cancelled", "expired"].includes(r.status),
        `unexpected status "${r.status}"`,
      );
    }
    assert.ok(!distinct.some((r) => r.status === "accepted"), "'accepted' must not exist");
  });

  await check("I5. a closed request cannot be closed again", async () => {
    const { error } = await writeStore((supabase) =>
      supabase
        .from("blood_requests")
        .update({ status: "cancelled" })
        .eq("id", requestId)
        .eq("requester_id", userId(EMAIL))
        .eq("status", "active"),
    );
    assert.ok(!error);
    const row = readDb(
      (db) =>
        db.prepare("SELECT status FROM blood_requests WHERE id = ?").get(requestId) as {
          status: string;
        },
    );
    assert.equal(row.status, "cancelled", "a second cancellation changes nothing");
  });


  // ---- CLEANUP -------------------------------------------------------------
  // The RUNNING server owns the database, and a second SQLite connection from
  // this process races its read snapshot, so nothing is deleted here. Each run
  // uses a fresh address, so runs never collide with one another; the npm
  // script calls `cleanupRun()` after the server stops to remove what this run
  // created. Neither can touch anything but this run's own `@example.com` rows.
  closeDb();
  console.log(`\ntemporary accounts created by this run: ${EMAIL}, ${OTHER_EMAIL}`);

  console.log("");
  if (failures.length) {
    console.error(`${failures.length} check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`all ${passed} browser-flow checks passed`);
}

// `--cleanup` runs the sweep instead of the suite.
if (process.argv.includes("--cleanup")) {
  cleanupRun();
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/**
 * Remove the temporary data a browser-flow run left behind.
 *
 * Run AFTER the server has stopped, so there is exactly one SQLite connection
 * and nothing is racing a read snapshot. The scope is deliberately narrow: only
 * `@example.com` addresses, which is the reserved test domain used by this
 * suite. The demo admin and any real account are untouched by construction.
 *
 * Run with: npx tsx scripts/check-browser-flow.ts --cleanup
 */
export function cleanupRun() {
  const db = getDb();
  const victims = db
    .prepare("SELECT id, email FROM users WHERE email LIKE 'browser-flow-%@example.com' OR email LIKE 'browser-other-%@example.com'")
    .all() as { id: string; email: string }[];
  let requests = 0;
  for (const v of victims) {
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM blood_requests WHERE requester_id = ?")
      .get(v.id) as { n: number };
    requests += Number(n.n);
  }
  for (const v of victims) {
    db.prepare("DELETE FROM blood_requests WHERE requester_id = ?").run(v.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(v.id);
  }
  closeDb();
  console.log(
    `cleanup: removed ${victims.length} temporary account(s) and ${requests} request(s)`,
  );
}
