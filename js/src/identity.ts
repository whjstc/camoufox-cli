/** Persistent identity: freeze fingerprint/OS into a persistent dir.
 *
 * When launched with `--persistent <dir>`, a `camoufox-cli.json` file is
 * written on first launch with the generated fingerprint, OS, locale, and
 * derived timezone/geolocation. Later launches reload it so sites see the same
 * device identity.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Fingerprint } from "fingerprint-generator";
import { generateFingerprint } from "camoufox-js/dist/fingerprints.js";
import { publicIP, validIPv4, validIPv6 } from "camoufox-js/dist/ip.js";
import { getGeolocation } from "camoufox-js/dist/locale.js";
import { parseProxySettings } from "./proxy.js";

const IDENTITY_FILENAME = "camoufox-cli.json";
const IDENTITY_VERSION = 1;

export type HostOS = "windows" | "macos" | "linux";

export interface Identity {
  version: number;
  created_at: string;
  os: HostOS;
  locale: string | null;
  fingerprint: Fingerprint;
  config: Record<string, unknown>;
}

function hostOS(): HostOS {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function identityPath(persistentDir: string): string {
  return join(persistentDir, IDENTITY_FILENAME);
}

export async function loadOrCreate(
  persistentDir: string,
  locale: string | null,
  proxy: string | null,
  geoip: boolean,
): Promise<Identity> {
  const path = identityPath(persistentDir);
  if (existsSync(path)) {
    const identity = JSON.parse(readFileSync(path, "utf8")) as Identity;
    const changed = await applyCliOverrides(identity, locale, proxy, geoip);
    if (changed) writeFileSync(path, JSON.stringify(identity, null, 2));
    return identity;
  }

  const os_ = hostOS();
  const fingerprint = generateFingerprint(undefined, { operatingSystems: [os_] });
  const config: Record<string, unknown> = {
    "canvas:aaOffset": Math.floor(Math.random() * 101) - 50,
    "canvas:aaCapOffset": Math.random() < 0.5,
    "fonts:spacing_seed": Math.floor(Math.random() * 0x1_0000_0000),
  };

  if (proxy && geoip) {
    mergeGeo(config, await geolocateProxy(proxy));
  }

  const identity: Identity = {
    version: IDENTITY_VERSION,
    created_at: new Date().toISOString(),
    os: os_,
    locale,
    fingerprint,
    config,
  };

  mkdirSync(persistentDir, { recursive: true });
  writeFileSync(path, JSON.stringify(identity, null, 2));
  return identity;
}

async function applyCliOverrides(
  identity: Identity,
  locale: string | null,
  proxy: string | null,
  geoip: boolean,
): Promise<boolean> {
  let changed = false;

  if (locale !== null && identity.locale !== locale) {
    identity.locale = locale;
    changed = true;
  }

  if (proxy && geoip) {
    identity.config ??= {};
    const derived = await geolocateProxy(proxy);
    if (mergeGeo(identity.config, derived)) changed = true;
  }

  return changed;
}

function mergeGeo(config: Record<string, unknown>, derived: GeoInfo | null): boolean {
  if (!derived) return false;
  let changed = false;

  if (derived.timezone && config.timezone !== derived.timezone) {
    config.timezone = derived.timezone;
    changed = true;
  }

  if (derived.latitude !== undefined && derived.longitude !== undefined) {
    if (config["geolocation:latitude"] !== derived.latitude) {
      config["geolocation:latitude"] = derived.latitude;
      changed = true;
    }
    if (config["geolocation:longitude"] !== derived.longitude) {
      config["geolocation:longitude"] = derived.longitude;
      changed = true;
    }
    if (derived.accuracy !== undefined && config["geolocation:accuracy"] !== derived.accuracy) {
      config["geolocation:accuracy"] = derived.accuracy;
      changed = true;
    }
  }

  return changed;
}

export function toLaunchOptions(identity: Identity): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    fingerprint: identity.fingerprint,
    os: identity.os,
    config: { ...(identity.config || {}) },
  };

  if (identity.locale) {
    const parts = identity.locale.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      opts.locale = parts.length > 1 ? parts : parts[0];
    }
  }

  return opts;
}

export async function proxyGeoConfig(proxyUrl: string): Promise<Record<string, unknown> | null> {
  const derived = await geolocateProxy(proxyUrl);
  if (!derived) return null;
  const config: Record<string, unknown> = {};
  mergeGeo(config, derived);
  return config;
}

interface GeoInfo {
  timezone?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

async function geolocateProxy(proxyUrl: string): Promise<GeoInfo | null> {
  try {
    const ip = await publicIP(proxyUrlWithAuth(proxyUrl));
    if (!validIPv4(ip) && !validIPv6(ip)) return null;
    const geo = await getGeolocation(ip);
    const out: GeoInfo = {
      timezone: geo.timezone,
      latitude: geo.latitude,
      longitude: geo.longitude,
    };
    if (geo.accuracy !== undefined) out.accuracy = geo.accuracy;
    return out;
  } catch {
    return null;
  }
}

function proxyUrlWithAuth(proxyUrl: string): string {
  const settings = parseProxySettings(proxyUrl).proxy;
  if (!settings.username) return settings.server;
  const url = new URL(settings.server);
  url.username = encodeURIComponent(settings.username);
  url.password = encodeURIComponent(settings.password ?? "");
  return url.href;
}
