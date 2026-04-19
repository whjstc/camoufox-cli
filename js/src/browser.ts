/** Browser manager: launches and manages Camoufox instance. */

import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { Camoufox, launchOptions } from "camoufox-js";
import { firefox, type Browser, type BrowserContext, type Page } from "playwright-core";
import { RefRegistry } from "./refs.js";
import type { DisplayMode } from "./types.js";

function ensureBrowserInstalled(): void {
  try {
    execFileSync("npx", ["camoufox-js", "path"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "Browser not found. Run `camoufox-cli install` to download it."
    );
  }
}

export class BrowserManager {
  refs = new RefRegistry();
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private persistent: string | null;
  private history: string[] = [];
  private historyIndex = -1;

  constructor(persistent: string | null = null) {
    this.persistent = persistent;
  }

  async launch(displayMode: DisplayMode = "headless"): Promise<void> {
    if (this.browser || this.context) return;

    ensureBrowserInstalled();

    if (displayMode === "virtual" && os.platform() !== "linux") {
      throw new Error("Display mode 'virtual' is only supported on Linux.");
    }

    const headless = displayMode === "headless" ? true : displayMode === "headed" ? false : "virtual";

    if (this.persistent) {
      const opts = await launchOptions({ headless } as any);
      this.context = await firefox.launchPersistentContext(this.persistent, opts as any);
      const pages = this.context.pages();
      this.page = pages[0] || await this.context.newPage();
    } else {
      this.browser = await Camoufox({ headless } as any) as Browser;
      this.page = await this.browser.newPage();
      this.context = this.page.context();
    }
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Send 'open' command first.");
    return this.page;
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error("Browser not launched. Send 'open' command first.");
    return this.context;
  }

  async getTabsAsync(): Promise<{ index: number; url: string; title: string; active: boolean }[]> {
    const ctx = this.getContext();
    const pages = ctx.pages();
    const tabs = [];
    for (let i = 0; i < pages.length; i++) {
      tabs.push({
        index: i,
        url: pages[i].url(),
        title: await pages[i].title(),
        active: pages[i] === this.page,
      });
    }
    return tabs;
  }

  async switchToTab(index: number): Promise<Page> {
    const ctx = this.getContext();
    const pages = ctx.pages();
    if (index < 0 || index >= pages.length) {
      throw new RangeError(`Tab index ${index} out of range (0-${pages.length - 1})`);
    }
    this.page = pages[index];
    await this.page.bringToFront();
    return this.page;
  }

  async closeCurrentTab(): Promise<void> {
    const ctx = this.getContext();
    const pages = ctx.pages();
    if (pages.length <= 1) {
      throw new Error("Cannot close the last tab. Use 'close' to shut down the browser.");
    }
    const current = this.page!;
    const idx = pages.indexOf(current);
    const newIdx = idx > 0 ? idx - 1 : 1;
    this.page = pages[newIdx];
    await this.page.bringToFront();
    await current.close();
  }

  pushHistory(url: string): void {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url);
    this.historyIndex = this.history.length - 1;
  }

  async goBack(): Promise<string | null> {
    if (this.historyIndex <= 0) return null;
    this.historyIndex--;
    const url = this.history[this.historyIndex];
    await this.getPage().goto(url, { waitUntil: "domcontentloaded" });
    return url;
  }

  async goForward(): Promise<string | null> {
    if (this.historyIndex >= this.history.length - 1) return null;
    this.historyIndex++;
    const url = this.history[this.historyIndex];
    await this.getPage().goto(url, { waitUntil: "domcontentloaded" });
    return url;
  }

  async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
      }
      if (this.context && !this.browser) {
        // persistent context: close context directly
        await this.context.close();
      }
    } catch (e: any) {
      process.stderr.write(`[camoufox-cli] Browser close error (non-fatal): ${e}\n`);
      // If normal close fails, clean up locks so next launch doesn't get stuck
      this.forceCleanLocks();
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.history = [];
    this.historyIndex = -1;
  }

  get isRunning(): boolean {
    return this.browser !== null || this.context !== null;
  }

  /** Return persistent profile directory path (for lock cleanup). */
  getPersistentDir(): string | null {
    return this.persistent;
  }

  /** Force-clean profile lock files (for crash recovery). */
  private forceCleanLocks(): void {
    if (!this.persistent) return;
    for (const name of [".parentlock", "lock"]) {
      try {
        const p = path.join(this.persistent, name);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  }
}
