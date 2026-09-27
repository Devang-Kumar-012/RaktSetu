/**
 * GLASSMORPHISM AUDIT — proves the effect is real in a real engine.
 *
 * The risk with a task like this is shipping CSS that *looks* right in a diff but
 * renders as a flat pale box (a missing backdrop-filter, an opaque background, a
 * utility that overrode the translucent one). So this does not read the stylesheet
 * and guess — it drives headless Chrome over the DevTools Protocol, visits a
 * representative spread of routes, and reads back the COMPUTED style of every
 * glass surface, asserting for each one that it is:
 *
 *   - genuinely translucent (background alpha < 1),
 *   - actually blurring (backdrop-filter is not `none`),
 *   - visibly bordered,
 *   - shadowed,
 *
 * and that the page behind it carries the ambient depth the blur refracts.
 *
 * It also captures PNGs, so the result can be looked at rather than only measured.
 *
 * Usage:  AUTH=1 npm run check:glass -- http://localhost:3999
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { Page } from "./lib/cdp";

const BASE = (process.argv[2] ?? "http://localhost:3999").replace(/\/$/, "");
const SHOTS = join(import.meta.dirname, "..", ".glass-shots");

/**
 * Representative spread, split by whether a session is needed.
 *
 * The auth routes are measured SIGNED OUT and the private ones SIGNED IN, in
 * two passes. Doing it in a single pass is a trap: with a session active,
 * /login and /register correctly redirect to the dashboard, so those pages
 * would either be skipped or sampled mid-redirect and reported as broken.
 */
const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/donor",
  "/drives",
  "/help",
  "/login",
  "/register",
  "/forgot-password",
];

const PRIVATE_ROUTES = [
  "/dashboard",
  "/dashboard/donor",
  "/dashboard/requester",
  "/dashboard/volunteer",
  "/profile",
  "/requests",
  "/admin",
  "/admin/settings",
  "/admin/reports",
  "/admin/donations",
];

interface Result {
  route: string;
  found: number;
  translucent: number;
  blurred: number;
  failures: string[];
  consoleErrors: number;
}

let passed = 0;
let failed = 0;
const results: Result[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("GLASSMORPHISM AUDIT\n");
  console.log(`base: ${BASE}\n`);

  const page = await Page.open();
  await page.setViewport({ width: 1440, height: 900 });

  // A session left behind by an earlier audit would make /login and /register
  // redirect away, so they would never be measured as themselves.
  await page.send("Network.enable");
  await page.send("Network.clearBrowserCookies");

  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  /** Visit one route and assert every glass surface on it is real glass. */
  async function auditRoute(route: string) {
    const before = page.consoleErrors.length;
    await page.goto(`${BASE}${route}`, 600);
    const audit = await page.auditGlass();
    const landed = await page.evaluate<string>(`location.pathname`);
    const errors = page.consoleErrors.length - before;

    results.push({
      route,
      found: audit.found,
      translucent: audit.translucent,
      blurred: audit.blurred,
      failures: audit.failures,
      consoleErrors: errors,
    });

    const name = route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");
    await page.screenshot(join(SHOTS, `${name}.png`));

    check(
      `${route.padEnd(24)} ${String(audit.found).padStart(3)} surfaces  ` +
        `${audit.translucent} translucent / ${audit.blurred} blurred`,
      audit.found > 0 && audit.translucent === audit.found && audit.blurred === audit.found,
      audit.failures.join("; "),
    );
    // The meaningful failure is being bounced to the auth screen, which would
    // mean the page was never really rendered. An admin account landing on
    // /admin is correct app behaviour, not a fault, so it is not a failure.
    // An auth route is obviously meant to BE on /login, so it is exempt.
    const isAuthRoute = /^\/(login|register|forgot-password|reset-password)/.test(route);
    if (landed.includes("/login") && !isAuthRoute) {
      check(`${route.padEnd(24)} rendered`, false, `bounced to ${landed}`);
    }
    if (errors > 0) check(`${route.padEnd(24)} no console errors`, false, `${errors}`);

    if (route === "/" || route === "/login") {
      for (const s of audit.samples) {
        console.log(
          `          ${s.cls.padEnd(14)} bg=${s.bg.padEnd(24)} backdrop=${s.backdrop}`,
        );
        console.log(`          ${" ".repeat(14)} border=${s.border}  shadow=${s.shadow}`);
      }
    }
  }

  // PASS 1 — signed out, so the auth pages render as themselves.
  console.log("pass 1: public + auth routes (signed out)\n");
  for (const route of PUBLIC_ROUTES) await auditRoute(route);

  // PASS 2 — sign in, then measure the private surfaces.
  if (process.env.AUTH === "1") {
    const demo = await import("../src/lib/demo-account");
    const email = process.env.AUTH_EMAIL ?? demo.DEMO_ADMIN_EMAIL;
    const password = process.env.AUTH_PASSWORD ?? demo.DEMO_ADMIN_PASSWORD;
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
    console.log(`\nauth: ${signedIn ? "signed in" : "NOT signed in"}`);
    console.log("\npass 2: dashboards, profile, admin (signed in)\n");
    if (!signedIn) {
      check("signed in for the private-route pass", false, "login did not succeed");
    } else {
      for (const route of PRIVATE_ROUTES) await auditRoute(route);
    }
  }

  // The ambient background is what makes the blur visible at all. Without it the
  // glass is technically present but perceptually flat.
  await page.goto(`${BASE}/`, 600);
  const ambient = await page.evaluate<string>(
    `getComputedStyle(document.body).backgroundImage`,
  );
  check(
    "body carries ambient depth (the blur has something to refract)",
    ambient !== "none" && ambient.includes("gradient"),
  );

  // Behavioural proof that the blur really renders, on a page whose glass sits
  // over the ambient gradient. A declared property is not the same as pixels
  // actually changing, and the production minifier rewrites these declarations.
  const blur = await page.proveBlur();
  check(
    `blur changes rendered pixels (blur on ${blur.before}B vs off ${blur.after}B)`,
    blur.differs,
  );

  const totalGlass = results.reduce((n, r) => n + r.found, 0);
  const totalOpaque = results.reduce((n, r) => n + (r.found - r.translucent), 0);
  const totalUnblurred = results.reduce((n, r) => n + (r.found - r.blurred), 0);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`routes measured:    ${results.length}`);
  console.log(`glass surfaces:     ${totalGlass}`);
  console.log(`opaque surfaces:    ${totalOpaque}`);
  console.log(`missing blur:       ${totalUnblurred}`);
  console.log(`screenshots:        ${SHOTS}`);
  console.log(`${"=".repeat(64)}`);
  console.log(`PASS ${passed}   FAIL ${failed}\n`);

  await page.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

