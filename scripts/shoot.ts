/**
 * ONE-OFF SCREENSHOT HELPER — captures a route at a few widths so a layout
 * change can be LOOKED at, not just measured. Uses the project's own CDP driver,
 * so it needs the same Chrome instance the audits use.
 *
 * Usage: npx tsx scripts/shoot.ts / 1440 390
 */
import { Page } from "./lib/cdp";

const BASE = "http://127.0.0.1:3999";
const route = process.argv[2] ?? "/";
const widths = (process.argv[3] ?? "1440,390").split(",").map(Number);
/** Optional third arg: viewport height, for reaching a section further down. */
const heightArg = process.argv[4] ? Number(process.argv[4]) : null;

async function main() {
  const page = await Page.open();

  /*
   * AUTH=1 signs in first with the documented demo administrator, so private
   * routes render as themselves instead of bouncing to /login. It reuses the
   * same approach as the glass and responsive audits.
   */
  if (process.env.AUTH === "1") {
    const demo = await import("../src/lib/demo-account");
    await page.goto(`${BASE}/login`, 800);
    await page.evaluate(`(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      return set('input[type=email]', ${JSON.stringify(demo.DEMO_ADMIN_EMAIL)}) &&
             set('input[type=password]', ${JSON.stringify(demo.DEMO_ADMIN_PASSWORD)});
    })()`);
    await page.evaluate(`document.querySelector('form').requestSubmit()`);
    await new Promise((r) => setTimeout(r, 2500));
    const ok = await page.evaluate<boolean>(`!location.pathname.startsWith('/login')`);
    console.log(`auth: ${ok ? "signed in" : "FAILED"}`);
  }

  for (const width of widths) {
    const height = heightArg ?? Math.round(width * 0.72);
    await page.setViewport({ width, height });
    await page.goto(`${BASE}${route}`, 900);
    // Force every lazy image to load before capturing, so the shot shows the real
    // composition rather than empty frames waiting on an intersection observer.
    // `scroll-behavior: smooth` is disabled first: with it on, scrollTo animates
    // and the capture lands mid-animation, showing the wrong part of the page.
    await page.evaluate(`(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 1200));
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 900));
    })()`);
    const y = await page.evaluate<number>(`window.scrollY`);
    if (y !== 0) throw new Error(`page did not return to the top (scrollY=${y})`);

    /*
     * Force a real repaint before capturing.
     *
     * Re-applying the device metrics makes Chrome re-run layout and re-composite,
     * which clears a stale frame. Without this the capture can return the previous
     * page's pixels while the DOM probes below already report the NEW layout — a
     * mismatch that reads as "the CSS is broken" when the CSS is fine.
     */
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 640,
    });
    await new Promise((r) => setTimeout(r, 700));
    // Report what is actually painting at the top of the page, so a wrong capture
    // is diagnosable instead of mysterious.
    const info = await page.evaluate<any>(`(() => {
      const hero = document.querySelector('h1');
      const r = hero ? hero.getBoundingClientRect() : null;
      const imgs = [...document.querySelectorAll('img')].slice(0, 4).map((i) => {
        const b = i.getBoundingClientRect();
        return { src: i.currentSrc.split('/').pop(), top: Math.round(b.top),
                 w: Math.round(b.width), h: Math.round(b.height) };
      });
      const atPoint = document.elementFromPoint(400, 300);
      return { h1Top: r ? Math.round(r.top) : null,
               h1Text: hero ? hero.textContent.slice(0, 40) : null,
               atPoint: atPoint ? atPoint.tagName + '.' + atPoint.className.slice(0, 60) : null,
               imgs };
    })()`);
    console.log(`  ${width}px  h1@${info.h1Top}  "${info.h1Text}"  topmost@400,300: ${info.atPoint}`);
    for (const i of info.imgs) console.log(`     img ${i.src} top=${i.top} ${i.w}x${i.h}`);
    const out = `/tmp/shot-${route.replace(/\W+/g, "_") || "home"}-${width}.png`;
    await page.screenshot(out);
    console.log(`${out}  (console errors: ${page.consoleErrors.length})`);
    page.consoleErrors.length = 0;
  }
  await page.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
