import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  MAILGUN_SIGNATURE_MAX_AGE_MS,
  mapMailgunEvent,
  mapMailtrapEvent,
  verifyHmacSha256Hex,
  verifyMailgunSignature,
} from "@/lib/webhookEvents";

describe("mapMailgunEvent", () => {
  it("records delivered without suppressing", () => {
    expect(mapMailgunEvent("delivered")).toEqual({
      outcome: "DELIVERED",
      suppress: false,
      reason: null,
    });
  });

  it("maps every hard-failure spelling to BOUNCED + suppression", () => {
    for (const event of ["permanent_fail", "bounced", "dropped"]) {
      const mapped = mapMailgunEvent(event);
      expect(mapped.outcome).toBe("BOUNCED");
      expect(mapped.suppress).toBe(true);
    }
  });

  it("maps failed events by severity", () => {
    expect(mapMailgunEvent("failed", "permanent").outcome).toBe("BOUNCED");
    expect(mapMailgunEvent("failed", "permanent").suppress).toBe(true);
    expect(mapMailgunEvent("failed", "temporary")).toEqual({
      outcome: null,
      suppress: false,
      reason: null,
    });
    // Missing severity means the permanent-fail webhook — the safe reading.
    expect(mapMailgunEvent("failed").outcome).toBe("BOUNCED");
  });

  it("maps complaints and unsubscribes to suppression", () => {
    expect(mapMailgunEvent("complained")).toEqual({
      outcome: "COMPLAINED",
      suppress: true,
      reason: "COMPLAINED",
    });
    expect(mapMailgunEvent("unsubscribed")).toEqual({
      outcome: null,
      suppress: true,
      reason: "UNSUBSCRIBED",
    });
  });

  it("ignores engagement events", () => {
    for (const event of ["opened", "clicked", "accepted", "temporary_fail", ""]) {
      expect(mapMailgunEvent(event)).toEqual({ outcome: null, suppress: false, reason: null });
    }
  });
});

describe("mapMailtrapEvent", () => {
  it("records delivery without suppressing", () => {
    expect(mapMailtrapEvent("delivery")).toEqual({
      outcome: "DELIVERED",
      suppress: false,
      reason: null,
    });
  });

  it("maps bounce and reject to BOUNCED + suppression", () => {
    expect(mapMailtrapEvent("bounce").outcome).toBe("BOUNCED");
    expect(mapMailtrapEvent("bounce").suppress).toBe(true);
    expect(mapMailtrapEvent("reject").outcome).toBe("BOUNCED");
    expect(mapMailtrapEvent("reject").reason).toBe("REJECTED");
  });

  it("maps spam and unsubscribe to suppression", () => {
    expect(mapMailtrapEvent("spam")).toEqual({
      outcome: "COMPLAINED",
      suppress: true,
      reason: "COMPLAINED",
    });
    expect(mapMailtrapEvent("unsubscribe")).toEqual({
      outcome: null,
      suppress: true,
      reason: "UNSUBSCRIBED",
    });
  });

  it("ignores soft bounces, suspensions and engagement events", () => {
    for (const event of ["soft bounce", "suspension", "open", "click", ""]) {
      expect(mapMailtrapEvent(event)).toEqual({ outcome: null, suppress: false, reason: null });
    }
  });
});

describe("verifyHmacSha256Hex", () => {
  const secret = "webhook-secret";
  const payload = '{"events":[]}';

  it("accepts a correct signature", () => {
    const signature = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    expect(verifyHmacSha256Hex(secret, payload, signature)).toBe(true);
  });

  it("accepts a prefixed or uppercase signature", () => {
    const signature = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    expect(verifyHmacSha256Hex(secret, payload, `sha256=${signature.toUpperCase()}`)).toBe(true);
  });

  it("rejects a wrong signature, wrong secret or missing input", () => {
    const signature = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
    expect(verifyHmacSha256Hex(secret, payload + "x", signature)).toBe(false);
    expect(verifyHmacSha256Hex("other-secret", payload, signature)).toBe(false);
    expect(verifyHmacSha256Hex(secret, payload, "")).toBe(false);
    expect(verifyHmacSha256Hex("", payload, signature)).toBe(false);
  });
});

describe("verifyMailgunSignature", () => {
  const signingKey = "mailgun-signing-key";
  const timestamp = "1700000000";
  const token = "token-123";
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(`${timestamp}${token}`, "utf8")
    .digest("hex");
  const nowMs = 1700000000 * 1000;

  it("accepts a fresh valid signature", () => {
    expect(verifyMailgunSignature(signingKey, timestamp, token, signature, nowMs)).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    expect(
      verifyMailgunSignature(
        signingKey,
        timestamp,
        token,
        signature,
        nowMs + MAILGUN_SIGNATURE_MAX_AGE_MS + 1
      )
    ).toBe(false);
  });

  it("rejects a tampered token and a wrong key", () => {
    expect(verifyMailgunSignature(signingKey, timestamp, "other-token", signature, nowMs)).toBe(false);
    expect(verifyMailgunSignature("other-key", timestamp, token, signature, nowMs)).toBe(false);
    expect(verifyMailgunSignature(signingKey, "not-a-number", token, signature, nowMs)).toBe(false);
    expect(verifyMailgunSignature(signingKey, "", token, signature, nowMs)).toBe(false);
  });
});
