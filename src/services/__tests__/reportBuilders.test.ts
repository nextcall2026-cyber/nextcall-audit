import { describe, it, expect } from "vitest";
import { ReportViewModel, AuditReport, ReportSignals } from "@/types";
import {
  deriveCategoryStatus,
  statusLabel,
  deriveConfidenceLabel,
  deriveAuditSignals,
  auditConsistencyIssues,
  buildOverviewStatement,
  buildAtAGlance,
  buildPriorityFindings,
  buildStrengths,
  buildJourney,
  buildNextCallCapabilities,
  buildNextCallCta,
  buildNextCallOpportunity,
  buildScoreMethodology,
  buildCoverSignals,
  sanitizeNextCallCopy,
} from "../../components/reports/pdf/builders";

function makeVm(overrides: Partial<ReportViewModel> = {}): ReportViewModel {
  const aiReport: AuditReport = {
    executiveSummary: "Executive summary text.",
    overallAssessment: "Overall assessment text.",
    strengths: [],
    opportunities: [],
    customerExperienceImpact: "Impact text.",
    nextCallRelevance: "NEXT CALL relevance paragraph.",
    recommendedNextSteps: [],
  };

  const categoryDetails = [
    {
      key: "WEBSITE" as const,
      name: "Website",
      score: 0,
      weight: 0.25,
      findings: [
        {
          category: "WEBSITE" as const,
          type: "WEAKNESS" as const,
          title: "No Website Found",
          evidence: "No publicly detectable website was identified.",
        },
      ],
    },
    {
      key: "CONTACTABILITY" as const,
      name: "Contactability",
      score: 100,
      weight: 0.25,
      findings: [
        {
          category: "CONTACTABILITY" as const,
          type: "STRENGTH" as const,
          title: "Phone Available",
          evidence: "A public phone number was detected.",
        },
      ],
    },
    { key: "BOOKING" as const, name: "Booking", score: 0, weight: 0.2, findings: [] },
    { key: "SOCIAL" as const, name: "Social", score: 50, weight: 0.15, findings: [] },
    { key: "REPUTATION" as const, name: "Reputation", score: 75, weight: 0.15, findings: [] },
  ];

  const signals: ReportSignals = {
    phone: "+15551234567",
    website: null,
    preferredEmail: null,
    rating: null,
    reviewCount: null,
    bookingDetected: false,
    bookingSystem: null,
    bookingUrl: null,
    socialProfiles: [],
  };

  return {
    businessName: "JL Plumbing",
    category: "Plumber",
    location: "Austin, TX",
    auditDate: "2026-08-01T00:00:00.000Z",
    auditVersion: "1.0",
    overallScore: 45,
    confidence: "HIGH",
    categoryScores: categoryDetails.map(({ name, score, weight }) => ({ name, score, weight })),
    categoryDetails,
    signals,
    aiReport,
    nextCallOpportunities: [],
    ...overrides,
  };
}

describe("deriveCategoryStatus", () => {
  it("maps score thresholds to statuses", () => {
    expect(deriveCategoryStatus(90)).toBe("STRONG");
    expect(deriveCategoryStatus(60)).toBe("GOOD");
    expect(deriveCategoryStatus(40)).toBe("LIMITED");
    expect(deriveCategoryStatus(10)).toBe("NEEDS_ATTENTION");
    expect(deriveCategoryStatus(0)).toBe("NOT_DETECTED");
  });

  it("labels statuses and confidence", () => {
    expect(statusLabel("NEEDS_ATTENTION")).toBe("Needs Attention");
    expect(statusLabel("NOT_DETECTED")).toBe("Not Detected");
    expect(deriveConfidenceLabel("HIGH")).toBe("High Confidence");
    expect(deriveConfidenceLabel("LOW")).toBe("Low Confidence");
  });
});

describe("deriveAuditSignals", () => {
  it("detects a phone only from the engine's STRENGTH finding", () => {
    const s = deriveAuditSignals(makeVm());
    expect(s.phoneDetected).toBe(true);
  });

  it("treats raw VM signals as NOT detected when the engine disagrees", () => {
    // Issue 16's core: a raw business.website URL or phone field must never
    // contradict the audit findings that the scoring is built on.
    const vm = makeVm({
      signals: { ...makeVm().signals, phone: "+15551234567", website: "https://jlplumbing.com" },
      categoryDetails: makeVm().categoryDetails.map((c) => ({ ...c, score: 0, findings: [] })),
    });
    const s = deriveAuditSignals(vm);
    expect(s.phoneDetected).toBe(false);
    expect(s.websiteUrlDetected).toBe(false);
    expect(s.websiteReachable).toBe(false);
    expect(s.socialDetected).toBe(false);
  });

  it("treats a website score above zero as a detected website URL", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE" ? { ...c, score: 45 } : c
      ),
    });
    expect(deriveAuditSignals(vm).websiteUrlDetected).toBe(true);
    expect(deriveAuditSignals(vm).websiteReachable).toBe(false);
  });
});

describe("auditConsistencyIssues", () => {
  it("returns no issues for a consistent view model", () => {
    expect(auditConsistencyIssues(makeVm())).toEqual([]);
  });

  it("flags a reachable website that somehow scored 0", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE"
          ? {
              ...c,
              score: 0,
              findings: [
                {
                  category: "WEBSITE" as const,
                  type: "STRENGTH" as const,
                  title: "Active Website",
                  evidence: "Website is live.",
                },
              ],
            }
          : c
      ),
    });
    const issues = auditConsistencyIssues(vm);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].section).toBe("Website");
  });

  it("flags a raw website signal the audit did not detect", () => {
    const vm = makeVm({ signals: { ...makeVm().signals, website: "https://jlplumbing.com" } });
    const issues = auditConsistencyIssues(vm);
    expect(issues.some((i) => i.message.includes("Raw website signal"))).toBe(true);
  });
});

describe("buildOverviewStatement", () => {
  it("mentions what was detected and what was not", () => {
    const s = buildOverviewStatement(makeVm());
    expect(s).toContain("JL Plumbing");
    expect(s).toContain("phone number");
    expect(s).toContain("no publicly detectable website was identified");
  });

  it("never claims a website is missing when one was detected", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE" ? { ...c, score: 80 } : c
      ),
    });
    expect(buildOverviewStatement(vm)).not.toContain("no publicly detectable website was identified");
  });

  it("falls back to a neutral framing when nothing was detected", () => {
    const base = makeVm();
    const vm = makeVm({
      signals: { ...base.signals, phone: null, website: null },
      categoryDetails: base.categoryDetails.map((c) => ({ ...c, score: 0, findings: [] })),
    });
    const s = buildOverviewStatement(vm);
    expect(s).toContain("no publicly detectable website was identified");
    expect(s).toContain("no online booking path was identified");
    expect(s).not.toContain("phone number");
  });

  it("ignores raw signals when the audit scores say nothing was detected", () => {
    // Issue 1 regression: page 1 used to say "has a detectable website"
    // because it read the raw discovery URL, while the score was 0/100.
    const base = makeVm();
    const vm = makeVm({
      signals: { ...base.signals, website: "https://jlplumbing.com" },
      categoryDetails: base.categoryDetails.map((c) => ({ ...c, score: 0, findings: [] })),
    });
    const s = buildOverviewStatement(vm);
    expect(s).toContain("no publicly detectable website was identified");
    expect(s).not.toMatch(/has a detectable website/i);
  });
});

describe("buildAtAGlance", () => {
  it("returns one item per category with derived status", () => {
    const items = buildAtAGlance(makeVm());
    expect(items).toHaveLength(5);
    expect(items[0].status).toBe("Not Detected");
    expect(items[1].status).toBe("Strong");
  });
});

describe("buildPriorityFindings", () => {
  it("prioritizes the weakest categories first", () => {
    const items = buildPriorityFindings(makeVm());
    expect(items.length).toBeGreaterThan(0);
    const scores = items.map((i) => i.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(items[0].score).toBe(0);
    expect(items.every((i) => i.finding.length > 0)).toBe(true);
  });

  it("uses the engine weakness title when one exists, else the status label", () => {
    const items = buildPriorityFindings(makeVm());
    // Booking has no engine finding in this fixture -> status fallback.
    expect(items[0].title).toBe("Not Detected");
    expect(items.find((i) => i.category === "Website")?.title).toBe("No Website Found");
  });
});

describe("buildStrengths", () => {
  it("surfaces STRENGTH findings and detected signals only", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE"
          ? {
              ...c,
              findings: [
                {
                  category: "WEBSITE" as const,
                  type: "STRENGTH" as const,
                  title: "Active Website",
                  evidence: "Business website is live and reachable.",
                },
              ],
            }
          : c
      ),
    });
    const strengths = buildStrengths(vm);
    expect(strengths).toContain("Business website is live and reachable.");
    expect(strengths).toContain("A public phone number was detected.");
  });
});

describe("buildJourney", () => {
  it("builds five steps and marks friction when booking is missing", () => {
    const { steps, friction } = buildJourney(makeVm());
    expect(steps).toHaveLength(5);
    expect(friction.toLowerCase()).toContain("schedule online");
    expect(steps.every((s) => s.label.length > 0 && s.headline.length > 0)).toBe(true);
  });

  it("reports the detected rating instead of inventing one", () => {
    const base = makeVm();
    const vm = makeVm({
      signals: { ...base.signals, rating: 4.7, reviewCount: 42 },
    });
    const { steps } = buildJourney(vm);
    expect(steps[0].detail).toContain("4.7 star rating");
    expect(steps[0].detail).toContain("42 reviews");
  });

  it("never says phone was not detected when the engine found one", () => {
    const contactStep = buildJourney(makeVm()).steps.find((s) => s.label === "Contact");
    expect(contactStep?.headline).toBe("Phone available");
    expect(contactStep?.status).toBe("Identified");
    expect(contactStep?.detail).not.toMatch(/no public phone|phone[^.]*not detected/i);
  });

  it("says the website is not detected only when the engine agrees", () => {
    const learnStep = buildJourney(makeVm()).steps.find((s) => s.label === "Learn");
    expect(learnStep?.headline).toBe("No public website detected");
  });

  it("reports an unreachable website as 'Unable to verify', not as absent", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE"
          ? {
              ...c,
              score: 45,
              findings: [
                {
                  category: "WEBSITE" as const,
                  type: "WEAKNESS" as const,
                  title: "Unreachable Website",
                  evidence: "The website URL could not be reached when checked.",
                },
              ],
            }
          : c
      ),
    });
    const learnStep = buildJourney(vm).steps.find((s) => s.label === "Learn");
    expect(learnStep?.headline).toBe("Website not reachable");
    expect(learnStep?.status).toBe("Unable to verify");
  });

  it("marks a contact step with no phone as 'Needs attention', not 'Not detected'", () => {
    const base = makeVm();
    const vm = makeVm({
      signals: { ...base.signals, phone: null },
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "CONTACTABILITY" ? { ...c, score: 40, findings: [] } : c
      ),
    });
    const contactStep = buildJourney(vm).steps.find((s) => s.label === "Contact");
    expect(contactStep?.headline).toBe("Contact options limited");
    expect(contactStep?.status).toBe("Needs attention");
  });
});

describe("buildNextCallCapabilities (signal-driven selection)", () => {
  it("selects only the capabilities the audit findings support", () => {
    // phone + no website + no booking + plumbing category
    const caps = buildNextCallCapabilities(makeVm());
    expect(caps.map((c) => c.title)).toEqual([
      "24/7 AI Voice Receptionist",
      "Emergency Detection & Call Forwarding",
      "Missed Call Recovery",
      "AI Appointment Scheduling",
    ]);
  });

  it("does not recommend capabilities the audit does not support", () => {
    const base = makeVm();
    const vm = makeVm({
      category: "Dental Care",
      categoryDetails: base.categoryDetails.map((c) => ({
        ...c,
        score: 90,
        findings: [
          {
            category: c.key,
            type: "STRENGTH" as const,
            title:
              c.key === "WEBSITE"
                ? "Active Website"
                : c.key === "BOOKING"
                  ? "Online Booking Active"
                  : "Phone Available",
            evidence: "Detected during this assessment.",
          },
        ],
      })),
    });
    const caps = buildNextCallCapabilities(vm);
    expect(caps.map((c) => c.title)).toEqual(["24/7 AI Voice Receptionist"]);
  });

  it("caps the selection at four capabilities and never exceeds it", () => {
    const caps = buildNextCallCapabilities(makeVm());
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.length).toBeLessThanOrEqual(4);
  });

  it("every card explains opportunity, impact and solution from grounded copy", () => {
    const caps = buildNextCallCapabilities(makeVm());
    expect(caps.every((c) => c.opportunity.length > 0)).toBe(true);
    expect(caps.every((c) => c.whyItMatters.length > 0)).toBe(true);
    expect(caps.every((c) => c.howNextCallHelps.length > 0)).toBe(true);
    expect(caps.every((c) => !/guarantee|ensu?res? that/i.test(c.howNextCallHelps))).toBe(true);
  });
});

describe("buildNextCallCta", () => {
  it("addressed the reader as 'your business' — never by name — with the strongest opportunity", () => {
    const cta = buildNextCallCta(makeVm());
    expect(cta.overview).toContain("your business");
    expect(cta.overview).not.toContain("JL Plumbing");
    expect(cta.personalized).toMatch(/appears to be/i);
    expect(cta.personalized).toMatch(/schedul/i);
    expect(cta.howNextCallHelps).toContain("NextCall can help by");
  });

  it("never uses the business name where NextCall's function is described", () => {
    // P1 regression: a business literally named "NextCall" must not collide
    // with the product in CTA copy.
    const vm = makeVm({ businessName: "NextCall" });
    const cta = buildNextCallCta(vm);
    const copy = [cta.overview, cta.productLine, cta.personalized, cta.howNextCallHelps].join(" ");
    expect(copy).not.toMatch(/NextCall[^,.?!]*JL|JL[^,.?!]*NextCall/i);
    expect(cta.overview.toLowerCase()).not.toContain("nextcall is"); // product-only noun use
  });

  it("derives benefits from the selected capabilities only", () => {
    const cta = buildNextCallCta(makeVm());
    expect(cta.benefits.length).toBeGreaterThan(0);
    expect(cta.benefits.length).toBeLessThanOrEqual(3);
    expect(cta.benefits).toContain("Answer calls 24/7");
    expect(cta.benefits).toContain("Detect and forward urgent calls");
  });

  it("never claims unverified business outcomes", () => {
    const cta = buildNextCallCta(makeVm());
    const text = [cta.overview, cta.personalized, cta.howNextCallHelps].join(" ");
    expect(text).not.toMatch(/losing|missing calls is|revenue|guarantee|primary lead source/i);
  });
});

describe("buildCoverSignals", () => {
  it("uses the strongest category finding as the key positive signal", () => {
    const { positive } = buildCoverSignals(makeVm());
    expect(positive).toContain("phone");
  });

  it("falls back to neutral language when nothing detected is strong", () => {
    const base = makeVm();
    const vm = makeVm({
      signals: { ...base.signals, phone: null, website: null, preferredEmail: null },
      categoryDetails: base.categoryDetails.map((c) => ({ ...c, score: 0, findings: [] })),
    });
    const { positive } = buildCoverSignals(vm);
    expect(positive).toContain("directories");
  });

  it("surfaces the weakest category's opportunity as the biggest opportunity", () => {
    const { opportunity } = buildCoverSignals(makeVm());
    expect(opportunity.length).toBeGreaterThan(10);
    expect(opportunity).toMatch(/scheduling/i);
  });
});

describe("sanitizeNextCallCopy", () => {
  it("rewrites absolute-guarantee phrasing into defensible wording", () => {
    expect(
      sanitizeNextCallCopy("NEXT CALL ensures that every inbound call is answered or an actionable follow-up is scheduled.")
    ).toContain("is designed to help answer inbound calls consistently");
    expect(sanitizeNextCallCopy("Never miss a call again.")).toContain("help reduce missed calls");
    expect(sanitizeNextCallCopy("Guaranteed pickup.")).toContain("supports");
    expect(sanitizeNextCallCopy("Calls are the primary lead source.")).toContain(
      "an important customer contact path"
    );
  });
});

describe("buildScoreMethodology", () => {
  it("exposes the real engine weights, summing to 100%", () => {
    const m = buildScoreMethodology(makeVm());
    const weights = m.items.map((i) => i.weightPercent);
    expect(weights.reduce((a, b) => a + b, 0)).toBe(100);
    expect(m.items.find((i) => i.name === "Website")?.weightPercent).toBe(25);
    expect(m.items.find((i) => i.name === "Booking")?.weightPercent).toBe(20);
    expect(m.items.every((i) => i.weightPercent > 0)).toBe(true);
    expect(m.formula).toMatch(/^Overall = /);
  });
});

describe("buildNextCallOpportunity", () => {
  it("levels the opportunity from the engine's mapped opportunities and signals", () => {
    expect(buildNextCallOpportunity(makeVm()).level).toBe("Limited");
    const vm = makeVm({
      nextCallOpportunities: [
        { type: "AI_LEAD_CAPTURE" as const, title: "Lead Capture", evidence: "Limited contact options." },
        { type: "AI_BOOKING_ASSISTANT" as const, title: "Appointment Scheduling", evidence: "No booking path." },
      ],
    });
    expect(buildNextCallOpportunity(vm).level).toBe("Significant");
    expect(buildNextCallOpportunity(vm).summary).toContain("2 opportunities");
  });

  it("never claims a specific gap when the audit mapped none", () => {
    const sig = buildNextCallOpportunity(makeVm());
    expect(sig.summary).toMatch(/No specific gap|24\/7 answering channel/i);
  });
});