import { describe, it, expect } from "vitest";
import { normalizeExternalUrl, isValidExternalUrl } from "../externalUrl";

describe("normalizeExternalUrl", () => {
  it("should add https:// to bare domain", () => {
    expect(normalizeExternalUrl("example.com")).toBe("https://example.com");
  });

  it("should add https:// to www. domain", () => {
    expect(normalizeExternalUrl("www.example.com")).toBe("https://www.example.com");
  });

  it("should preserve https:// prefix", () => {
    expect(normalizeExternalUrl("https://example.com")).toBe("https://example.com");
  });

  it("should preserve http:// prefix", () => {
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com");
  });

  it("should handle trailing slash", () => {
    expect(normalizeExternalUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("should handle URL with tracking parameters", () => {
    expect(normalizeExternalUrl("https://example.com/page?utm_source=google")).toBe("https://example.com/page?utm_source=google");
  });

  it("should trim whitespace", () => {
    expect(normalizeExternalUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("should return null for empty string", () => {
    expect(normalizeExternalUrl("")).toBeNull();
  });

  it("should return null for null input", () => {
    expect(normalizeExternalUrl(null)).toBeNull();
  });

  it("should return null for undefined input", () => {
    expect(normalizeExternalUrl(undefined)).toBeNull();
  });
});

describe("isValidExternalUrl", () => {
  it("should validate https:// url", () => {
    expect(isValidExternalUrl("https://example.com")).toBe(true);
  });

  it("should validate http:// url", () => {
    expect(isValidExternalUrl("http://example.com")).toBe(true);
  });

  it("should validate bare domain (auto-adds https)", () => {
    expect(isValidExternalUrl("example.com")).toBe(true);
  });

  it("should reject empty string", () => {
    expect(isValidExternalUrl("")).toBe(false);
  });

  it("should reject null", () => {
    expect(isValidExternalUrl(null)).toBe(false);
  });

  it("should reject undefined", () => {
    expect(isValidExternalUrl(undefined)).toBe(false);
  });

  it("should reject javascript: URI", () => {
    expect(isValidExternalUrl("javascript:alert(1)")).toBe(false);
  });
});
