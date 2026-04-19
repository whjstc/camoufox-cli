/** Unix socket server for the camoufox-cli daemon. */

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { BrowserManager } from "./browser.js";
import { execute } from "./commands.js";
import { parseCommand, serializeResponse } from "./protocol.js";
import type { DisplayMode } from "./types.js";

export class DaemonServer {
  private session: string;
  private displayMode: DisplayMode;
  private timeout: number;
  private socketPath: string;
  private pidPath: string;
  private manager: BrowserManager;
  private server: net.Server | null = null;
  private lastActivity = Date.now();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  constructor(opts: { session?: string; displayMode?: DisplayMode; timeout?: number; persistent?: string | null }) {
    this.session = opts.session ?? "default";
    this.displayMode = opts.displayMode ?? "headless";
    this.timeout = opts.timeout ?? 1800;
    this.socketPath = `/tmp/camoufox-cli-${this.session}.sock`;
    this.pidPath = `/tmp/camoufox-cli-${this.session}.pid`;
    this.manager = new BrowserManager(opts.persistent ?? null);
  }

  async start(): Promise<void> {
    this.cleanupStale();
    this.writePid();
    // Idle timeout watchdog
    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastActivity > this.timeout * 1000) {
        process.stderr.write(`[camoufox-cli] Idle timeout (${this.timeout}s), shutting down\n`);
        this.server?.close();
      }
    }, 10000);

    // Signal handlers
    const gracefulShutdown = (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      process.stderr.write(`[camoufox-cli] Received ${signal}, shutting down\n`);
      this.server?.close();
    };
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

    this.server = net.createServer({ allowHalfOpen: true }, (conn) => this.handleConnection(conn));

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.socketPath, () => resolve());
      this.server!.on("error", reject);
    });

    process.stderr.write(`[camoufox-cli] Daemon listening session=${this.session}\n`);

    // Wait until server closes
    await new Promise<void>((resolve) => {
      this.server!.on("close", resolve);
    });

    await this.shutdown();
  }

  private handleConnection(conn: net.Socket): void {
    let data = "";
    let handled = false;

    const processData = async () => {
      if (handled) return;
      const nlIdx = data.indexOf("\n");
      if (nlIdx < 0) return;
      handled = true;

      this.lastActivity = Date.now();
      const line = data.slice(0, nlIdx).trim();
      if (!line) { conn.destroy(); return; }

      try {
        const command = parseCommand(line);

        if (command.action === "open") {
          command.params.headless ??= this.displayMode === "headless" ? true : this.displayMode === "headed" ? false : "virtual";
        }

        const response = await execute(this.manager, command as any);
        conn.end(serializeResponse(response));

        if (command.action === "close") {
          this.server?.close();
        }
      } catch (e: any) {
        conn.end(Buffer.from(JSON.stringify({ id: "?", success: false, error: String(e) }) + "\n"));
      }
    };

    conn.on("data", (chunk) => {
      data += chunk.toString();
      processData();
    });

    conn.on("end", () => { processData(); });
  }

  private cleanupStale(): void {
    if (fs.existsSync(this.socketPath)) {
      if (fs.existsSync(this.pidPath)) {
        try {
          const pid = parseInt(fs.readFileSync(this.pidPath, "utf-8").trim(), 10);
          process.kill(pid, 0); // Check if alive
          process.stderr.write(`[camoufox-cli] Daemon already running (pid ${pid})\n`);
          process.exit(1);
        } catch {
          // Stale pid — try to kill leftover process group
          try {
            const stalePid = parseInt(fs.readFileSync(this.pidPath, "utf-8").trim(), 10);
            try { process.kill(-stalePid, "SIGKILL"); } catch {}
            process.stderr.write(`[camoufox-cli] Killed stale daemon process group ${stalePid}\n`);
          } catch {}
        }
      }
      fs.unlinkSync(this.socketPath);
    }
    try { fs.unlinkSync(this.pidPath); } catch {}
    this.cleanupProfileLocks();
  }

  private writePid(): void {
    fs.writeFileSync(this.pidPath, String(process.pid));
  }

  private async shutdown(): Promise<void> {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    await this.manager.close();
    this.cleanupProfileLocks();
    if (this.server) {
      try { this.server.close(); } catch {}
    }
    for (const p of [this.socketPath, this.pidPath]) {
      try { fs.unlinkSync(p); } catch {}
    }
  }

  /** Synchronous cleanup — called from uncaught/unhandled/fatal in daemon.ts. */
  syncCleanup(): void {
    for (const p of [this.socketPath, this.pidPath]) {
      try { fs.unlinkSync(p); } catch {}
    }
    this.cleanupProfileLocks();
  }

  /** Clean Firefox profile lock files for persistent sessions. */
  private cleanupProfileLocks(): void {
    const profileDir = this.manager.getPersistentDir();
    if (!profileDir) return;
    for (const name of [".parentlock", "lock"]) {
      try {
        const p = path.join(profileDir, name);
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
          process.stderr.write(`[camoufox-cli] Cleaned lock: ${p}\n`);
        }
      } catch {}
    }
  }
}
