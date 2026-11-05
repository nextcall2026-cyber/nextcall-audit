import { describe, it, expect } from "vitest";
import { dedupeKeysFor, dedupeKeyFor } from "@/services/businessIngestService";

describe("dedupeKeysFor", () => {
  it("collects domain, name and phone keys", () => {
    const keys = dedupeKeysFor("BlueBird Plumbing", "https://mybluebirdservices.com", "+1 406-995-3668");
    expect(keys).toContain("d:mybluebirdservices.com");
    expect(keys).toContain("n:bluebirdplumbing");
    expect(keys).toContain("p:4069953668");
  });

  it("keeps working when the website or phone is missing", () => {
    const keys = dedupeKeysFor("BlueBird Plumbing", null, null);
    expect(keys).toEqual(["n:bluebirdplumbing"]);
  });

  it("ignores short/garbage phone numbers", () => {
    const keys = dedupeKeysFor("Acme", null, "12345");
    expect(keys).toEqual(["n:acme"]);
  });

  it("matches US numbers with and without the country code", () => {
    const a = dedupeKeysFor("Acme", null, "+1 406-995-3668");
    const b = dedupeKeysFor("Acme", null, "(406) 995-3668");
    expect(a).toContain("p:4069953668");
    expect(b).toContain("p:4069953668");
  });

  it("stores the most specific key first", () => {
    expect(dedupeKeyFor("Acme", "acme.com", "+1 406-995-3668")).toBe("d:acme.com");
    expect(dedupeKeyFor("Acme", null, "+1 406-995-3668")).toBe("p:4069953668");
    expect(dedupeKeyFor("Acme", null, null)).toBe("n:acme");
  });
});
