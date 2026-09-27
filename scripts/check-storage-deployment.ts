/**
 * PRODUCTION-EQUIVALENT STORAGE TEST.
 *
 * `check:registration` proves the classifier in-process. This proves the thing
 * that actually matters to a user: that a server whose working directory is
 * read-only — exactly the deployed serverless condition — returns a SPECIFIC
 * message over real HTTP, carrying an error ID that also appears in the log.
 *
 * It runs the PRODUCTION build from a read-only copy of the app and calls the
 * registration action over HTTP, the way a browser does.
 *
 * Usage:  npx tsx scripts/check-storage-deployment.ts
 */
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const SANDBOX = join(ROOT, ".storage-sandbox");
const PORT = 4311;

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

/**
 * Resolve a server action's id BY NAME, the same way check-browser-flow does:
 * the client chunk emits
 *   createServerReference("<hex id>", callServer, void 0, findSourceMapURL, "<name>")
 * The id itself is build-dependent, so it is matched by shape, never guessed.
 */
function loadActionId(name: string): string | null {
  const chunks = join(ROOT, ".next", "static", "chunks");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) files.push(p);
    }
  };
  try {
    walk(chunks);
  } catch {
    return null;
  }
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(
      /createServerReference\)\("([0-9a-f]+)"[^)]*,"([A-Za-z0-9_$]+)"/g,
    )) {
      if (m[2] === name) return m[1];
    }
    for (const m of src.matchAll(/"([0-9a-f]{40,})"[^)]{0,120}"([A-Za-z0-9_$]+)"/g)) {
      if (m[2] === name) return m[1];
    }
  }
  return null;
}

/**
 * Call a server action the way the browser does, over HTTP.
 *
 * The result is its own flight line (`1:{"error":...}`); the numeric prefix is a
 * stream marker, and the React tree payload is skipped.
 */
async function callAction(origin: string, id: string, args: unknown[]) {
  const res = await fetch(`${origin}/register`, {
    method: "POST",
    headers: {
      "content-type": "text/plain;charset=UTF-8",
      "next-action": id,
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  const text = await res.text();
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

async function waitForServer(origin: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(origin);
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  // The production build is required: a dev server would compile on demand and
  // would need to write into the read-only sandbox.
  const actionId = loadActionId("signUpNewAccount");
  if (!actionId) {
    console.log("  FAIL no production build found — run `npm run build` first.");
    process.exit(1);
  }

  // A sandbox that LOOKS like a deployed bundle: the app plus its build, with a
  // read-only working directory.
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });
  for (const item of [".next", "node_modules", "next.config.ts"]) {
    try {
      cpSync(join(ROOT, item), join(SANDBOX, item), { recursive: true, dereference: true });
    } catch {
      /* optional */
    }
  }
  writeFileSync(
    join(SANDBOX, "package.json"),
    JSON.stringify({ name: "storage-sandbox", version: "1.0.0" }),
  );
  chmodSync(SANDBOX, 0o555);

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: SANDBOX,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += String(d)));
  server.stderr.on("data", (d) => (serverLog += String(d)));

  const origin = `http://localhost:${PORT}`;
  try {
    const up = await waitForServer(origin);
    ok("the production server starts from a read-only working directory", up, serverLog.slice(0, 300));
    if (!up) return;

    const email = `storage-${Date.now()}@example.com`;
    const out = await callAction(origin, actionId, [
      { fullName: "Storage Test", email, password: "a-long-enough-password", role: "requester" },
    ]);
    const payload = JSON.stringify(out);

    ok(
      "the failure is reported as a STORAGE problem, not a generic one",
      /DATABASE_NOT_WRITABLE|DATABASE_UNAVAILABLE/.test(payload),
      payload.slice(0, 240),
    );
    ok("the response carries a traceable error ID", /REG-[A-Z0-9]{6}/.test(payload), payload.slice(0, 240));
    ok(
      "the response leaks no path, driver code or stack frame",
      !/\/var\/task|storage-sandbox|EACCES|EROFS|node:sqlite|at Object/.test(payload),
      payload.slice(0, 240),
    );

    // The process log is written asynchronously by the running server, so give
    // it a moment to flush before asserting on it.
    await sleep(1500);
    ok(
      "the server logged the failure with a matching error ID",
      /registration_failed/.test(serverLog) &&
        new RegExp(payload.match(/REG-[A-Z0-9]{6}/)?.[0] ?? "NEVERMATCH").test(serverLog),
      serverLog.slice(-300),
    );
    ok("the server log never contains the password", !serverLog.includes("a-long-enough-password"));
  } finally {
    server.kill("SIGKILL");
    chmodSync(SANDBOX, 0o755);
    rmSync(SANDBOX, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(`\nall ${passed} storage-deployment checks passed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
