import { describe, it, expect } from "vitest";
import { parseBusinessNotes, mergeNotesIntoEnrichment } from "../notesParser";
import { EnrichmentData } from "@/types";

describe("parseBusinessNotes", () => {
  it("extracts social profiles with platform and normalized URL", () => {
    const parsed = parseBusinessNotes(
      "Instagram: instagram.com/jlplumbing, Facebook: https://facebook.com/jlplumbing, tiktok.com/@jlplumbing"
    );
    expect(parsed.socialProfiles.map((s) => s.platform)).toEqual([
      "instagram",
      "facebook",
      "tiktok",
    ]);
    expect(parsed.socialProfiles[1].url).toBe("https://facebook.com/jlplumbing");
    expect(parsed.socialProfiles[0].confidence).toBe(100);
  });

  it("detects booking platforms and their names", () => {
    const parsed = parseBusinessNotes("they book clients through calendly.com/jlplumbing");
    expect(parsed.booking?.detected).toBe(true);
    expect(parsed.booking?.systemName).toBe("Calendly");
    expect(parsed.booking?.url).toBe("https://calendly.com/jlplumbing");
  });

  it("detects booking from keyword plus appointment URL", () => {
    const parsed = parseBusinessNotes("bookings are taken at jlplumbing.com/appointments");
    expect(parsed.booking?.detected).toBe(true);
    expect(parsed.booking?.systemName).toBe("online booking");
  });

  it("does not claim booking when the note says there is none", () => {
    const parsed = parseBusinessNotes("no online booking, they only take calls");
    expect(parsed.booking).toBeNull();
  });

  it("extracts email and phone", () => {
    const parsed = parseBusinessNotes(
      "email: info@jlplumbing.com, call (512) 555-0123 or +1-555-333-4444"
    );
    expect(parsed.emails.map((e) => e.address)).toEqual(["info@jlplumbing.com"]);
    expect(parsed.phone).toMatch(/512/);
  });

  it("extracts a general website and never a social URL as the website", () => {
    const parsed = parseBusinessNotes(
      "website is jlplumbing.com and their instagram is instagram.com/jlplumbing"
    );
    expect(parsed.website).toBe("https://jlplumbing.com");
  });

  it("returns empty signals for empty notes", () => {
    const parsed = parseBusinessNotes("");
    expect(parsed.socialProfiles).toEqual([]);
    expect(parsed.booking).toBeNull();
    expect(parsed.emails).toEqual([]);
    expect(parsed.phone).toBeNull();
    expect(parsed.website).toBeNull();
  });

  it("credits social platforms mentioned by keyword alone (no URL)", () => {
    const parsed = parseBusinessNotes(
      "They have a Facebook page and Instagram, plus a Tiktok"
    );
    const platforms = parsed.socialProfiles.map((s) => s.platform);
    expect(platforms).toContain("facebook");
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("tiktok");
    expect(parsed.socialProfiles.every((s) => s.confidence === 60)).toBe(true);
  });

  it("does not credit a platform the note says is absent", () => {
    const parsed = parseBusinessNotes("no facebook page, and no instagram either");
    expect(parsed.socialProfiles).toEqual([]);
  });

  it("does not duplicate a platform already given as a URL", () => {
    const parsed = parseBusinessNotes("instagram.com/jlplumbing and they are on Instagram");
    const instagrams = parsed.socialProfiles.filter((s) => s.platform === "instagram");
    expect(instagrams).toHaveLength(1);
    expect(instagrams[0].url).toBe("https://instagram.com/jlplumbing");
  });

  it("detects booking from a book-online button phrase with no URL", () => {
    const parsed = parseBusinessNotes("they have a book online button on their website");
    expect(parsed.booking?.detected).toBe(true);
    expect(parsed.booking?.systemName).toBe("online booking");
    expect(parsed.booking?.url).toBeUndefined();
  });

  it("does not detect booking when the note explicitly says there is none", () => {
    const parsed = parseBusinessNotes("no booking system, no book online button");
    expect(parsed.booking).toBeNull();
  });

  it("flags a contact channel when the note mentions a contact form or section", () => {
    expect(parseBusinessNotes("separate contact us section is available").mentionsContactForm).toBe(true);
    expect(parseBusinessNotes("they have a contact form on the site").mentionsContactForm).toBe(true);
    expect(parseBusinessNotes("great staff, quick service").mentionsContactForm).toBe(false);
  });
});

describe("mergeNotesIntoEnrichment", () => {
  const baseEnrichment = (overrides: Partial<EnrichmentData> = {}): EnrichmentData => ({
    status: "COMPLETED",
    features: { hasContactForm: false, hasLiveChat: false, hasClickToCall: false, hasSecureSSL: true },
    ...overrides,
  });

  it("adds note emails, fills preferredEmail and keeps crawl emails", () => {
    const merged = mergeNotesIntoEnrichment(
      baseEnrichment({
        emails: [{ address: "crawl@biz.com", type: "UNKNOWN", sourceUrl: "crawl", sourceType: "MAILTO", confidence: 80 }],
      }),
      parseBusinessNotes("email us at info@biz.com")
    );
    expect(merged.emails!.map((e) => e.address)).toEqual(["crawl@biz.com", "info@biz.com"]);
    expect(merged.preferredEmail).toBe("info@biz.com");
  });

  it("fills booking from notes but never overwrites a crawl-detected system", () => {
    const crawled = baseEnrichment({ booking: { detected: true, systemName: "Calendly", url: "https://calendly.com/biz" } });
    expect(mergeNotesIntoEnrichment(crawled, parseBusinessNotes("books via booksy.com/biz")).booking?.systemName).toBe("Calendly");

    const noBooking = baseEnrichment();
    expect(mergeNotesIntoEnrichment(noBooking, parseBusinessNotes("books via booksy.com/biz")).booking?.systemName).toBe("Booksy");
  });

  it("upgrades hasContactForm to true when notes mention a contact section", () => {
    const merged = mergeNotesIntoEnrichment(
      baseEnrichment(),
      parseBusinessNotes("separate contact us section is available")
    );
    expect(merged.features?.hasContactForm).toBe(true);
    // crawl data is preserved
    expect(merged.features?.hasSecureSSL).toBe(true);
  });

  it("keeps multiple keyword-only social profiles (no url-collision dedupe)", () => {
    const merged = mergeNotesIntoEnrichment(
      baseEnrichment(),
      parseBusinessNotes("they have a Facebook page and Instagram")
    );
    expect(merged.socialProfiles!.map((s) => s.platform)).toEqual(["facebook", "instagram"]);
  });

  it("fills phones only when the crawl found none", () => {
    const noPhones = mergeNotesIntoEnrichment(baseEnrichment(), parseBusinessNotes("call (512) 555-0123"));
    expect(noPhones.phones).toHaveLength(1);

    const withPhones = mergeNotesIntoEnrichment(
      baseEnrichment({ phones: [{ number: "+15559999999", normalized: "+15559999999", sourceUrl: "crawl", sourceType: "TEL_LINK", confidence: 95 }] }),
      parseBusinessNotes("call (512) 555-0123")
    );
    expect(withPhones.phones).toHaveLength(1);
    expect(withPhones.phones![0].normalized).toBe("+15559999999");
  });
});