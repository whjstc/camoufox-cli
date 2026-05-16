import { describe, expect, it } from "vitest";
import { toLaunchOptions, type Identity } from "../src/identity.js";

describe("persistent identity launch options", () => {
  it("restores fingerprint, OS, config, and locale", () => {
    const identity: Identity = {
      version: 1,
      created_at: "2026-04-22T00:00:00.000Z",
      os: "macos",
      locale: "en-US,zh-CN",
      fingerprint: { navigator: { userAgent: "test" } } as any,
      config: { timezone: "Asia/Shanghai" },
    };

    expect(toLaunchOptions(identity)).toEqual({
      fingerprint: identity.fingerprint,
      os: "macos",
      locale: ["en-US", "zh-CN"],
      config: { timezone: "Asia/Shanghai" },
    });
  });
});
