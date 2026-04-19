#!/usr/bin/env node
/** Entry point: daemon process (spawned by CLI). */

import { DaemonServer } from "./server.js";
import type { DisplayMode } from "./types.js";

const args = process.argv.slice(2);
const DISPLAY_MODES = new Set<DisplayMode>(["headless", "headed", "virtual"]);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

const session = getArg("--session", "default");
const displayModeArg = getArg("--display-mode", args.includes("--headed") ? "headed" : "headless");
if (!DISPLAY_MODES.has(displayModeArg as DisplayMode)) {
  process.stderr.write(`[camoufox-cli] Invalid --display-mode: ${displayModeArg}\n`);
  process.exit(1);
}
const displayMode = displayModeArg as DisplayMode;
const timeout = parseInt(getArg("--timeout", "1800"), 10);
const persistent = args.includes("--persistent") ? getArg("--persistent", "") || null : null;
const proxy = args.includes("--proxy") ? getArg("--proxy", "") || null : null;
const geoip = !args.includes("--no-geoip");
const locale = args.includes("--locale") ? getArg("--locale", "") || null : null;

const server = new DaemonServer({ session, displayMode, timeout, persistent, proxy, geoip, locale });

// Catch uncaught exceptions and unhandled rejections — clean up before exit
process.on("uncaughtException", (err) => {
  process.stderr.write(`[camoufox-cli] Uncaught exception: ${err}\n`);
  server.syncCleanup();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[camoufox-cli] Unhandled rejection: ${reason}\n`);
  server.syncCleanup();
  process.exit(1);
});

process.stderr.write(`[camoufox-cli] Starting daemon session=${session} displayMode=${displayMode}\n`);
server.start().catch((err) => {
  process.stderr.write(`[camoufox-cli] Fatal: ${err}\n`);
  server.syncCleanup();
  process.exit(1);
});
