/**
 * A minimal Chrome DevTools Protocol driver.
 *
 * Chrome ships with the project machine, so responsiveness is verified by
 * MEASURING REAL LAYOUT in a real engine rather than by reading CSS and
 * guessing. This is a small client for the subset of CDP that task needs:
 * open a page at a given viewport, then read back geometry and console errors.
 *
 * No external dependency — it speaks the protocol over Node's built-in
 * WebSocket, which is why the project needed no new package.
 */
import { setTimeout as sleep } from "node:timers/promises";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CDP_PORT ?? 9222);

export interface Viewport {
  width: number;
  height: number;
  /** deviceScaleFactor; 1 keeps measurements in CSS pixels. */
  scale?: number;
  mobile?: boolean;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

/** One tab, with a promise-based wrapper over the CDP command channel. */
export class Page {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, ((p: any) => void)[]>();
  consoleErrors: string[] = [];
  pageErrors: string[] = [];

  static async open(): Promise<Page> {
    const res = await fetch(`http://${HOST}:${PORT}/json/new?about:blank`, { method: "PUT" });
    const target = (await res.json()) as { webSocketDebuggerUrl: string };
    const p = new Page();
    await p.connect(target.webSocketDebuggerUrl);
    await p.send("Page.enable");
    await p.send("Runtime.enable");
    await p.send("Log.enable");
    p.on("Runtime.consoleAPICalled", (msg) => {
      if (msg.type === "error") {
        p.consoleErrors.push(
          (msg.args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(" "),
        );
      }
    });
    p.on("Runtime.exceptionThrown", (msg) => {
      p.pageErrors.push(
        msg.exceptionDetails?.exception?.description ?? msg.exceptionDetails?.text ?? "error",
      );
    });
    p.on("Log.entryAdded", (msg) => {
      const e = msg.entry;
      if (e && e.level === "error") p.pageErrors.push(`${e.source}: ${e.text}`);
    });
    return p;
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("CDP socket failed")));
      this.ws.addEventListener("message", (ev: any) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== undefined) {
          const slot = this.pending.get(msg.id);
          if (!slot) return;
          this.pending.delete(msg.id);
          if (msg.error) slot.reject(new Error(msg.error.message));
          else slot.resolve(msg.result);
        } else {
          for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
        }
      });
    });
  }

  on(method: string, fn: (params: any) => void) {
    const list = this.listeners.get(method) ?? [];
    list.push(fn);
    this.listeners.set(method, list);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  /** Set the viewport exactly, so measurements correspond to a real device. */
  async setViewport(v: Viewport) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: v.width,
      height: v.height,
      deviceScaleFactor: v.scale ?? 1,
      mobile: v.mobile ?? false,
      screenWidth: v.width,
      screenHeight: v.height,
    });
  }

  /** Emulate touch + mobile UA behaviours for the mobile viewports. */
  async setTouch(enabled: boolean) {
    await this.send("Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: enabled ? 5 : 1 });
  }

  /** Navigate, but do not wait a beat for a route that will redirect away. */
  async goto(url: string, settleMs = 450) {
    this.consoleErrors = [];
    this.pageErrors = [];
    const loaded = new Promise<void>((resolve) => {
      const done = () => resolve();
      this.on("Page.loadEventFired", done);
      setTimeout(done, 15_000);
    });
    await this.send("Page.navigate", { url });
    await loaded;
    // Let hydration and any client layout settle before measuring.
    if (settleMs > 0) await sleep(settleMs);
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return res.result.value as T;
  }

  /**
   * PROVE the glass is real, rather than trusting that a class was applied.
   *
   * For each glass surface on the page this reads the COMPUTED style and checks
   * the properties that actually make something glass: a genuinely translucent
   * background (alpha < 1), a backdrop-filter that really blurs, a visible
   * border, and a shadow. A pale opaque box fails this — which is exactly the
   * failure a screenshot alone can hide.
   */
  async auditGlass() {
    return this.evaluate<{
      found: number;
      translucent: number;
      blurred: number;
      samples: { cls: string; bg: string; backdrop: string; border: string; shadow: string }[];
      failures: string[];
    }>(`(() => {
      const alpha = (c) => {
        const m = c.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return 1;
        const p = m[1].split(',').map(s => s.trim());
        if (p.length < 4) return 1;
        return parseFloat(p[3]);
      };
      const sels = ['.glass','.glass-blood','.glass-bar','.glass-panel','.glass-subtle','.glass-band'];
      const seen = new Map();
      const failures = [];
      let translucent = 0, blurred = 0, found = 0;
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          found++;
          const s = getComputedStyle(el);
          const a = alpha(s.backgroundColor);
          // The production minifier can keep ONLY the -webkit- prefixed form
          // (it drops the unprefixed one as redundant for its targets), so
          // reading only the camelCase \`backdropFilter\` reports a false negative.
          // getPropertyValue is used because Chrome does not always expose the
          // prefixed property as \`webkitBackdropFilter\`.
          const std = s.getPropertyValue('backdrop-filter');
          const pre = s.getPropertyValue('-webkit-backdrop-filter');
          const isBlurred = (!!std && std !== 'none') || (!!pre && pre !== 'none');
          if (a < 1) translucent++; else if (failures.length < 6) failures.push(sel + ' opaque bg ' + s.backgroundColor);
          if (isBlurred) blurred++; else if (failures.length < 6) failures.push(sel + ' no backdrop-filter');
          if (!seen.has(sel)) {
            seen.set(sel, {
              cls: sel,
              bg: s.backgroundColor,
              backdrop: std && std !== 'none' ? std : 'webkit-prefixed: ' + pre,
              border: s.borderTopWidth + ' ' + s.borderTopColor,
              shadow: s.boxShadow.slice(0, 70),
            });
          }
        }
      }
      return { found, translucent, blurred, samples: [...seen.values()], failures };
    })()`);
  }

  /**
   * Save a PNG so the result can be looked at, not only measured.
   * Returns the raw bytes as well, which is what makes the blur proof below work.
   */
  async screenshot(path?: string): Promise<Buffer> {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(res.data, "base64");
    if (path) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, buf);
    }
    return buf;
  }

  /**
   * PROVE THE BLUR IS ACTUALLY RENDERING — not merely declared.
   *
   * Reading a computed style only proves a declaration survived the build; the
   * production minifier rewrites these properties, so a style read can be
   * misleading. This is the behavioural test instead: screenshot the page, then
   * force every backdrop-filter off and screenshot again. If the blur is really
   * being applied, the two renders differ; if the surfaces were merely tinted,
   * they would be pixel-identical.
   *
   * @returns whether the two renders differ (true = the blur changed pixels)
   */
  async proveBlur(): Promise<{ differs: boolean; before: number; after: number }> {
    const before = await this.screenshot();
    // Confirm the override really lands, so a "no difference" result is
    // meaningful rather than a silent failure to disable anything.
    await this.evaluate(`(() => {
      const style = document.createElement('style');
      style.id = '__blur_probe__';
      style.textContent =
        '.glass,.glass-blood,.glass-bar,.glass-panel,.glass-subtle,.glass-band{' +
        'backdrop-filter:none !important;' +
        '-webkit-backdrop-filter:none !important;}';
      document.head.appendChild(style);
      return true;
    })()`);
    const applied = await this.evaluate<boolean>(`(() => {
      const el = document.querySelector('.glass, .glass-bar, .glass-band');
      if (!el) return false;
      const s = getComputedStyle(el);
      const std = s.getPropertyValue('backdrop-filter');
      const pre = s.getPropertyValue('-webkit-backdrop-filter');
      return (!std || std === 'none') && (!pre || pre === 'none');
    })()`);
    // Let a frame render with the override in place.
    await new Promise((r) => setTimeout(r, 250));
    const after = await this.screenshot();
    await this.evaluate(`document.getElementById('__blur_probe__')?.remove(); true`);
    return { differs: !before.equals(after), before: before.length, after: after.length };
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
