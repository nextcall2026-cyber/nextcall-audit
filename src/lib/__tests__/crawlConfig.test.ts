import { describe, it, expect } from "vitest";
import { scoreCandidatePage, getUrlScore, CRAWL_LIMITS } from "@/lib/crawlConfig";

/**
 * These rules decide which pages of a real business site the audit ever sees.
 * They were measured against https://www.davidpriceconstruction.com/, where the
 * old anchored patterns scored "/commercial-services" and every city service
 * page as 0 — leaving only 2 eligible links out of 21, so the crawl budget went
 * unused and the audit was written from the homepage alone.
 */
describe("scoreCandidatePage", () => {
  it("still prioritises contact and about", () => {
    expect(scoreCandidatePage("https://x.com/contact")).toBe(100);
    expect(scoreCandidatePage("https://x.com/contact-us")).toBe(100);
    expect(scoreCandidatePage("https://x.com/about-us")).toBe(80);
  });

  it("does not need the path to END with the keyword", () => {
    // The bug: "/commercial-services" has a hyphen before "services", so an
    // anchored /services?$/ pattern never matched it.
    expect(scoreCandidatePage("https://x.com/commercial-services")).toBeGreaterThan(0);
    expect(scoreCandidatePage("https://x.com/residential-services")).toBeGreaterThan(0);
    expect(scoreCandidatePage("https://x.com/commercial-services/green-building-and-leed-ap")).toBeGreaterThan(0);
  });

  it("scores a page by its link label when the path says nothing", () => {
    // A small business names pages by what it does, not by page type.
    expect(scoreCandidatePage("https://x.com/raleigh-kitchen-remodel-contractor", "Raleigh Kitchen Remodel")).toBeGreaterThan(0);
    expect(scoreCandidatePage("https://x.com/p1", "Bathroom Remodel")).toBeGreaterThan(0);
    expect(scoreCandidatePage("https://x.com/p2", "Roof Repair")).toBeGreaterThan(0);
  });

  it("takes the better of the path and the label", () => {
    const byPathOnly = scoreCandidatePage("https://x.com/contact-us");
    const byLabelOnly = scoreCandidatePage("https://x.com/p1", "Contact us");
    expect(byLabelOnly).toBe(byPathOnly);
  });

  it("never spends budget on boilerplate or assets", () => {
    for (const path of [
      "/privacy-policy",
      "/terms-of-use",
      "/cookie-policy",
      "/wp-content/uploads/logo.png",
      "/feed",
      "/category/news",
      "/wp-login",
      "/brochure.pdf",
      "/cart",
    ]) {
      expect(scoreCandidatePage(`https://x.com${path}`, "About our company")).toBe(0);
    }
  });

  it("returns -1 for something that is not a URL", () => {
    expect(scoreCandidatePage("not a url")).toBe(-1);
  });

  it("keeps getUrlScore working for existing callers", () => {
    expect(getUrlScore("https://x.com/contact-us")).toBe(100);
    expect(getUrlScore("https://x.com/privacy-policy")).toBe(0);
  });
});

describe("crawl budget", () => {
  it("has room for the homepage, about, contact and the services the footer lists", () => {
    // Measured: the site's footer index alone lists ~8 service pages, and 5
    // pages could not hold them next to about/contact.
    expect(CRAWL_LIMITS.maxPages).toBeGreaterThanOrEqual(7);
  });
});
