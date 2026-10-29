import { describe, expect, it, vi } from "vitest";
import { parseBusinessNotes } from "@/services/notesParser";
import { backfillBusinessDetails } from "@/services/websiteAuditBackfill";
import { Business } from "@/types";

vi.mock("@/lib/db", () => ({
  getBusinessesCollection: async () => {
    throw new Error("not used in these tests");
  },
  withDbRetry: async (operation: () => Promise<unknown>) => operation(),
}));

const auditText = `
WEBSITE AUDIT — carolinalandscaping.com
Overall score: 46/100

Address: 1420 Shop Road, Columbia, SC 29201
Phone: (803) 555-0142
Email: info@carolinalandscaping.com, carolinalandscaping@gmail.com
Also listed: no-reply@carolinalandscaping.com

Social: facebook.com/carolinalandscaping
`;

function business(overrides: Partial<Business> = {}): Business {
  return {
    id: "biz-1",
    name: "Carolina Landscaping and Clean Up",
    providerIds: {},
    ...overrides,
  };
}

describe("parseBusinessNotes postal address", () => {
  it("reads a labelled address line", () => {
    const parsed = parseBusinessNotes(auditText);
    expect(parsed.location).toEqual({
      address: "1420 Shop Road",
      city: "Columbia",
      state: "SC",
      zip: "29201",
    });
  });

  it("reads a bare US address without a label", () => {
    const parsed = parseBusinessNotes("Visited 88 Main Street, Aiken, SC 29801 last week.");
    expect(parsed.location?.address).toBe("88 Main Street");
    expect(parsed.location?.city).toBe("Aiken");
  });

  it("ignores an address line that says nothing", () => {
    expect(parseBusinessNotes("Address: Not listed").location).toBeNull();
  });

  it("returns null when the text has no address", () => {
    expect(parseBusinessNotes("Instagram: instagram.com/acme, books with Calendly").location).toBeNull();
  });
});

describe("backfillBusinessDetails", () => {
  it("fills the address and email the Google profile left blank", () => {
    const parsed = parseBusinessNotes(auditText);
    const outcome = backfillBusinessDetails(business(), parsed);

    expect(outcome.business.location).toMatchObject({
      address: "1420 Shop Road",
      city: "Columbia",
      state: "SC",
      zip: "29201",
    });
    // The owner-looking Gmail wins over "info@" and the no-reply address
    expect(outcome.business.enrichment?.preferredEmail).toBe("carolinalandscaping@gmail.com");
    expect(outcome.business.phone).toBe("(803) 555-0142");
    expect(outcome.filled).toEqual(
      expect.arrayContaining(["address", "city", "state", "zip", "email", "phone"])
    );
  });

  it("never overwrites a field that already has a value", () => {
    const parsed = parseBusinessNotes(auditText);
    const existing = business({
      phone: "(803) 111-9999",
      location: { address: "1 Known St", city: "Columbia", state: "SC", zip: "29201" },
      enrichment: {
        status: "COMPLETED",
        preferredEmail: "owner@typedbyhand.com",
        emails: [
          {
            address: "owner@typedbyhand.com",
            type: "BUSINESS",
            sourceUrl: "user provided",
            sourceType: "VISIBLE_TEXT",
            confidence: 100,
          },
        ],
      },
    });

    const outcome = backfillBusinessDetails(existing, parsed);

    expect(outcome.business.phone).toBe("(803) 111-9999");
    expect(outcome.business.location?.address).toBe("1 Known St");
    expect(outcome.business.enrichment?.preferredEmail).toBe("owner@typedbyhand.com");
    expect(outcome.filled).toEqual([]);
  });

  it("does nothing without parsed notes", () => {
    const outcome = backfillBusinessDetails(business(), null);
    expect(outcome.filled).toEqual([]);
    expect(outcome.business.location).toBeUndefined();
  });

  it("keeps the chosen address inside the enrichment email list", () => {
    const parsed = parseBusinessNotes(auditText);
    const outcome = backfillBusinessDetails(business(), parsed);
    const addresses = (outcome.business.enrichment?.emails ?? []).map((e) => e.address);

    expect(addresses).toContain("carolinalandscaping@gmail.com");
    expect(addresses).toContain("info@carolinalandscaping.com");
  });
});