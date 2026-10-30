import { describe, expect, it } from "vitest";
import { authorizeSweep } from "@/lib/sweepAuth";

const base = {
  headerSecret: null,
  querySecret: null,
  authCookie: null,
  cronSecret: "cron-secret-value",
  appPassword: "app-password-value",
};

describe("authorizeSweep", () => {
  it("lets an external scheduler in with the header secret", () => {
    expect(authorizeSweep({ ...base, headerSecret: "cron-secret-value" })).toEqual({
      ok: true,
      via: "cron-secret",
    });
  });

  it("lets an external scheduler in with the query secret", () => {
    expect(authorizeSweep({ ...base, querySecret: "cron-secret-value" })).toEqual({
      ok: true,
      via: "cron-secret",
    });
  });

  it("lets Vercel Cron in with its Bearer header", () => {
    expect(
      authorizeSweep({ ...base, authorizationHeader: "Bearer cron-secret-value" })
    ).toEqual({ ok: true, via: "cron-secret" });
    expect(
      authorizeSweep({ ...base, authorizationHeader: "bearer cron-secret-value" })
    ).toEqual({ ok: true, via: "cron-secret" });
  });

  it("rejects a Bearer header that is not the secret", () => {
    expect(
      authorizeSweep({ ...base, authorizationHeader: "Bearer wrong-value" }).ok
    ).toBe(false);
  });

  it("lets the dashboard in with its auth cookie", () => {
    expect(authorizeSweep({ ...base, authCookie: "app-password-value" })).toEqual({
      ok: true,
      via: "dashboard",
    });
  });

  it("rejects a wrong secret and no session", () => {
    const result = authorizeSweep({ ...base, headerSecret: "nope" });
    expect(result.ok).toBe(false);
  });

  it("rejects a cookie that does not match the app password", () => {
    const result = authorizeSweep({ ...base, authCookie: "some-other-value" });
    expect(result.ok).toBe(false);
  });

  it("says so when CRON_SECRET is missing on the server", () => {
    const result = authorizeSweep({ ...base, cronSecret: undefined, headerSecret: "anything" });
    expect(result).toEqual({
      ok: false,
      reason: "CRON_SECRET is not configured on the server.",
    });
  });

  it("fails closed when nothing is configured at all", () => {
    const result = authorizeSweep({
      headerSecret: null,
      querySecret: null,
      authCookie: null,
      cronSecret: undefined,
      appPassword: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("allows the dashboard even when only APP_PASSWORD is configured", () => {
    expect(
      authorizeSweep({ ...base, cronSecret: undefined, authCookie: "app-password-value" })
    ).toEqual({ ok: true, via: "dashboard" });
  });
});