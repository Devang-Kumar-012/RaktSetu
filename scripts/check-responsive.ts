/**
 * RESPONSIVE AUDIT — real layout, real engine.
 *
 * Drives headless Chrome (which ships with the project machine) over the
 * DevTools Protocol, visits every route at a spread of realistic viewports,
 * and MEASURES horizontal overflow and console errors. It reports the specific
 * elements that stick out, so each finding is a concrete fix rather than a
 * hunch.
 *
 * Routes are DISCOVERED from the app directory, not hand-written, so nothing is
 * assumed and nothing is forgotten.
 *
 * Usage:  AUTH=1 npm run check:responsive -- http://localhost:3999
 *
 * `AUTH=1` signs in first so private routes are measured rather than skipped.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Page, type Viewport } from "./lib/cdp";
import { PROBE } from "./lib/probe";

const BASE = (process.argv[2] ?? "http://localhost:3999").replace(/\/$/, "");
const APP = join(import.meta.dirname, "..", "src", "app");

interface Finding {
  route: string;
  viewport: string;
  overflow: number;
  offenders: any[];
}

let passed = 0;
const findings: Finding[] = [];
const consoleErrors: string[] = [];

/** The viewports that matter, per the brief. */
const ALL_VIEWPORTS: (Viewport & { label: string })[] = [
  { label: "320x568", width: 320, height: 568, mobile: true },
  { label: "360x640", width: 360, height: 640, mobile: true },
  { label: "390x844", width: 390, height: 844, mobile: true },
  { label: "430x932", width: 430, height: 932, mobile: true },
  { label: "768x1024", width: 768, height: 1024 },
  { label: "844x390-landscape", width: 844, height: 390, mobile: true },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "1280x720-short", width: 1280, height: 720 },
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1920x1080", width: 1920, height: 1080 },
  { label: "2560x1080-ultrawide", width: 2560, height: 1080 },
  { label: "1440x600-short", width: 1440, height: 600 },
];

/**
 * `VP=320,390` narrows the sweep while iterating on a fix. The full set is the
 * default, and is what the acceptance run uses.
 */
const VIEWPORTS = process.env.VP
  ? ALL_VIEWPORTS.filter((v) => process.env.VP!.split(",").includes(v.label))
  : ALL_VIEWPORTS;

/** Discover routes from the app directory so none is assumed or forgotten. */
function discoverRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // Route groups and private folders are not URLs.
        if (e.name.startsWith("(") || e.name.startsWith("_") || e.name === "api") continue;
        walk(p, `${prefix}/${e.name}`);
      } else if (e.name === "page.tsx") {
        out.push(prefix || "/");
      }
    }
  };
  walk(APP, "");
  return out.sort();
}


/**
 * Resolve dynamic route segments to REAL records.
 *
 * A route like `/requests/[id]` is not a URL — asking for it literally 404s and
 * measures the not-found page instead of the page the brief wants checked. So
 * the sweep creates one temporary request and one temporary drive, and swaps the
 * segment in. Anything it cannot resolve is reported as SKIPPED rather than
 * silently counted as a pass.
 */
async function resolveDynamicRoutes(routes: string[]): Promise<{
  routes: string[];
  skipped: string[];
  created: { requestId: string; driveId: string };
}> {
  const { closeDb, getDb } = await import("../src/lib/server/db");
  const { randomUUID } = await import("node:crypto");
  const { createSupabaseServerClient } = await import("../src/lib/supabase/server");
  closeDb();

  const resolved: string[] = [];
  const skipped: string[] = [];
  let requestId = "";
  let driveId = "";

  try {
    if (routes.some((r) => r.startsWith("/requests/"))) {
      const id = randomUUID();
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("blood_requests").insert({
        id,
        requester_id: process.env.RESP_REQUESTER_ID ?? "",
        requester_name: "A very long requester name that should wrap or truncate",
        requester_phone: "9876543210",
        blood_group: "O+",
        blood_component: "whole_blood",
        units: 2,
        // A deliberately long locality, to check wrapping of user text.
        locality: "Indiranagar, Bengaluru, Karnataka",
        urgency: "urgent",
        required_by: new Date(Date.now() + 6 * 3600_000).toISOString(),
        note: "A deliberately long note to confirm user-generated content wraps instead of stretching the page sideways.",
        latitude: 12.9784,
        longitude: 77.6408,
      } as never);
      if (!error) requestId = id;
    }

    if (routes.some((r) => r.includes("/drives/"))) {
      // Build a valid drive from the table's own schema, so the detail route has
      // real content to render instead of 404-ing past the layout under test.
      const now = new Date().toISOString();
      const id = randomUUID();
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase
        .from("campus_blood_drives")
        .insert({
          id,
          title: "A deliberately long campus drive title that must wrap, not overflow",
          organizer: "RaktSetu Responsive Audit",
          drive_date: now,
          starts_at: now,
          ends_at: new Date(Date.now() + 86_400_000).toISOString(),
          venue: "A very long venue name for the main auditorium building",
          locality: "Bengaluru",
          description: "A long description to confirm body copy wraps cleanly on a phone.",
          target_units: 50,
          // The column is CHECK-constrained to upcoming|ongoing|completed|
          // cancelled; 'upcoming' is what a newly created drive actually is.
          status: "upcoming",
          published: 1,
          created_at: now,
          updated_at: now,
        } as never);
      if (!error) driveId = id;
      else console.log(`  (drive setup: ${error.message})`);
    }
  } catch (err) {
    console.log(`  (dynamic route setup: ${(err as Error).message})`);
  } finally {
    closeDb();
  }

  for (const route of routes) {
    let r = route;
    if (r.includes("/requests/") && requestId) {
      r = r.replace(/\[id\]/g, requestId);
    } else if (r.includes("/drives/") && driveId) {
      r = r.replace(/\[id\]/g, driveId);
    }
    if (r.includes("[id]")) {
      skipped.push(route);
      continue;
    }
    resolved.push(r);
  }

  // The ids are returned so the caller can remove these records AFTER the sweep
  // has visited them. Deleting here would measure a 404 instead of the page.
  return { routes: resolved, skipped, created: { requestId, driveId } };
}

/** Remove the temporary records the dynamic-route setup created. */
async function removeAuditRecords(created: { requestId: string; driveId: string }) {
  if (!created.requestId && !created.driveId) return;
  const { closeDb, getDb } = await import("../src/lib/server/db");
  closeDb();
  try {
    if (created.requestId) {
      getDb().prepare("DELETE FROM blood_requests WHERE id = ?").run(created.requestId);
    }
    if (created.driveId) {
      getDb().prepare("DELETE FROM campus_blood_drives WHERE id = ?").run(created.driveId);
    }
  } catch {
    /* best effort */
  }
  closeDb();
}

async function main() {
  const routes = discoverRoutes();
  console.log(`routes discovered: ${routes.length}`);
  console.log(`viewports: ${VIEWPORTS.length}`);
  console.log(`checks: ${routes.length * VIEWPORTS.length}\n`);

  const page = await Page.open();

  // Sign in so private routes render instead of redirecting to /login.
  // The demo credentials are read from the app's own module, so this can never
  // drift from what the application actually seeds.
  if (process.env.AUTH === "1") {
    const demo = await import("../src/lib/demo-account");
    const email = process.env.AUTH_EMAIL ?? demo.DEMO_ADMIN_EMAIL;
    const password = process.env.AUTH_PASSWORD ?? demo.DEMO_ADMIN_PASSWORD;
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/login`);
    const filled = await page.evaluate(`(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      return set('input[type=email]', ${JSON.stringify(email)}) &&
             set('input[type=password]', ${JSON.stringify(password)});
    })()`);
    if (filled) {
      await page.evaluate(`document.querySelector('form').requestSubmit()`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const signedIn = await page.evaluate<boolean>(`!location.pathname.startsWith('/login')`);
    console.log(
      `auth: ${signedIn ? "signed in" : "NOT signed in — private routes measure as redirects"}`,
    );
  }

  // Dynamic routes need real records, and the request must belong to somebody so
  // the detail page renders for this session. The signed-in user's own id is
  // read from the database — it is never taken from the page.
  const { closeDb: close2, getDb: get2 } = await import("../src/lib/server/db");
  const demoEmail = process.env.AUTH_EMAIL ?? (await import("../src/lib/demo-account")).DEMO_ADMIN_EMAIL;
  const sessionUser = get2()
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(demoEmail) as { id: string } | undefined;
  close2();
  process.env.RESP_REQUESTER_ID = sessionUser?.id ?? "";

  const { routes: toVisit, skipped, created } = await resolveDynamicRoutes(routes);
  if (skipped.length) {
    console.log(`routes with no resolvable record (skipped): ${skipped.join(", ")}`);
  }
  routes.length = 0;
  routes.push(...toVisit);
  // Removed once the sweep has visited them — see the call after the loop.
  const cleanupAudit = async () => {
    await removeAuditRecords(created);
  };

  for (const route of routes) {
    process.stdout.write(`  ${route} … `);
    for (const vp of VIEWPORTS) {
      await page.setViewport(vp);
      if (vp.mobile) await page.setTouch(true);
      // A route that immediately bounces to /login is not the page under test,
      // so it gets a short settle — there is no layout to wait for.
      try {
        await page.goto(`${BASE}${route}`, 450);
      } catch {
        findings.push({
          route,
          viewport: vp.label,
          overflow: -1,
          offenders: [{ tag: "NAV", cls: "", text: "navigation failed", right: 0, width: 0 }],
        });
        continue;
      }

      const result = await page.evaluate<any>(PROBE);
      if (result.overflow > 1) {
        findings.push({ route, viewport: vp.label, overflow: result.overflow, offenders: result.offenders });
        console.log(
          `  OVERFLOW ${route} @ ${vp.label}: +${result.overflow}px (${result.totalOffenders} el)`,
        );
        for (const o of result.offenders.slice(0, 3)) {
          console.log(
            `      <${o.tag} class="${o.cls}"> right=${o.right} w=${o.width} "${o.text}"`,
          );
        }
      } else {
        passed += 1;
      }

      for (const e of [...page.consoleErrors, ...page.pageErrors]) {
        const key = `${route} @ ${vp.label}: ${e.slice(0, 160)}`;
        if (!consoleErrors.includes(key)) consoleErrors.push(key);
      }
    }
    // A compact per-route verdict, so a long run still shows progress.
    const rf = findings.filter((f) => f.route === route);
    console.log(
      rf.length === 0
        ? "ok"
        : `OVERFLOW x${rf.length} (${[...new Set(rf.map((f) => f.viewport))].join(", ")})`,
    );
  }

  await page.close();
  await cleanupAudit();

  // Results are written to a file as well as printed, so a long sweep can be
  // polled cheaply and survives a terminal that is being closed underneath it.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    "/tmp/responsive-report.json",
    JSON.stringify({ passed, findings, consoleErrors }, null, 2),
  );

  console.log(`\nno horizontal overflow: ${passed}`);
  console.log(`with overflow: ${findings.length}`);
  if (consoleErrors.length) {
    console.log(`\nconsole/runtime errors: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 25)) console.log(`  - ${e}`);
  }
  if (findings.length) {
    console.log(`\nOVERFLOW FINDINGS (${findings.length}):`);
    for (const f of findings) {
      console.log(`\n  ${f.route} @ ${f.viewport}  +${f.overflow}px`);
      for (const o of f.offenders.slice(0, 4)) {
        console.log(
          `    <${o.tag} class="${o.cls}"> right=${o.right} w=${o.width} ` +
            `scrollable=${o.scrollable} contained=${o.contained} "${o.text}"`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
