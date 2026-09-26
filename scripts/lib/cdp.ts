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

  async close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
