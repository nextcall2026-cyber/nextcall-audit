import { describe, it, expect } from "vitest";
import { ReportViewModel, AuditReport, ReportSignals, NextCallOpportunity } from "@/types";
import {
  deriveCategoryStatus,
  statusLabel,
  deriveConfidenceLabel,
  buildOverviewStatement,
  buildAtAGlance,
  buildPriorityFindings,
  buildStrengths,
  buildJourney,
  buildRoadmap,
  buildNextCallPrimary,
  buildNextCallCapabilities,
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
    { key: "WEBSITE" as const, name: "Website", score: 0, findings: [] },
    { key: "CONTACTABILITY" as const, name: "Contactability", score: 100, findings: [] },
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

describe("buildOverviewStatement", () => {
  it("mentions what was detected and what was not", () => {
    const s = buildOverviewStatement(makeVm());
    expect(s).toContain("JL Plumbing");
    expect(s).toContain("phone number");
    expect(s).toContain("no public website was identified");
  });

  it("never claims a website is missing when one was detected", () => {
    const base = makeVm();
    const vm = makeVm({
      signals: { ...base.signals, website: "https://jlplumbing.com" },
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE" ? { ...c, score: 80 } : c
      ),
    });
    expect(buildOverviewStatement(vm)).not.toContain("no public website was identified");
  });

  it("falls back to a neutral framing when nothing was detected", () => {
    const vm = makeVm({
      signals: { ...makeVm().signals, phone: null, website: null },
      categoryDetails: makeVm().categoryDetails.map((c) => ({ ...c, score: 0 })),
    });
    expect(buildOverviewStatement(vm)).toContain("Direct phone contact remains");
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
});

describe("buildStrengths", () => {
  it("surfaces STRENGTH findings and detected signals only", () => {
    const base = makeVm();
    const vm = makeVm({
      categoryDetails: base.categoryDetails.map((c) =>
        c.key === "WEBSITE" ? { ...c, findings: [{ category: "WEBSITE", type: "STRENGTH", title: "Active Website", evidence: "Business website is live and reachable." }] } : c
      ),
    });
    const strengths = buildStrengths(vm);
    expect(strengths).toContain("Business website is live and reachable.");
    expect(strengths).toContain("A public phone number is available for direct contact.");
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
    type: "AI_AFTER_HOURS",
    title: "Missed After-Hours Calls",
    evidence: "NextCall can answer calls after business hours so inquiries are not missed.",
  };

  it("binds the primary card to engine opportunities, never fabricated metrics", () => {
    const vm = makeVm({ nextCallOpportunities: [opp] });
    const primary = buildNextCallPrimary(vm);
    expect(primary.problem).toBe("Missed After-Hours Calls");
    expect(primary.relevance).toContain("NEXT CALL relevance");
    expect(primary.whyItMatters).toMatch(/not missed/i);
  });

  it("derives capability cards from opportunity evidence", () => {
    const { steps } = buildJourney(makeVm()); // sanity: journey unaffected
    expect(steps.length).toBe(5);
    const caps = buildNextCallCapabilities(makeVm({ nextCallOpportunities: [opp] }));
    expect(caps[0].title).toBe("Missed After-Hours Calls");
    expect(caps[0].detail).not.toMatch(/^NextCall can /i);
  });
});