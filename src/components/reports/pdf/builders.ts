/**
 * Report content builders.
 *
 * Pure functions that turn the audit ReportViewModel into the derived
 * content blocks used by the PDF sections. No React, no side effects —
 * fully unit-testable. All wording stays grounded in what the audit
 * actually detected ("detected" / "not detected" / "did not identify"),
 * and every NEXT CALL claim comes from the audit engine's own
 * NextCallOpportunity records.
 *
 * SINGLE SOURCE OF TRUTH (Issue 16):
 * Every existence claim (website, phone, booking, social, reputation)
 * is derived from the deterministic audit findings + category scores —
 * the SAME data the score system is built on. Raw VM signals are only
 * used where the audit engine itself reads raw business fields
 * (rating / review count / email).
 */

import { ReportViewModel, AuditCategoryName } from "@/types";

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
// Normalized audit signals — one source of truth for existence claims
// ---------------------------------------------------------------------------

export interface AuditSignals {
  websiteReachable: boolean; // engine STRENGTH "Active Website"
  websiteUrlDetected: boolean; // any website presence (score > 0 or non-"No Website Found" weakness)
  phoneDetected: boolean; // engine STRENGTH "Phone Available"
  bookingDetected: boolean; // engine STRENGTH "Online Booking Active" (score 100)
  socialDetected: boolean; // SOCIAL score > 0 (engine adds no STRENGTH finding)
  reputationDetected: boolean; // rating or review count present (engine reads business fields)
  emailDetected: boolean; // enrichment email available
  rating: number | null;
  reviewCount: number | null;
}

function categoryOf(
  vm: ReportViewModel,
  key: AuditCategoryName
): ReportViewModel["categoryDetails"][number] | undefined {
  return vm.categoryDetails.find((c) => c.key === key);
}

function hasStrength(
  cat: ReportViewModel["categoryDetails"][number] | undefined,
  title?: string
): boolean {
  return (
    cat?.findings?.some(
      (f) => f.type === "STRENGTH" && (!title || f.title === title)
    ) ?? false
  );
}

export function deriveAuditSignals(vm: ReportViewModel): AuditSignals {
  const websiteCat = categoryOf(vm, "WEBSITE");
  const websiteReachable = hasStrength(websiteCat, "Active Website");
  const websiteUrlDetected =
    websiteReachable ||
    (websiteCat?.score ?? 0) > 0 ||
    (websiteCat?.findings?.some(
      (f) => f.type === "WEAKNESS" && f.title !== "No Website Found"
    ) ?? false);

  const contactCat = categoryOf(vm, "CONTACTABILITY");
  const phoneDetected = hasStrength(contactCat, "Phone Available");

  const bookingCat = categoryOf(vm, "BOOKING");
  const bookingDetected =
    hasStrength(bookingCat, "Online Booking Active") ||
    (bookingCat?.score ?? 0) > 0;

  const socialCat = categoryOf(vm, "SOCIAL");
  const socialDetected = (socialCat?.score ?? 0) > 0;

  const rating = vm.signals.rating;
  const reviewCount = vm.signals.reviewCount;
  const reputationDetected = rating !== null || reviewCount !== null;
  const emailDetected = Boolean(vm.signals.preferredEmail);

  return {
    websiteReachable,
    websiteUrlDetected,
    phoneDetected,
    bookingDetected,
    socialDetected,
    reputationDetected,
    emailDetected,
    rating,
    reviewCount,
  };
}

// ---------------------------------------------------------------------------
// Consistency guard (Issue 17) — pure validator, surfaced before rendering
// ---------------------------------------------------------------------------

export interface ConsistencyIssue {
  section: string;
  message: string;
}

export function auditConsistencyIssues(vm: ReportViewModel): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const s = deriveAuditSignals(vm);
  const websiteCat = categoryOf(vm, "WEBSITE");

  if (s.websiteReachable && (websiteCat?.score ?? 0) === 0) {
    issues.push({
      section: "Website",
      message: "Website is reachable per findings but scored 0/100.",
    });
  }
  if (Boolean(vm.signals.website) && !s.websiteUrlDetected) {
    issues.push({
      section: "Website",
      message: "Raw website signal present but the audit did not detect a website.",
    });
  }
  if (s.bookingDetected && !Boolean(vm.signals.bookingDetected)) {
    issues.push({
      section: "Booking",
      message: "Booking detected per findings but raw enrichment signal is missing.",
    });
  }
  return issues;
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
// Personalized overview statements (evidence-based, single source of truth)
// ---------------------------------------------------------------------------

export function buildOverviewStatement(vm: ReportViewModel): string {
  const name = vm.businessName;
  const s = deriveAuditSignals(vm);

  const detected: string[] = [];
  if (s.phoneDetected) detected.push("a publicly detectable phone number");
  if (s.websiteReachable) detected.push("a reachable website");

  const missing: string[] = [];
  if (!s.websiteUrlDetected) {
    missing.push("no publicly detectable website was identified");
  }
  if (!s.bookingDetected) {
    missing.push("no online booking path was identified");
  }
  if (!s.socialDetected && missing.length < 2) {
    missing.push("no public social presence was identified");
  }

  if (detected.length > 0 && missing.length > 0) {
    return `${name} currently has ${detected.join(" and ")}, while ${missing.join(
      ", and "
    )} during this assessment.`;
  }
  if (missing.length > 0) {
    const phoneNote = s.phoneDetected
      ? " Direct phone contact remains the most readily available channel."
      : "";
    return `During this assessment, ${missing.join(", and ")} for ${name}.${phoneNote}`;
  }
  if (detected.length > 0) {
    return `${name} was identified with ${detected.join(
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
    .filter((c) => deriveCategoryStatus(c.score) !== "STRONG" && deriveCategoryStatus(c.score) !== "GOOD")
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

  const s = deriveAuditSignals(vm);
  if (
    s.phoneDetected &&
    !strengths.some((st) => st.toLowerCase().includes("phone"))
  ) {
    strengths.push("A public phone number is available for direct contact.");
  }
  if (s.bookingDetected && vm.signals.bookingSystem) {
    strengths.push(
      `An online booking system was detected (${vm.signals.bookingSystem}).`
    );
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
  const s = deriveAuditSignals(vm);

  // DISCOVER
  const discover: JourneyStepData =
    s.reputationDetected
      ? {
          label: "Discover",
          headline: "Reputation signals present",
          detail: `Public review signals were identified (${
            s.rating !== null ? `${s.rating} star rating` : "a public rating"
          }${s.reviewCount !== null ? ` across ${s.reviewCount} reviews` : ""}).`,
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
  const websiteCat = categoryOf(vm, "WEBSITE");
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
      ? websiteWeakness.title === "No Website Found"
        ? {
            label: "Learn",
            headline: "Website not detected",
            detail:
              "No publicly detectable website was identified during this assessment.",
            positive: false,
            status: "Not detected",
          }
        : {
            label: "Learn",
            headline: "Website unreachable",
            detail: websiteWeakness.evidence,
            positive: false,
            status: "Not detected",
          }
      : s.websiteUrlDetected
        ? {
            label: "Learn",
            headline: "Website identified",
            detail:
              "A website URL was identified, though full accessibility could not be verified during this assessment.",
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

  // CONTACT — grounded in the same phone finding as the rest of the report
  const contact: JourneyStepData =
    s.phoneDetected
      ? {
          label: "Contact",
          headline: "Phone available",
          detail: `A public phone number was detected, making phone communication an important contact path${
            s.emailDetected ? ", alongside an email address" : ""
          }.${
            s.emailDetected
              ? ""
              : " Additional digital contact options were not detected."
          }`,
          positive: true,
          status: "Identified",
        }
      : {
          label: "Contact",
          headline: "Contact options limited",
          detail: s.emailDetected
            ? "No public phone number was detected, though an email address was identified as an alternative contact option."
            : "No public phone number or email address was detected during this assessment.",
          positive: false,
          status: "Not detected",
        };

  // SCHEDULE
  const schedule: JourneyStepData =
    s.bookingDetected
      ? {
          label: "Schedule",
          headline: "Online booking detected",
          detail: vm.signals.bookingSystem ?? "An online booking path was detected for scheduling.",
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
  if (!s.bookingDetected) {
    frictionParts.push(
      "customers who prefer to schedule online may need to call during business hours"
    );
  }
  if (!s.websiteReachable && s.phoneDetected && !s.bookingDetected) {
    frictionParts.push(
      "phone communication may be the primary path to service"
    );
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
    detail:
      "Create a simple, service-focused website so customers can verify services and learn how to get in touch.",
  },
  CONTACTABILITY: {
    title: "Improve contactability",
    detail:
      "Add clear contact channels and publish business hours so customers know how and when to reach you.",
  },
  BOOKING: {
    title: "Make scheduling easier",
    detail:
      "Offer an online scheduling path so customers can move from inquiry to appointment without waiting on hours of operation.",
  },
  SOCIAL: {
    title: "Strengthen local visibility",
    detail:
      "Build profiles on the platforms customers use most so the business is discoverable beyond phone directories.",
  },
  REPUTATION: {
    title: "Build public reputation signals",
    detail:
      "Encourage satisfied customers to leave public reviews so new customers can see social proof.",
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
      detail:
        CATEGORY_CONTEXT[c.key]?.opportunity ||
        `Address the findings in ${c.name.toLowerCase()}.`,
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
      detail:
        "Maintain the strengths identified in this assessment while reviewing the remaining findings.",
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

/**
 * PROBLEM card — evidence-based, never claims "primary lead source"
 * (the audit proves a phone number exists and other options are limited,
 * not that calls are the primary lead source).
 */
export function buildNextCallPrimary(vm: ReportViewModel): NextCallPrimary {
  const s = deriveAuditSignals(vm);

  let problem: string;
  if (!s.phoneDetected) {
    problem =
      "Limited publicly detectable contact channels were identified, so prospective customers may have few ways to reach the business.";
  } else if (!s.bookingDetected) {
    problem =
      "With limited digital contact options detected, phone communication appears to be an important customer contact path.";
  } else {
    problem =
      "Phone communication is an important customer contact path, and consistent handling of inbound calls helps capture inquiries when the team is unavailable.";
  }

  return {
    problem,
    whyItMatters:
      "Customers who reach out at times when the team is unavailable may experience a delayed response or friction in getting their inquiry addressed.",
    relevance: sanitizeNextCallCopy(vm.aiReport.nextCallRelevance),
  };
}

/** Primary capability cards only — every entry is an actual NEXT CALL
 *  product capability, keyed by the engine's opportunity type. */
const CAPABILITY_CATALOG: Record<
  string,
  { title: string; detail: string }
> = {
  AI_BOOKING_ASSISTANT: {
    title: "Appointment Scheduling",
    detail:
      "Helps move callers from inquiry toward a scheduled appointment during phone conversations.",
  },
  AI_AFTER_HOURS: {
    title: "24/7 AI Voice Receptionist",
    detail:
      "Answers inbound calls and handles initial customer conversations when the team is unavailable.",
  },
  AI_LEAD_CAPTURE: {
    title: "Lead Capture",
    detail:
      "Captures caller information and documents inquiry details so they can be followed up.",
  },
  AI_MISSED_CALL_RECOVERY: {
    title: "Missed Call Recovery",
    detail:
      "Helps identify inbound calls that were not answered and supports reconnecting with callers.",
  },
};

export interface CapabilityCardData {
  title: string;
  detail: string;
}

export function buildNextCallCapabilities(
  vm: ReportViewModel
): CapabilityCardData[] {
  const opps = vm.nextCallOpportunities || [];
  const capabilities: CapabilityCardData[] = [];

  for (const o of opps.slice(0, 3)) {
    const capability = CAPABILITY_CATALOG[o.type];
    if (capability) capabilities.push(capability);
  }

  if (capabilities.length === 0) {
    capabilities.push({
      title: "AI Voice Receptionist",
      detail:
        "Answers inbound calls and captures customer information to support a consistent response.",
    });
  }

  return capabilities.slice(0, 3);
}

/**
 * Consultative-copy sanitizer for AI-provided NEXT CALL copy.
 * Rewrites absolute-guarantee phrasing ("ensures every call is
 * answered", "never missed", "guarantees") into defensible wording.
 */
export function sanitizeNextCallCopy(text: string): string {
  if (!text) return text;

  let out = text;
  out = out.replace(
    /\bensures?\s+that\s+every\s+(?:inbound\s+)?call\s+is\s+answered(?:\s+or\s+an\s+actionable\s+follow-up\s+is\s+scheduled)?\b/gi,
    "is designed to help answer inbound calls consistently and capture actionable follow-ups"
  );
  out = out.replace(
    /\bensures?\s+every\s+(?:inbound\s+)?call\s+is\s+answered(?:\s+or\s+an\s+actionable\s+follow-up\s+is\s+scheduled)?\b/gi,
    "is designed to help answer inbound calls consistently and capture actionable follow-ups"
  );
  out = out.replace(/\bensures?\b(?!\s*(?:that\s+)?(?:data|privacy))/gi, "is designed to help");
  out = out.replace(/\bnever\s+miss(?:es|ed|ing)?\s+a\s+call\b/gi, "help reduce missed calls");
  out = out.replace(/\bnever\s+miss(?:es|ed|ing)?\s+calls?\b/gi, "help reduce missed calls");
  out = out.replace(/\bguarantee[sd]?\b/gi, "supports");
  out = out.replace(/\bprimary\s+lead\s+source\b/gi, "an important customer contact path");
  out = out.replace(/\bprimary\s+phone\s+reliance\b/gi, "phone reliance");
  return out;
}