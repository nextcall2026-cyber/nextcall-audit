import { describe, it, expect } from "vitest";
import { opportunityService } from "../opportunityService";
import { Business, EnrichmentData } from "@/types";

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: "test-1",
    name: "Test Business",
    phone: "+15551234567",
    website: "https://example.com",
    location: { lat: 40.7128, lng: -74.006, address: "123 Main St", city: "NYC", state: "NY" },
    rating: 4.2,
    reviewCount: 30,
    categories: ["Plumber"],
    providerIds: { serpapi: "abc123" },
    sources: ["serpapi"],
    sourceProviders: ["SERPAPI"],
    ...overrides,
  };
}

function makeEnriched(overrides: Partial<EnrichmentData> = {}): EnrichmentData {
  return {
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    website: { url: "https://example.com", isReachable: true },
    emails: [{ address: "info@example.com", type: "BUSINESS", sourceUrl: "", sourceType: "MAILTO", confidence: 95 }],
    preferredEmail: "info@example.com",
    booking: { detected: true, systemName: "Calendly" },
    socialProfiles: [{ platform: "facebook", url: "https://facebook.com/example", sourceUrl: "", confidence: 90 }],
    features: { hasContactForm: true, hasLiveChat: true, hasClickToCall: true, hasSecureSSL: true },
    crawlMetadata: {
      pagesAttempted: 3, pagesSuccessful: 3, pagesFailed: 0,
      pagesVisited: ["https://example.com"], crawlQuality: "STATIC_COMPLETE",
      renderingRequired: false, crawlDurationMs: 5000,
    },
    ...overrides,
  };
}

describe("OpportunityService", () => {
  // A fully digital-mature plumber has phone-dependency reason but low overall score
  it("should return LOW for a digitally mature business", () => {
    const business = makeBusiness({
      enrichment: makeEnriched(),
    });
    const result = opportunityService.calculateScore(business);
    expect(result.level).toBe("LOW");
    expect(result.score).toBeLessThan(30);
    // Plumber category triggers phone-dependency signal
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
  });

  // No website = strong opportunity (MEDIUM+) 
  it("should score higher for business with no website", () => {
    const business = makeBusiness({
      website: undefined,
      enrichment: undefined,
    });
    const result = opportunityService.calculateScore(business);
    expect(result.score).toBeGreaterThanOrEqual(30);
    const allReasons = result.reasons.join(' ');
    expect(allReasons).toContain("No website");
  });

  // No booking detected should add points and mention it
  it("should detect no booking as opportunity", () => {
    const business = makeBusiness({
      categories: ["General Contractor"],
      enrichment: makeEnriched({ booking: { detected: false } }),
    });
    const result = opportunityService.calculateScore(business);
    expect(result.score).toBeGreaterThanOrEqual(15);
    const allReasons = result.reasons.join(' ');
    expect(allReasons).toContain("booking");
    expect(allReasons).toContain("Phone");
  });

  // Should include evidence
  it("should include evidence and unknownFactors in result", () => {
    const business = makeBusiness({
      enrichment: makeEnriched(),
    });
    const result = opportunityService.calculateScore(business);
    expect(result).toHaveProperty("evidence");
    expect(result).toHaveProperty("unknownFactors");
    expect(result).toHaveProperty("scoreBreakdown");
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(Array.isArray(result.unknownFactors)).toBe(true);
    expect(Array.isArray(result.scoreBreakdown)).toBe(true);
  });

  // Should not treat unknown as verified
  it("should not treat unverified factors as detected", () => {
    // Business with website but no enrichment
    const business = makeBusiness({
      enrichment: undefined,
    });
    const result = opportunityService.calculateScore(business);
    // Should have unknownFactors for things not verified
    expect(result.unknownFactors.length).toBeGreaterThan(0);
    // Should NOT claim "no booking" without having verified it
    const noBookingClaim = result.reasons.find(r => r.toLowerCase().includes("no") && r.toLowerCase().includes("booking"));
    // The only booking-related claims should use qualifying language
    if (noBookingClaim) {
      expect(noBookingClaim).toContain("potential");
    }
  });

  // Phone-dependent category adds score
  it("should detect phone-dependent service categories", () => {
    const business = makeBusiness({
      categories: ["Plumbing"],
      enrichment: makeEnriched({ booking: { detected: false } }),
    });
    const result = opportunityService.calculateScore(business);
    const allReasons = result.reasons.join(' ');
    expect(allReasons).toContain("Phone");
  });

  // Score breakdown should have items
  it("should have transparent score breakdown", () => {
    const business = makeBusiness({
      website: undefined,
      enrichment: undefined,
    });
    const result = opportunityService.calculateScore(business);
    expect(result.scoreBreakdown.length).toBeGreaterThan(0);
    const breakdownItem = result.scoreBreakdown[0];
    expect(breakdownItem).toHaveProperty("category");
    expect(breakdownItem).toHaveProperty("signal");
    expect(breakdownItem).toHaveProperty("points");
    expect(breakdownItem).toHaveProperty("maxPoints");
    expect(breakdownItem).toHaveProperty("status");
    expect(["DETECTED", "NOT_DETECTED", "UNVERIFIED"]).toContain(breakdownItem.status);
  });

  // Business with no email but all else good should get medium
  it("should score higher when email is missing", () => {
    const businessWithoutEmail = makeBusiness({
      enrichment: makeEnriched({ emails: [], preferredEmail: undefined }),
    });
    const businessWithEmail = makeBusiness({
      enrichment: makeEnriched(),
    });
    const resultNoEmail = opportunityService.calculateScore(businessWithoutEmail);
    const resultWithEmail = opportunityService.calculateScore(businessWithEmail);
    expect(resultNoEmail.score).toBeGreaterThan(resultWithEmail.score);
  });

  // Score is clamped 0-100
  it("should clamp score to 0-100", () => {
    // Max out all signals
    const business = makeBusiness({
      website: undefined,
      phone: undefined,
      enrichment: makeEnriched({
        booking: { detected: false },
        socialProfiles: [],
        emails: [],
        preferredEmail: undefined,
        features: { hasContactForm: false, hasLiveChat: false, hasClickToCall: false, hasSecureSSL: false },
      }),
    });
    const result = opportunityService.calculateScore(business);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
