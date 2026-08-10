/**
 * Report content builders.
 *
 * Pure functions that turn the audit ReportViewModel into the derived
 * content blocks used by the PDF sections. No React, no side effects —
 * fully unit-testable. All wording stays grounded in what the audit
 * actually detected ("detected" / "not detected" / "did not identify"),
 * and every NEXT CALL claim comes from the audit engine's own
 * NextCallOpportunity records.
 */

import {
  ReportViewModel,
  AuditFinding,
  AuditCategoryName,
  NextCallOpportunity,
} from "@/types";

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export type CategoryStatus =
  | "STRONG"
  | "GOOD"
  | "LIMITED"
  | "NEEDS_ATTENTION"
  | "NOT_DETECTED";

export function deriveCategoryStatus(score: number): CategoryStatus {
  if (score >= 75) return "STRONG";
  if (score >= 50) return "GOOD";
  if (score >= 35) return "LIMITED";
  if (score > 0) return "NEEDS_ATTENTION";
  return "NOT_DETECTED";
}

export function statusLabel(status: CategoryStatus): string {
  switch (status) {
    case "STRONG":
      return "Strong";
    case "GOOD":
      return "Good";
    case "LIMITED":
      return "Limited";
    case "NEEDS_ATTENTION":
      return "Needs Attention";
    case "NOT_DETECTED":
      return "Not Detected";
  }
}

export function deriveConfidenceLabel(confidence: string): string {
  return confidence === "HIGH"
    ? "High Confidence"
    : confidence === "MEDIUM"
      ? "Medium Confidence"
      : "Low Confidence";
}

// ---------------------------------------------------------------------------
// Per-category narrative (grounded templates keyed by category + status)
// ---------------------------------------------------------------------------

const CATEGORY_CONTEXT: Record<
  string,
  { what: string; why: string; opportunity: string }
> = {
  WEBSITE: {
    what: "No publicly detectable website was identified during this assessment.",
    why: "Prospective customers may have fewer places to verify services and learn how to contact the business.",
    opportunity: "Establish a simple, service-focused web presence.",
  },
  CONTACTABILITY: {
    what: "Contact channels appear limited to direct phone communication.",
    why: "Customers may need to rely more heavily on phone calls to reach the business.",
    opportunity: "Publish additional contact channels and clear business hours.",
  },
  BOOKING: {
    what: "No publicly detectable online booking system was identified.",
    why: "Customers who prefer to schedule online may need to call during business hours instead.",
    opportunity: "Offer online scheduling so customers can move from inquiry to appointment more easily.",
  },
  SOCIAL: {
    what: "No public social media profiles were detected during this assessment.",
    why: "Customers may have fewer channels to discover and follow the business.",
    opportunity: "Create profiles on the platforms customers use most to build familiarity.",
  },
  REPUTATION: {
    what: "Few publicly detectable reputation signals were identified.",
    why: "Prospective customers may have limited public review signals to inform their decision.",
    opportunity: "Encourage satisfied customers to leave public reviews.",
  },
};

const STRONG_CONTEXT = {
  what: "A working, publicly detectable channel was identified.",
  why: "This channel supports prospective customers during the research and contact phase.",
  opportunity: "Continue to maintain and monitor this channel.",
};

function categoryContext(
  category: ReportViewModel["categoryDetails"][number]
): { what: string; why: string; opportunity: string } {
  const status = deriveCategoryStatus(category.score);
  if (status === "STRONG" || status === "GOOD") return STRONG_CONTEXT;

  const template = CATEGORY_CONTEXT[category.key];
  if (!template) return STRONG_CONTEXT;

  // If a weakness finding provides a more precise "what we detected",
  // prefer the engine's own deterministic wording.
  const weakness = category.findings.find((f) => f.type === "WEAKNESS");
  return {
    what: weakness?.evidence || template.what,
    why: template.why,
    opportunity: template.opportunity,
  };
}

// ---------------------------------------------------------------------------
// Personalized overview statements (evidence-based)
// ---------------------------------------------------------------------------

export function buildOverviewStatement(vm: ReportViewModel): string {
  const name = vm.businessName;
  const signals: string[] = [];

  if (vm.signals.phone) {
    signals.push("a publicly detectable phone number");
  }
  if (vm.signals.website) {
    signals.push("a detectable website");
  }

  const missing: string[] = [];
  const websiteMissing =
    vm.signals.website === null &&
    vm.categoryDetails.find((c) => c.key === "WEBSITE" && c.score === 0);
  const bookingMissing =
    !vm.signals.bookingDetected &&
    vm.categoryDetails.find((c) => c.key === "BOOKING" && c.score === 0);

  if (websiteMissing) missing.push("no public website was identified");
  if (bookingMissing) missing.push("no online booking path was identified");
  const socialMissing = vm.categoryDetails.find(
    (c) => c.key === "SOCIAL" && c.score === 0
  );
  if (socialMissing && missing.length < 2) {
    missing.push("no public social presence was identified");
  }

  if (signals.length > 0 && missing.length > 0) {
    return `${name} currently has ${signals.join(" and ")}, while ${missing.join(
      ", and "
    )} during this assessment.`;
  }
  if (missing.length > 0) {
    return `During this assessment, ${missing.join(
      ", and "
    )} for ${name}. Direct phone contact remains the most readily available channel.`;
  }
  if (signals.length > 0) {
    return `${name} was identified with ${signals.join(
      " and "
    )}, providing working channels for customers to learn about and contact the business.`;
  }
  return `This assessment evaluates the publicly detectable digital presence of ${name}.`;
}

// ---------------------------------------------------------------------------
// At a glance (cover)
// ---------------------------------------------------------------------------

export interface AtAGlanceItem {
  label: string;
  score: number;
  status: string;
}

export function buildAtAGlance(vm: ReportViewModel): AtAGlanceItem[] {
  return vm.categoryDetails.map((c) => ({
    label: c.name,
    score: c.score,
    status: statusLabel(deriveCategoryStatus(c.score)),
  }));
}

// ---------------------------------------------------------------------------
// Priority finding cards (executive summary)
// ---------------------------------------------------------------------------

export interface FindingCardData {
  category: string;
  title: string;
  finding: string;
  whyItMatters: string;
  opportunity: string;
  score: number;
}

export function buildPriorityFindings(vm: ReportViewModel): FindingCardData[] {
  const weak = vm.categoryDetails
    .filter((c) => deriveCategoryStatus(c.score) === "NOT_DETECTED" || deriveCategoryStatus(c.score) === "NEEDS_ATTENTION" || deriveCategoryStatus(c.score) === "LIMITED")
    .slice()
    .sort((a, b) => a.score - b.score);

  const targets = weak.length >= 2 ? weak : vm.categoryDetails.slice().sort((a, b) => a.score - b.score);

  return targets.slice(0, 4).map((c) => {
    const ctx = categoryContext(c);
    const weakness = c.findings.find((f) => f.type === "WEAKNESS");
    return {
      category: c.name,
      title: weakness?.title || statusLabel(deriveCategoryStatus(c.score)),
      finding: weakness?.evidence || ctx.what,
      whyItMatters: ctx.why,
      opportunity: ctx.opportunity,
      score: c.score,
    };
  });
}

// ---------------------------------------------------------------------------
// Strengths (executive summary)
// ---------------------------------------------------------------------------

export function buildStrengths(vm: ReportViewModel): string[] {
  const strengths: string[] = [];

  for (const cat of vm.categoryDetails) {
    for (const f of cat.findings) {
      if (f.type === "STRENGTH") strengths.push(f.evidence);
    }
  }

  if (vm.signals.phone && !strengths.some((s) => s.toLowerCase().includes("phone"))) {
    strengths.push("A public phone number is available for direct contact.");
  }
  if (vm.signals.bookingDetected && vm.signals.bookingSystem) {
    strengths.push(`An online booking system was detected (${vm.signals.bookingSystem}).`);
  }

  return strengths;
}

// ---------------------------------------------------------------------------
// Customer journey
// ---------------------------------------------------------------------------

export interface JourneyStepData {
  label: string;
  headline: string;
  detail: string;
  positive: boolean;
  status: string;
}

export function buildJourney(vm: ReportViewModel): {
  steps: JourneyStepData[];
  friction: string;
} {
  const rating = vm.signals.rating;
  const reviewCount = vm.signals.reviewCount;

  // DISCOVER
  const discover: JourneyStepData =
    rating !== null || reviewCount !== null
      ? {
          label: "Discover",
          headline: "Reputation signals present",
          detail: `Public review signals were identified (${
            rating !== null ? `${rating} star rating` : "a public rating"
          }${reviewCount !== null ? ` across ${reviewCount} reviews` : ""}).`,
          positive: true,
          status: "Identified",
        }
      : {
          label: "Discover",
          headline: "Limited public signals",
          detail: "No publicly detectable reputation signals were identified.",
          positive: false,
          status: "Not detected",
        };

  // LEARN
  const websiteCat = vm.categoryDetails.find((c) => c.key === "WEBSITE");
  const websiteStrength = websiteCat?.findings.find((f) => f.type === "STRENGTH");
  const websiteWeakness = websiteCat?.findings.find(
    (f) => f.type === "WEAKNESS" && f.title !== "Missing SSL Certificate"
  );
  const learn: JourneyStepData = websiteStrength
    ? {
        label: "Learn",
        headline: "Website available",
        detail: websiteStrength.evidence,
        positive: true,
        status: "Identified",
      }
    : websiteWeakness
      ? {
          label: "Learn",
          headline: "Website not detected",
          detail:
            websiteWeakness.title === "No Website Found"
              ? "No publicly detectable website was identified during this assessment."
              : websiteWeakness.evidence,
          positive: false,
          status: "Not detected",
        }
      : {
          label: "Learn",
          headline: "Presence partially verified",
          detail: "Website accessibility could not be fully verified during this assessment.",
          positive: false,
          status: "Not detected",
        };

  // CONTACT
  const hasEmail = Boolean(vm.signals.preferredEmail);
  const contact: JourneyStepData =
    vm.signals.phone !== null
      ? {
          label: "Contact",
          headline: "Phone contact available",
          detail: `A public phone number is available${
            hasEmail ? ", along with an email address" : ""
          } for direct contact.`,
          positive: true,
          status: "Identified",
        }
      : {
          label: "Contact",
          headline: "Contact options limited",
          detail: "No public phone number or email address was detected during this assessment.",
          positive: false,
          status: "Not detected",
        };

  // SCHEDULE
  const schedule: JourneyStepData =
    vm.signals.bookingDetected
      ? {
          label: "Schedule",
          headline: "Online booking detected",
          detail: vm.signals.bookingSystem
            ? `An online booking path was detected (${vm.signals.bookingSystem}).`
            : "An online booking path was detected for scheduling.",
          positive: true,
          status: "Identified",
        }
      : {
          label: "Schedule",
          headline: "Online booking not detected",
          detail: "No publicly detectable online booking path was identified.",
          positive: false,
          status: "Not detected",
        };

  // CONVERSION / friction
  const frictionParts: string[] = [];
  if (!vm.signals.bookingDetected) {
    frictionParts.push("customers who prefer to schedule online may need to call during business hours");
  }
  if (!vm.signals.website && vm.signals.phone !== null && !vm.signals.bookingDetected) {
    frictionParts.push("phone communication may be the primary path to service");
  }
  const friction =
    frictionParts.length > 0
      ? `Potential friction identified: ${frictionParts.join(", and ")}.`
      : "No significant publicly detectable friction was identified in this assessment.";

  const conversion: JourneyStepData = {
    label: "Conversion",
    headline: frictionParts.length > 0 ? "Potential friction" : "Path appears open",
    detail: friction,
    positive: frictionParts.length === 0,
    status: frictionParts.length > 0 ? "Needs attention" : "Identified",
  };

  return { steps: [discover, learn, contact, schedule, conversion], friction };
}

// ---------------------------------------------------------------------------
// Recommended priorities (roadmap — mapped to detected weaknesses)
// ---------------------------------------------------------------------------

const ROADMAP_TITLES: Record<string, { title: string; detail: string }> = {
  WEBSITE: {
    title: "Establish a basic digital home",
    detail: "Create a simple, service-focused website so customers can verify services and learn how to get in touch.",
  },
  CONTACTABILITY: {
    title: "Improve contactability",
    detail: "Add clear contact channels and publish business hours so customers know how and when to reach you.",
  },
  BOOKING: {
    title: "Make scheduling easier",
    detail: "Offer an online scheduling path so customers can move from inquiry to appointment without waiting on hours of operation.",
  },
  SOCIAL: {
    title: "Strengthen local visibility",
    detail: "Build profiles on the platforms customers use most so the business is discoverable beyond phone directories.",
  },
  REPUTATION: {
    title: "Build public reputation signals",
    detail: "Encourage satisfied customers to leave public reviews so new customers can see social proof.",
  },
};

export interface RoadmapItem {
  number: string;
  title: string;
  detail: string;
}

export function buildRoadmap(vm: ReportViewModel): RoadmapItem[] {
  const weak = vm.categoryDetails
    .map((c) => ({ ...c, status: deriveCategoryStatus(c.score) }))
    .filter((c) => c.status !== "STRONG" && c.status !== "GOOD")
    .sort((a, b) => a.score - b.score);

  const items = weak.slice(0, 4).map((c, i) => {
    const template = ROADMAP_TITLES[c.key] || {
      title: `Improve ${c.name.toLowerCase()}`,
      detail: CATEGORY_CONTEXT[c.key]?.opportunity || `Address the findings in ${c.name.toLowerCase()}.`,
    };
    return {
      number: String(i + 1).padStart(2, "0"),
      title: template.title,
      detail: template.detail,
    };
  });

  // Fallback: if everything is already strong, use the AI grounded next steps.
  if (items.length === 0 && vm.aiReport.recommendedNextSteps.length > 0) {
    return vm.aiReport.recommendedNextSteps.slice(0, 4).map((step, i) => ({
      number: String(i + 1).padStart(2, "0"),
      title: step,
      detail: "Maintain the strengths identified in this assessment while reviewing the remaining findings.",
    }));
  }

  return items;
}

// ---------------------------------------------------------------------------
// NEXT CALL — solution tied to real audit opportunities
// ---------------------------------------------------------------------------

export interface NextCallPrimary {
  problem: string;
  whyItMatters: string;
  relevance: string;
}

export function buildNextCallPrimary(vm: ReportViewModel): NextCallPrimary {
  const opps = vm.nextCallOpportunities || [];
  const primary: NextCallOpportunity | undefined = opps[0];

  return {
    problem: primary?.title || "Potential missed inbound opportunities",
    whyItMatters:
      primary?.evidence ||
      "If phone communication is an important contact route, customers may have difficulty reaching the business when the team is unavailable.",
    relevance: vm.aiReport.nextCallRelevance,
  };
}

export interface CapabilityCardData {
  title: string;
  detail: string;
}

export function buildNextCallCapabilities(vm: ReportViewModel): CapabilityCardData[] {
  const opps = vm.nextCallOpportunities || [];
  const capabilities = opps.slice(0, 3).map((o) => {
    // The engine's evidence already explains how the capability addresses the finding.
    const detail = o.evidence.replace(/^NextCall can /i, "");
    return { title: o.title, detail };
  });

  if (capabilities.length === 0) {
    return [
      {
        title: "AI Voice Receptionist",
        detail:
          "Answers inbound calls and captures customer information so inquiries are not missed.",
      },
    ];
  }

  return capabilities;
}