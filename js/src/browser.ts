/** Browser manager: launches and manages Camoufox instance. */

import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { Camoufox, launchOptions } from "camoufox-js";
import { firefox, type Browser, type BrowserContext, type Page } from "playwright-core";
import { loadOrCreate, proxyGeoConfig, toLaunchOptions } from "./identity.js";
import { parseProxySettings } from "./proxy.js";
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
  private proxy: string | null;
  private geoip: boolean;
  private locale: string | null;
  private timezone: string | null;
  private history: string[] = [];
  private historyIndex = -1;
  private _disconnected = false;
  private _disconnectReason: string | null = null;

  constructor(persistent: string | null = null, proxy: string | null = null, geoip: boolean = true, locale: string | null = null, timezone: string | null = null) {
    this.persistent = persistent;
    this.proxy = proxy;
    this.geoip = geoip;
    this.locale = locale;
    this.timezone = timezone;
  }

  async launch(displayMode: DisplayMode = "headless"): Promise<void> {
    if (this.browser || this.context) return;

    ensureBrowserInstalled();

    if (displayMode === "virtual" && os.platform() !== "linux") {
      throw new Error("Display mode 'virtual' is only supported on Linux.");
    }

    const headless = displayMode === "headless" ? true : displayMode === "headed" ? false : "virtual";

    const launchOpts: Record<string, unknown> = { headless };
    let proxySettings: { server: string; username?: string; password?: string } | null = null;

    if (this.proxy) {
      const settings = parseProxySettings(this.proxy);
      proxySettings = settings.proxy;
      launchOpts.proxy = settings.proxy;
      if (this.geoip && this.persistent) {
        // Persistent identity handles GeoIP itself so stored values stay stable.
      } else if (this.geoip && this.timezone) {
        const geoConfig = await proxyGeoConfig(this.proxy);
        if (geoConfig) {
          launchOpts.config = { ...(launchOpts.config as Record<string, unknown> | undefined), ...geoConfig };
        }
      } else if (this.geoip) {
        launchOpts.geoip = true;
      }
    }

    if (this.persistent) {
      fs.mkdirSync(this.persistent, { recursive: true });
      const identity = await loadOrCreate(
        this.persistent,
        this.locale,
        this.proxy,
        this.geoip,
      );
      Object.assign(launchOpts, toLaunchOptions(identity));
      this.applyTimezoneOverride(launchOpts);
      const opts = await launchOptions(launchOpts as any);
      this.context = await firefox.launchPersistentContext(this.persistent, opts as any);
      const pages = this.context.pages();
      this.page = pages[0] || await this.context.newPage();
    } else {
      if (this.locale) {
        // Accept "en-US" or a comma-separated list "en-US,en,zh-CN".
        const locales = this.locale.split(",").map((s) => s.trim()).filter(Boolean);
        if (locales.length > 0) {
          launchOpts.locale = locales.length > 1 ? locales : locales[0];
        }
      }
      this.applyTimezoneOverride(launchOpts);
      this.browser = await Camoufox(launchOpts as any) as Browser;
      this.page = await this.browser.newPage();
      this.context = this.page.context();
    }

    // Listen for browser disconnection (process crash, killed, etc.)
    if (this.browser) {
      this.browser.on("disconnected", () => {
        this._disconnected = true;
        this._disconnectReason = "browser_disconnected";
        process.stderr.write(`[camoufox-cli] Browser disconnected (process died)\n`);
      });
    }
    if (this.context) {
      // For persistent context, get the underlying browser via context.browser()
      const ctxBrowser = this.context.browser();
      if (ctxBrowser) {
        ctxBrowser.on("disconnected", () => {
          this._disconnected = true;
          this._disconnectReason = "context_browser_disconnected";
          process.stderr.write(`[camoufox-cli] Context browser disconnected (process died)\n`);
        });
      }
    }

    // Workaround: Playwright's Firefox (Juggler) fails proxy auth on HTTPS
    // CONNECT tunnels, raising NS_ERROR_PROXY_AUTHENTICATION_FAILED.
    // Inject Basic auth as an extra HTTP header like WebKit/Chromium do.
    if (proxySettings?.username) {
      const creds = `${proxySettings.username}:${proxySettings.password ?? ""}`;
      const token = Buffer.from(creds, "utf8").toString("base64");
      await this.context.setExtraHTTPHeaders({
        "Proxy-Authorization": `Basic ${token}`,
      });
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
    this._disconnected = false;
    this._disconnectReason = null;
  }

  get isRunning(): boolean {
    if (this._disconnected) return false;
    return this.browser !== null || this.context !== null;
  }

  /** Whether the browser process disconnected (crashed/killed). */
  get isDisconnected(): boolean {
    return this._disconnected;
  }

  /** Reason for disconnection, if any. */
  get disconnectReason(): string | null {
    return this._disconnectReason;
  }

  private applyTimezoneOverride(launchOpts: Record<string, unknown>): void {
    if (!this.timezone) return;
    const existingConfig = launchOpts.config as Record<string, unknown> | undefined;
    launchOpts.config = { ...existingConfig, timezone: this.timezone };
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
