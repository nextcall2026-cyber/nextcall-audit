import { describe, it, expect } from "vitest";
import {
  Business,
  AuditResult,
  AuditReport,
  NextCallOpportunity,
  AuditFinding,
  AuditCategoryName,
  CategoryScore,
} from "@/types";
import {
  buildOutreachEmail,
  countWords,
  EMAIL_HELP_BY_KEY,
} from "@/services/outreachEmailBuilder";
import {
  buildNextCallCapabilities,
  buildPriorityFindings,
} from "@/components/reports/pdf/builders";
import { buildReportViewModel } from "@/services/reportViewModel";
import { NEXTCALL_TRIAL_URL } from "@/lib/nextCallConfig";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAiReport(): AuditReport {
  return {
    executiveSummary: "Executive summary.",
    overallAssessment: "Overall assessment.",
    strengths: [],
    opportunities: [],
    customerExperienceImpact: "Impact.",
    nextCallRelevance: "NEXT CALL relevance paragraph that must never be dumped into the email.",
    recommendedNextSteps: [],
  };
}

interface AuditOverrides {
  scores?: Partial<Record<AuditCategoryName, number>>;
  findings?: AuditFinding[];
  opportunities?: NextCallOpportunity[];
}

function makeAudit(overrides: AuditOverrides = {}): AuditResult {
  const scores: Record<AuditCategoryName, number> = {
    WEBSITE: 100,
    CONTACTABILITY: 100,
    BOOKING: 0,
    REPUTATION: 90,
    SOCIAL: 80,
    ...(overrides.scores ?? {}),
  };
  const categoryScores = {} as Record<AuditCategoryName, CategoryScore>;
  for (const [key, score] of Object.entries(scores)) {
    categoryScores[key as AuditCategoryName] = {
      score,
      maxScore: 100,
      weight: { WEBSITE: 0.25, CONTACTABILITY: 0.25, BOOKING: 0.2, REPUTATION: 0.15, SOCIAL: 0.15 }[key as AuditCategoryName],
      breakdown: [],
    };
  }
  return {
    auditVersion: "1.0",
    overallScore: scores.BOOKING === 0 ? 45 : 82,
    confidence: "HIGH",
    calculatedAt: "2026-08-01T00:00:00.000Z",
    categoryScores,
    findings: overrides.findings ?? [],
    opportunities: overrides.opportunities ?? [],
  };
}

function makeBusiness(
  name: string,
  enrichment: Business["enrichment"],
  extra: Partial<Business> = {}
): Business {
  return {
    id: "biz-" + name,
    name,
    phone: "+15125550001",
    providerIds: {},
    sources: ["manual"],
    ...extra,
  } as Business;
}

// Standard finding vocabularies (mirroring the audit engine's wording)
const STRENGTH = {
  website: { category: "WEBSITE" as const, type: "STRENGTH" as const, title: "Active Website", evidence: "The business website was live and reachable at the time of the assessment." },
  phone: { category: "CONTACTABILITY" as const, type: "STRENGTH" as const, title: "Phone Available", evidence: "A public phone number was detected." },
  booking: { category: "BOOKING" as const, type: "STRENGTH" as const, title: "Online Booking Active", evidence: "Uses ServiceTitan for scheduling." },
  reputation: { category: "REPUTATION" as const, type: "STRENGTH" as const, title: "Excellent Reputation", evidence: "High rating of 4.9 stars." },
};
const WEAKNESS = {
  noBooking: { category: "BOOKING" as const, type: "WEAKNESS" as const, title: "No Online Booking", evidence: "No publicly detectable booking system was found in the sources checked." },
  unreachableWebsite: { category: "WEBSITE" as const, type: "WEAKNESS" as const, title: "Unreachable Website", evidence: "The website URL could not be reached when checked (error or timeout)." },
  noWebsite: { category: "WEBSITE" as const, type: "WEAKNESS" as const, title: "No Website Found", evidence: "No publicly detectable website was identified in the sources checked." },
  limitedContact: { category: "CONTACTABILITY" as const, type: "WEAKNESS" as const, title: "Limited Contact Options", evidence: "Multiple standard contact methods were not detected." },
  noSocial: { category: "SOCIAL" as const, type: "WEAKNESS" as const, title: "No Social Presence", evidence: "No public social media profiles were detected in the sources checked." },
};

function website(url: string, isReachable: boolean) {
  return { url, isReachable };
}

// ---------------------------------------------------------------------------
// A. Strong reputation + no booking -> appointment scheduling
// ---------------------------------------------------------------------------

const plumbing = () => ({
  business: makeBusiness("PlumbPro", {
    status: "COMPLETED",
    website: website("https://plumbpro.com", true),
    preferredEmail: "info@plumbpro.com",
    phones: [{ number: "+1 (512) 555-0001", normalized: "+15125550001", sourceUrl: "x", sourceType: "TEL_LINK" as const, confidence: 1 }],
    socialProfiles: [{ platform: "facebook" as const, url: "https://facebook.com/plumbpro", sourceUrl: "x", confidence: 1 }],
    booking: { detected: false },
  }, { rating: 4.9, reviewCount: 133, categories: ["Plumbing"] }),
  audit: makeAudit({
    findings: [
      STRENGTH.website,
      STRENGTH.phone,
      STRENGTH.reputation,
      WEAKNESS.noBooking,
    ],
    opportunities: [{ type: "AI_BOOKING_ASSISTANT", title: "Appointment Scheduling", evidence: "No online booking detected." }],
  }),
});

// B. Phone-dependent + weak website contact -> missed call recovery + receptionist
const hvac = () => ({
  business: makeBusiness("HVACPro", {
    status: "COMPLETED",
    website: website("https://hvacpro.com", false),
    phones: [{ number: "+1 (512) 555-0002", normalized: "+15125550002", sourceUrl: "x", sourceType: "TEL_LINK" as const, confidence: 1 }],
    socialProfiles: [{ platform: "facebook" as const, url: "https://facebook.com/hvacpro", sourceUrl: "x", confidence: 1 }],
    booking: { detected: true, systemName: "ServiceTitan" },
  }, { rating: 3.9, reviewCount: 45, categories: ["HVAC & Air Conditioning"] }),
  audit: makeAudit({
    scores: { WEBSITE: 10, CONTACTABILITY: 20, BOOKING: 70, REPUTATION: 80, SOCIAL: 55 },
    findings: [
      WEAKNESS.unreachableWebsite,
      WEAKNESS.limitedContact,
      STRENGTH.phone,
      STRENGTH.booking,
    ],
    opportunities: [
      { type: "AI_MISSED_CALL_RECOVERY", title: "Missed Call Recovery", evidence: "Website unreachable; phone appears important." },
      { type: "AI_LEAD_CAPTURE", title: "Lead Capture", evidence: "Limited contact options." },
    ],
  }),
});

// C. Strong website + social, no booking -> follow-up capability
const cleaning = () => ({
  business: makeBusiness("SparkleClean", {
    status: "COMPLETED",
    website: website("https://sparkleclean.com", true),
    preferredEmail: "hello@sparkleclean.com",
    phones: [{ number: "+1 (512) 555-0003", normalized: "+15125550003", sourceUrl: "x", sourceType: "TEL_LINK" as const, confidence: 1 }],
    socialProfiles: [
      { platform: "instagram" as const, url: "https://instagram.com/sparkleclean", sourceUrl: "x", confidence: 1 },
      { platform: "facebook" as const, url: "https://facebook.com/sparkleclean", sourceUrl: "x", confidence: 1 },
    ],
    booking: { detected: false },
  }, { rating: 4.7, reviewCount: 60, categories: ["Cleaning Services"] }),
  audit: makeAudit({
    findings: [
      STRENGTH.website,
      STRENGTH.phone,
      STRENGTH.reputation,
      WEAKNESS.noBooking,
    ],
    opportunities: [{ type: "AI_BOOKING_ASSISTANT", title: "Appointment Scheduling", evidence: "No online booking detected." }],
  }),
});

// D. Excellent digital presence -> no invented problems
const excellent = () => ({
  business: makeBusiness("PrimeRoofing", {
    status: "COMPLETED",
    website: website("https://primerroofing.com", true),
    preferredEmail: "contact@primerroofing.com",
    phones: [{ number: "+1 (512) 555-0004", normalized: "+15125550004", sourceUrl: "x", sourceType: "TEL_LINK" as const, confidence: 1 }],
    socialProfiles: [
      { platform: "facebook" as const, url: "https://facebook.com/primerroofing", sourceUrl: "x", confidence: 1 },
      { platform: "instagram" as const, url: "https://instagram.com/primerroofing", sourceUrl: "x", confidence: 1 },
    ],
    booking: { detected: true, systemName: "ServiceTitan" },
  }, { rating: 4.8, reviewCount: 412, categories: ["Roofing"] }),
  audit: makeAudit({
    scores: { WEBSITE: 100, CONTACTABILITY: 100, BOOKING: 100, REPUTATION: 95, SOCIAL: 90 },
    findings: [
      STRENGTH.website,
      STRENGTH.phone,
      STRENGTH.booking,
      STRENGTH.reputation,
    ],
    opportunities: [],
  }),
});

// E. Lots of UNKNOWN data -> do not treat UNKNOWN as FALSE
const sparse = () => ({
  business: makeBusiness("Smith Auto Shop", {
    status: "COMPLETED",
  }),
  audit: makeAudit({
    scores: { WEBSITE: 0, CONTACTABILITY: 0, BOOKING: 0, REPUTATION: 0, SOCIAL: 0 },
    findings: [
      WEAKNESS.noWebsite,
      WEAKNESS.limitedContact,
      WEAKNESS.noBooking,
      WEAKNESS.noSocial,
    ],
    opportunities: [
      { type: "AI_MISSED_CALL_RECOVERY", title: "Missed Call Recovery", evidence: "No website." },
      { type: "AI_BOOKING_ASSISTANT", title: "Appointment Scheduling", evidence: "No online booking." },
      { type: "AI_LEAD_CAPTURE", title: "Lead Capture", evidence: "Limited contact options." },
    ],
  }),
});

// F. Prospect literally named "NextCall" -> no variable confusion
const nextcall = () => ({
  business: makeBusiness("NextCall", {
    status: "COMPLETED",
    website: website("https://getnextcall.com", true),
    preferredEmail: "hello@nextcall.com",
    phones: [{ number: "+1 (415) 555-0199", normalized: "+14155550199", sourceUrl: "x", sourceType: "TEL_LINK" as const, confidence: 1 }],
    socialProfiles: [{ platform: "facebook" as const, url: "https://facebook.com/getnextcall", sourceUrl: "x", confidence: 1 }],
    booking: { detected: false },
  }, { rating: 4.9, reviewCount: 133, categories: ["Telephone Answering Service"] }),
  audit: makeAudit({
    findings: [
      STRENGTH.website,
      STRENGTH.phone,
      STRENGTH.reputation,
      WEAKNESS.noBooking,
    ],
    opportunities: [{ type: "AI_BOOKING_ASSISTANT", title: "Appointment Scheduling", evidence: "No online booking detected." }],
  }),
});

function build(f: () => ReturnType<typeof plumbing>) {
  const { business, audit } = f();
  return buildOutreachEmail({
    business,
    audit,
    aiReport: makeAiReport(),
    attachmentIncluded: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outreach email — fixture A: strong reputation + no booking", () => {
  const email = build(plumbing);

  it("opens with the strongest verified positive signal", () => {
    expect(email.body).toContain("Hi PlumbPro Team,");
    expect(email.body).toContain("I noticed a 4.9-star rating across 133 reviews");
  });

  it("highlights the booking gap with evidence-aware wording", () => {
    expect(email.body).toContain(
      "No publicly detectable booking system was found in the sources checked."
    );
    expect(email.body).toContain(
      "may need to rely on a phone call during business hours"
    );
    expect(email.body).not.toContain("you don't have");
    expect(email.body).not.toContain("doesn't have");
    expect(email.body).not.toContain("wait for availability");
  });

  it("recommends appointment scheduling with consultative wording", () => {
    expect(email.body).toContain(
      "That's one area where NextCall may be able to help"
    );
    expect(email.body).toContain(
      "handle appointment conversations over the phone, check availability through Google Calendar, and confirm bookings"
    );
    expect(email.body).not.toContain("built for exactly this");
  });

  it("references the attached PDF and the 3-day trial CTA", () => {
    expect(email.body).toContain("I've attached the full audit with the details");
    expect(email.body).toContain("try NextCall free for 3 days");
    expect(email.ctaLink).toEqual({ label: "Try NextCall free for 3 days", url: NEXTCALL_TRIAL_URL });
  });

  it("ends with a low-friction reply CTA and signature", () => {
    expect(email.body).toContain("just reply — happy to help.");
    expect(email.body).toContain("Best regards,\n\nThe NextCall Team");
  });

  it("does not dump the AI report or use stale template language", () => {
    expect(email.body).not.toContain("NEXT CALL relevance paragraph");
    expect(email.body).not.toContain("Key Opportunity Identified");
    expect(email.body).not.toContain("5-minute chat");
  });

  it("is 130-180 words and has a natural subject", () => {
    expect(countWords(email.body)).toBeGreaterThanOrEqual(130);
    expect(countWords(email.body)).toBeLessThanOrEqual(180);
    expect(email.subject).toBe("A quick look at PlumbPro's digital presence");
    expect(email.subject).not.toMatch(/URGENT|FREE|LIMITED TIME|10X|REVENUE/i);
  });
});

describe("outreach email — fixture B: phone-dependent + weak website contact", () => {
  const email = build(hvac);

  it("uses the unreachable-website finding and missed-call framing", () => {
    expect(email.body).toContain(
      "The website URL could not be reached when checked (error or timeout)."
    );
    expect(email.body).toContain("reconnect with callers who were not answered");
  });

  it("pairs it with the 24/7 receptionist", () => {
    expect(email.body).toContain("answer inbound calls 24/7 with a custom greeting");
  });

  it("stays evidence-aware (rating too low to call a signal)", () => {
    expect(email.body).toContain("I noticed 45 customer reviews");
    expect(email.body).not.toContain("3.9-star");
  });

  it("is under 200 words", () => {
    expect(countWords(email.body)).toBeLessThanOrEqual(200);
  });
});

describe("outreach email — fixture C: strong website + no booking (follow-up)", () => {
  const email = build(cleaning);

  it("names the follow-up capability as the companion card", () => {
    expect(email.body).toContain("follow up after calls");
    expect(email.body).toContain(
      "handle appointment conversations over the phone, check availability through Google Calendar"
    );
  });

  it("keeps appointment scheduling as the primary capability", () => {
    expect(email.body).toContain(
      "That's one area where NextCall may be able to help"
    );
  });

  it("is 130-180 words", () => {
    expect(countWords(email.body)).toBeGreaterThanOrEqual(130);
    expect(countWords(email.body)).toBeLessThanOrEqual(180);
  });
});

describe("outreach email — fixture D: excellent digital presence", () => {
  const email = build(excellent);

  it("does not invent problems", () => {
    expect(email.body).not.toContain("One thing the audit flagged");
    expect(email.body).toContain(
      "There's nothing on the audit that needs immediate attention"
    );
    expect(email.body).not.toContain("you don't have");
  });

  it("still offers NextCall and the trial, honestly framed", () => {
    expect(email.body).toContain("24/7 AI Voice Receptionist");
    expect(email.body).toContain("try NextCall free for 3 days");
    expect(email.body).toContain("I've attached the full audit with the details");
  });

  it("stays within 100-200 words", () => {
    expect(countWords(email.body)).toBeGreaterThanOrEqual(100);
    expect(countWords(email.body)).toBeLessThanOrEqual(200);
  });
});

describe("outreach email — fixture E: lots of UNKNOWN data", () => {
  const email = build(sparse);

  it("never treats UNKNOWN as FALSE or invents signals", () => {
    expect(email.body).not.toContain("rating");
    expect(email.body).toContain(
      "I took a look at how customers find and contact your business online."
    );
    expect(email.body).toContain(
      "No publicly detectable booking system was found in the sources checked."
    );
    expect(email.body).not.toContain("does not exist");
    expect(email.body).not.toContain("you don't have");
  });

  it("still names audit-grounded capabilities", () => {
    expect(email.body).toContain(
      "handle appointment conversations over the phone, check availability through Google Calendar"
    );
    expect(email.body).toContain("capture caller details during conversations");
  });

  it("is 120-200 words", () => {
    expect(countWords(email.body)).toBeGreaterThanOrEqual(120);
    expect(countWords(email.body)).toBeLessThanOrEqual(200);
  });
});

describe("outreach email — fixture F: prospect named 'NextCall'", () => {
  const email = build(nextcall);

  it("addresses the business by name without confusing it with the product", () => {
    expect(email.subject).toBe("A quick look at NextCall's digital presence");
    expect(email.body).toContain("Hi NextCall Team,");
  });

  it("never produces 'NextCall can use NextCall' constructions", () => {
    expect(email.body).not.toContain("NextCall can use");
    expect(email.body).toContain("try NextCall free for 3 days");
    expect(email.body).toContain("That's one area where NextCall may be able to help");
  });

  it("is 130-180 words", () => {
    expect(countWords(email.body)).toBeGreaterThanOrEqual(130);
    expect(countWords(email.body)).toBeLessThanOrEqual(180);
  });
});

describe("outreach email — attachment & grammar variants", () => {
  it("adjusts the PDF CTA when no attachment is included", () => {
    const { business, audit } = plumbing();
    const email = buildOutreachEmail({
      business,
      audit,
      aiReport: makeAiReport(),
      attachmentIncluded: false,
    });
    expect(email.body).toContain(
      "If you'd like the full PDF audit, just reply and I'll send it over."
    );
    expect(email.body).not.toContain("I've attached the full audit");
  });

  it("handles business names ending in 's' in the subject", () => {
    const { business, audit } = plumbing();
    const email = buildOutreachEmail({
      business: { ...business, name: "Ace Plumbers" },
      audit,
      aiReport: makeAiReport(),
      attachmentIncluded: true,
    });
    expect(email.subject).toBe("A quick look at Ace Plumbers' digital presence");
  });
});

describe("outreach email — PDF consistency", () => {
  for (const [name, fixture] of [
    ["A: plumbing", plumbing],
    ["B: hvac", hvac],
    ["C: cleaning", cleaning],
    ["E: sparse", sparse],
    ["F: nextcall", nextcall],
  ] as const) {
    it(`${name}: highlighted finding and capabilities all exist in the PDF data`, () => {
      const { business, audit } = fixture();
      const vm = buildReportViewModel(business, audit, makeAiReport());
      const email = buildOutreachEmail({
        business,
        audit,
        aiReport: makeAiReport(),
        attachmentIncluded: true,
      });

      const pdfFindings = buildPriorityFindings(vm).map((c) => c.finding);
      const pdfCards = buildNextCallCapabilities(vm);

      // The email's highlighted finding sentence must start with a finding the PDF shows.
      const flagged = "One thing the audit flagged: ";
      if (email.body.includes(flagged)) {
        const rest = email.body.split(flagged)[1];
        expect(pdfFindings.some((f) => rest?.startsWith(f))).toBe(true);
      }

      // Every capability the email mentions must be one of the PDF's cards.
      for (const [key, clause] of Object.entries(EMAIL_HELP_BY_KEY)) {
        if (email.body.includes(clause)) {
          expect(pdfCards.some((c) => c.key === key)).toBe(true);
        }
      }
    });
  }
});