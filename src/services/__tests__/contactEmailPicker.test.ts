import { describe, expect, it } from "vitest";
import {
  isPlausibleEmail,
  matchesBusinessName,
  pickBestEmail,
  pickBestEmailForBusiness,
} from "@/services/contactEmailPicker";
import { Business } from "@/types";

const business = (overrides: Partial<Business>): Business => ({
  id: "biz-1",
  name: "Carolina Landscaping and Clean Up",
  providerIds: {},
  ...overrides,
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary business addresses", () => {
    expect(isPlausibleEmail("info@carolinalandscaping.com")).toBe(true);
    expect(isPlausibleEmail("Carol.Landscaping@Gmail.com")).toBe(true);
  });

  it("rejects machine mailboxes, platform addresses and file names", () => {
    expect(isPlausibleEmail("no-reply@acme.com")).toBe(false);
    expect(isPlausibleEmail("noreply@acme.com")).toBe(false);
    expect(isPlausibleEmail("postmaster@acme.com")).toBe(false);
    expect(isPlausibleEmail("support@sentry.io")).toBe(false);
    expect(isPlausibleEmail("hello@example.com")).toBe(false);
    // "logo@2x.png" is a file name that a naive regex reads as an email
    expect(isPlausibleEmail("logo@2x.png")).toBe(false);
    expect(isPlausibleEmail("banner@3x.jpg")).toBe(false);
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail(null)).toBe(false);
  });
});

describe("matchesBusinessName", () => {
  it("recognises the business name inside an address", () => {
    expect(matchesBusinessName("carolinalandscaping", "Carolina Landscaping and Clean Up")).toBe(true);
    expect(matchesBusinessName("joeburns", "Joe Burns Heating And Air")).toBe(true);
    expect(matchesBusinessName("efmartin", "E.F. Martin Mechanical Contractors, Inc.")).toBe(true);
  });

  it("does not claim unrelated mailboxes", () => {
    expect(matchesBusinessName("info", "Carolina Landscaping and Clean Up")).toBe(false);
    expect(matchesBusinessName("sales", "Deal's Plumbing LLC")).toBe(false);
  });
});

describe("pickBestEmail", () => {
  it("prefers the business-name Gmail over a generic address", () => {
    const picked = pickBestEmail(
      ["info@carolinalandscaping.com", "carolinalandscaping@gmail.com"],
      "Carolina Landscaping and Clean Up"
    );
    expect(picked).toBe("carolinalandscaping@gmail.com");
  });

  it("takes the first address when no name-matched mailbox exists", () => {
    const picked = pickBestEmail(
      ["info@acme.com", "bob@otherfirm.com"],
      "Zeta Roofing"
    );
    expect(picked).toBe("info@acme.com");
  });

  it("uses the first address after dropping noise", () => {
    const picked = pickBestEmail(
      ["no-reply@acme.com", "logo@2x.png", "office@acme.com"],
      "Zeta Roofing"
    );
    expect(picked).toBe("office@acme.com");
  });

  it("returns null when nothing usable is left", () => {
    expect(pickBestEmail(["no-reply@acme.com", "logo@2x.png"], "Zeta Roofing")).toBeNull();
    expect(pickBestEmail([], "Zeta Roofing")).toBeNull();
  });

  it("de-duplicates case-insensitively", () => {
    const picked = pickBestEmail(["Info@Acme.com", "info@acme.com"], "Zeta Roofing");
    expect(picked).toBe("info@acme.com");
  });
});

describe("pickBestEmailForBusiness", () => {
  it("never overrides an address the operator typed", () => {
    const picked = pickBestEmailForBusiness(
      business({
        enrichment: {
          status: "COMPLETED",
          preferredEmail: "owner@myownchoice.com",
          emails: [
            {
              address: "owner@myownchoice.com",
              type: "BUSINESS",
              sourceUrl: "user provided",
              sourceType: "VISIBLE_TEXT",
              confidence: 100,
            },
            {
              address: "carolinalandscaping@gmail.com",
              type: "BUSINESS",
              sourceUrl: "https://carolinalandscaping.com",
              sourceType: "MAILTO",
              confidence: 80,
            },
          ],
        },
      })
    );
    expect(picked).toBe("owner@myownchoice.com");
  });

  it("finds an address in the business notes when the crawl found none", () => {
    const picked = pickBestEmailForBusiness(
      business({
        enrichment: { status: "NOT_STARTED" },
        notes: "Website audit\nAddress: 12 Oak St, Columbia, SC 29201\nEmail: carolinalandscaping@gmail.com",
      })
    );
    expect(picked).toBe("carolinalandscaping@gmail.com");
  });

  it("returns null when the profile holds no usable address", () => {
    expect(pickBestEmailForBusiness(business({}))).toBeNull();
    expect(pickBestEmailForBusiness(null)).toBeNull();
  });
});