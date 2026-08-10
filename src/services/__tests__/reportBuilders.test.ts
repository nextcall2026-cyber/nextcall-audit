import { describe, it, expect } from "vitest";
import { ReportViewModel, AuditReport, ReportSignals, NextCallOpportunity } from "@/types";
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
  buildRoadmap,
  buildNextCallPrimary,
  buildNextCallCapabilities,
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
      findings: [
        {
          category: "CONTACTABILITY" as const,
          type: "STRENGTH" as const,
          title: "Phone Available",
          evidence: "A public phone number was detected.",
        },
      ],
    },
    { key: "BOOKING" as const, name: "Booking", score: 0, findings: [] },
    { key: "SOCIAL" as const, name: "Social", score: 50, findings: [] },
    { key: "REPUTATION" as const, name: "Reputation", score: 75, findings: [] },
  ];

  const signals: ReportSignals = {
    phone: "+15551234567",
    website: null,
    preferredEmail: null,
    rating: null,
    reviewCount: null,
    bookingDetected: false,
    bookingSystem: null,
  };

  return {
    businessName: "JL Plumbing",
    category: "Plumber",
    location: "Austin, TX",
    auditDate: "2026-08-01T00:00:00.000Z",
    auditVersion: "1.0",
    overallScore: 45,
    confidence: "HIGH",
    categoryScores: categoryDetails.map(({ name, score }) => ({ name, score })),
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

  it("uses the engine weakness title instead of a fabricated category label", () => {
    const items = buildPriorityFindings(makeVm());
    expect(items[0].title).toBe("No Website Found");
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
    expect(learnStep?.headline).toBe("Website not detected");
  });
});

describe("buildRoadmap", () => {
  it("maps weak categories to the roadmap with sequential numbers", () => {
    const items = buildRoadmap(makeVm());
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].number).toBe("01");
    expect(items[0].title.length).toBeGreaterThan(0);
  });

  it("falls back to AI next steps when everything is strong", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) => ({ ...c, score: 95 })),
      aiReport: { ...base.aiReport, recommendedNextSteps: ["Keep collecting reviews", "Publish hours"] },
    });
    const items = buildRoadmap(vm);
    expect(items[0].title).toBe("Keep collecting reviews");
  });
});

describe("buildNextCall", () => {
  const opp: NextCallOpportunity = {
    type: "AI_MISSED_CALL_RECOVERY",
    title: "Missed After-Hours Calls",
    evidence: "NextCall can answer calls after business hours so inquiries are not missed.",
  };

  it("derives the problem from detected signals, not opportunity titles", () => {
    const vm = makeVm({ nextCallOpportunities: [opp] });
    const primary = buildNextCallPrimary(vm);
    expect(primary.problem).toContain("important customer contact path");
    expect(primary.problem).not.toBe("Missed After-Hours Calls");
    expect(primary.problem).not.toMatch(/primary lead source/i);
    expect(primary.whyItMatters).toMatch(/team is unavailable/i);
    expect(primary.relevance).toContain("NEXT CALL relevance");
  });

  it("derives capability cards from the capability catalog, never raw ad copy", () => {
    const caps = buildNextCallCapabilities(makeVm({ nextCallOpportunities: [opp] }));
    expect(caps[0].title).toBe("Missed Call Recovery");
    expect(caps[0].detail).not.toMatch(/^NextCall can /i);
    expect(caps[0].detail).not.toMatch(/not missed/i);
  });

  it("maps each engine opportunity type to a catalog capability", () => {
    const vm = makeVm({
      nextCallOpportunities: [
        { type: "AI_BOOKING_ASSISTANT", title: "x", evidence: "y" },
        { type: "AI_AFTER_HOURS", title: "x", evidence: "y" },
        { type: "AI_LEAD_CAPTURE", title: "x", evidence: "y" },
      ],
    });
    const caps = buildNextCallCapabilities(vm);
    expect(caps.map((c) => c.title)).toEqual([
      "Appointment Scheduling",
      "24/7 AI Voice Receptionist",
      "Lead Capture",
    ]);
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