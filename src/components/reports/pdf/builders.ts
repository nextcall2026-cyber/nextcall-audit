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
    .sort((a, b) => a.score - b.score || CATEGORY_PRIORITY[a.key] - CATEGORY_PRIORITY[b.key]);

  const targets = weak.length >= 2 ? weak : vm.categoryDetails.slice().sort((a, b) => a.score - b.score || CATEGORY_PRIORITY[a.key] - CATEGORY_PRIORITY[b.key]);

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
            headline: "No public website detected",
            detail:
              "No publicly detectable website was identified during this assessment.",
            positive: false,
            status: "Not detected",
          }
        : {
            label: "Learn",
            headline: "Website not reachable",
            detail: websiteWeakness.evidence,
            positive: false,
            status: "Unable to verify",
          }
      : s.websiteUrlDetected
        ? {
            label: "Learn",
            headline: "Website identified",
            detail:
              "A website URL was identified, though full accessibility could not be verified during this assessment.",
            positive: false,
            status: "Unable to verify",
          }
        : {
            label: "Learn",
            headline: "Accessibility unverified",
            detail: "Website accessibility could not be fully verified during this assessment.",
            positive: false,
            status: "Unable to verify",
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
          status: "Needs attention",
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
// NEXT CALL — solution tied to real audit opportunities
// ---------------------------------------------------------------------------

/**
 * Relevant capabilities are selected deterministically from the same
 * audit signals the rest of the report is built on. A capability is only
 * shown when the audit supports its relevance — never because it exists
 * in the product. Each card explains the connection:
 *   FINDING → CUSTOMER IMPACT → NEXTCALL SOLUTION
 */
export type NextCallCapabilityKey =
  | "RECEPTIONIST_24_7"
  | "APPOINTMENT_SCHEDULING"
  | "MISSED_CALL_RECOVERY"
  | "LEAD_CAPTURE"
  | "AUTOMATED_FOLLOW_UP"
  | "REVIEW_FOLLOW_UP"
  | "SOCIAL_DM"
  | "EMERGENCY_FORWARDING";

export interface NextCallCapabilityCard {
  key: NextCallCapabilityKey;
  title: string;
  opportunity: string; // THE OPPORTUNITY — what was detected for this business
  whyItMatters: string; // WHY IT MATTERS — customer/business friction this may create
  howNextCallHelps: string; // HOW NEXTCALL HELPS — the relevant capability
}

const CAPABILITY_CATALOG: Record<
  NextCallCapabilityKey,
  Omit<NextCallCapabilityCard, "key">
> = {
  RECEPTIONIST_24_7: {
    title: "24/7 AI Voice Receptionist",
    opportunity:
      "Phone communication is an important contact path, and callers may reach out at times when the team is unavailable.",
    whyItMatters:
      "Inquiries that arrive after hours or while the team is busy may wait before a customer hears back, delaying the path from inquiry to service.",
    howNextCallHelps:
      "NextCall answers inbound calls 24/7 with a custom greeting, handles common questions, detects urgent situations, and captures the caller's name, phone and email.",
  },
  APPOINTMENT_SCHEDULING: {
    title: "AI Appointment Scheduling",
    opportunity:
      "No publicly detectable online booking path was identified for this business.",
    whyItMatters:
      "Customers who prefer to schedule ahead may need to call during business hours and wait for availability before moving forward.",
    howNextCallHelps:
      "NextCall can handle appointment conversations over the phone, check availability against Google Calendar, and confirm bookings so jobs make it onto the calendar.",
  },
  MISSED_CALL_RECOVERY: {
    title: "Missed Call Recovery",
    opportunity:
      "Phone appears to be an important contact path, with limited digital alternatives detected.",
    whyItMatters:
      "If a call is not answered, the inquiry may be lost entirely because there is no other clear way for the customer to follow up.",
    howNextCallHelps:
      "NextCall helps identify calls that were not answered and can re-engage callers automatically so no inquiry quietly slips away.",
  },
  LEAD_CAPTURE: {
    title: "Lead Capture",
    opportunity:
      "Limited digital contact channels were detected, so inquiries may arrive through unstructured paths.",
    whyItMatters:
      "Without structured capture, inquiry details may be incomplete or depend on manual notes before a customer can move forward.",
    howNextCallHelps:
      "NextCall records caller information and inquiry details during phone conversations and can alert the team to new leads.",
  },
  AUTOMATED_FOLLOW_UP: {
    title: "Automated Customer Follow-Up",
    opportunity:
      "Because no online scheduling path was detected, customers may need multiple touchpoints before committing.",
    whyItMatters:
      "Customers who do not hear back promptly may move on to another provider without the team knowing.",
    howNextCallHelps:
      "NextCall can send follow-up messages after calls and keep conversation history organized so the team can pick up where the customer left off.",
  },
  REVIEW_FOLLOW_UP: {
    title: "Review Follow-Up",
    opportunity:
      "A public reputation exists, but review volume is limited, so prospective customers have less public social proof to rely on.",
    whyItMatters:
      "Fewer visible reviews can make it harder for prospective customers to trust the business during their research.",
    howNextCallHelps:
      "NextCall can send automated review requests after completed jobs and help the team manage public replies.",
  },
  SOCIAL_DM: {
    title: "Facebook / Instagram DM Automation",
    opportunity:
      "Social profiles were detected, and customers may send inquiries through direct messages.",
    whyItMatters:
      "Messages that arrive while the team is busy or after hours may sit unanswered until someone checks the inbox.",
    howNextCallHelps:
      "NextCall can automate responses to Facebook and Instagram direct messages so inquiries receive a timely reply.",
  },
  EMERGENCY_FORWARDING: {
    title: "Emergency Detection & Call Forwarding",
    opportunity:
      "This business category commonly involves time-sensitive requests, so urgent calls are plausible.",
    whyItMatters:
      "If an urgent request cannot reach the right person quickly, customers may seek another provider.",
    howNextCallHelps:
      "NextCall detects emergency language during calls and can forward or alert the team so urgent requests are addressed right away.",
  },
};

const EMERGENCY_CATEGORY_KEYWORDS = [
  "plumb",
  "hvac",
  "heat",
  "cool",
  "electrical",
  "electrician",
  "water",
  "sewer",
  "drain",
  "roof",
  "gas",
  "furnace",
  "air conditioning",
  "ac repair",
];

function isEmergencyCategory(category: string): boolean {
  const value = category?.toLowerCase() ?? "";
  return EMERGENCY_CATEGORY_KEYWORDS.some((k) => value.includes(k));
}

/**
 * Selects the 2–4 capabilities that genuinely address this business's
 * detected opportunities.
 *
 * Selection follows the audit, worst first: the weakest categories drive
 * which capabilities are considered (a gap in booking points to scheduling
 * help, an unreachable website with phone reliance points to call capture).
 * Card order follows a conversion-first ladder — the steady-availability
 * card leads, urgency and recovery follow, then scheduling — while the
 * set itself stays grounded in what the audit actually found.
 */
export function buildNextCallCapabilities(
  vm: ReportViewModel
): NextCallCapabilityCard[] {
  const s = deriveAuditSignals(vm);
  const selected: NextCallCapabilityKey[] = [];
  const add = (key: NextCallCapabilityKey) => {
    if (!selected.includes(key)) selected.push(key);
  };

  // Specific, category-driven candidates — worst category first.
  const weakestFirst = vm.categoryDetails
    .slice()
    .sort((a, b) => a.score - b.score);
  for (const cat of weakestFirst) {
    const status = deriveCategoryStatus(cat.score);
    if (status === "STRONG" || status === "GOOD") continue;

    if (cat.key === "BOOKING" && !s.bookingDetected) {
      add("APPOINTMENT_SCHEDULING");
    } else if (cat.key === "WEBSITE" && !s.websiteReachable && s.phoneDetected) {
      add("MISSED_CALL_RECOVERY");
    } else if (cat.key === "WEBSITE" && !s.websiteReachable && !s.phoneDetected) {
      add("LEAD_CAPTURE");
    } else if (cat.key === "CONTACTABILITY" && (s.phoneDetected ? !s.emailDetected : true)) {
      add("LEAD_CAPTURE");
    }
  }

  // Base cards grounded in the strongest signals (fill remaining slots).
  if (!s.bookingDetected) add("APPOINTMENT_SCHEDULING");
  if (s.phoneDetected) add("RECEPTIONIST_24_7");
  else if (!s.emailDetected || !s.websiteReachable) add("LEAD_CAPTURE");

  // Optional cards, most specific to the audit first.
  if (s.phoneDetected && !s.websiteReachable) add("MISSED_CALL_RECOVERY");
  if (isEmergencyCategory(vm.category) && s.phoneDetected) {
    add("EMERGENCY_FORWARDING");
  }
  if (s.phoneDetected && !s.bookingDetected) add("AUTOMATED_FOLLOW_UP");
  if (s.socialDetected && !s.bookingDetected) add("SOCIAL_DM");
  if (s.reputationDetected && s.reviewCount !== null && s.reviewCount < 30) {
    add("REVIEW_FOLLOW_UP");
  }

  const LADDER: NextCallCapabilityKey[] = [
    "RECEPTIONIST_24_7",
    "EMERGENCY_FORWARDING",
    "MISSED_CALL_RECOVERY",
    "APPOINTMENT_SCHEDULING",
    "AUTOMATED_FOLLOW_UP",
    "LEAD_CAPTURE",
    "SOCIAL_DM",
    "REVIEW_FOLLOW_UP",
  ];
  const ordered = selected
    .slice()
    .sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b));

  const cards = ordered
    .slice(0, 4)
    .map((key) => ({ key, ...CAPABILITY_CATALOG[key] }));

  if (cards.length === 0) {
    // Fully strong business: one honest, relevant capability remains.
    cards.push({
      key: "RECEPTIONIST_24_7",
      ...CAPABILITY_CATALOG.RECEPTIONIST_24_7,
      opportunity:
        "Consistent handling of inbound calls supports capturing inquiries when the team is unavailable.",
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// NEXT CALL — final conversion CTA (personalized from verified findings)
// ---------------------------------------------------------------------------

export interface NextCallCtaContent {
  overview: string;
  productLine: string;
  personalized: string;
  howNextCallHelps: string;
  benefits: string[];
}

const CTA_BENEFIT_BY_KEY: Record<NextCallCapabilityKey, string> = {
  RECEPTIONIST_24_7: "Answer calls 24/7",
  APPOINTMENT_SCHEDULING: "Book appointments over the phone",
  MISSED_CALL_RECOVERY: "Recover missed calls automatically",
  LEAD_CAPTURE: "Capture lead details",
  AUTOMATED_FOLLOW_UP: "Follow up automatically",
  REVIEW_FOLLOW_UP: "Request reviews after completed jobs",
  SOCIAL_DM: "Automate Facebook & Instagram DMs",
  EMERGENCY_FORWARDING: "Detect and forward urgent calls",
};

const CTA_HELP_BY_KEY: Record<NextCallCapabilityKey, string> = {
  RECEPTIONIST_24_7: "answering calls 24/7",
  APPOINTMENT_SCHEDULING: "booking appointments over the phone",
  MISSED_CALL_RECOVERY: "reconnecting with callers who were not answered",
  LEAD_CAPTURE: "capturing caller information",
  AUTOMATED_FOLLOW_UP: "following up automatically",
  REVIEW_FOLLOW_UP: "requesting reviews after completed jobs",
  SOCIAL_DM: "automating social media inquiries",
  EMERGENCY_FORWARDING: "detecting and forwarding urgent requests",
};

/**
 * Personalization is derived from the audit's strongest opportunity —
 * never a fixed paragraph. Wording stays hedged ("appears to be",
 * "may", "could") because the audit proves presence/absence of signals,
 * not business outcomes.
 *
 * Copy addresses the reader as "your business" / "you" — the business
 * name is never used to describe what NextCall does, so a business
 * named "NextCall" can never be confused with the product.
 */
export function buildNextCallCta(vm: ReportViewModel): NextCallCtaContent {
  const s = deriveAuditSignals(vm);
  const capabilities = buildNextCallCapabilities(vm);
  const keys = capabilities.map((c) => c.key);

  let opportunityPhrase: string;
  if (!s.bookingDetected) {
    opportunityPhrase =
      "making it easier for customers to move from inquiry to a scheduled appointment with your business";
  } else if (!s.websiteReachable) {
    opportunityPhrase =
      "giving customers a dependable place to learn about, and reach, your business";
  } else if (!s.socialDetected) {
    opportunityPhrase =
      "expanding the channels where customers can discover your business";
  } else if (s.phoneDetected) {
    opportunityPhrase =
      "handling customer inquiries consistently when the team is busy or unavailable";
  } else {
    opportunityPhrase =
      "strengthening the public contact and scheduling paths for your business";
  }

  const benefits = keys
    .map((k) => CTA_BENEFIT_BY_KEY[k])
    .filter(Boolean)
    .slice(0, 3);

  const helpParts = keys
    .map((k) => CTA_HELP_BY_KEY[k])
    .filter(Boolean)
    .slice(0, 3);

  return {
    overview:
      "This assessment points to several ways to make it easier for customers to reach you, learn about your business, and move from inquiry to service.",
    productLine:
      "NextCall provides an AI receptionist and customer communication system designed for local service businesses.",
    personalized: `Your strongest opportunity appears to be ${opportunityPhrase}.`,
    howNextCallHelps: `NextCall can help by ${helpParts.join(", ")}.`,
    benefits,
  };
}

// ---------------------------------------------------------------------------
// NEXT CALL — opportunity framing (kept distinct from the presence score)
// ---------------------------------------------------------------------------

export interface NextCallOpportunitySignal {
  level: "Significant" | "Moderate" | "Limited";
  summary: string;
}

/**
 * P16: The Digital Presence Score measures what the audit could verify.
 * This is a separate signal: how well a NextCall-style answering
 * solution fits what the audit found, derived from the engine's own
 * opportunity mapping — never from assumed business outcomes.
 */
export function buildNextCallOpportunity(
  vm: ReportViewModel
): NextCallOpportunitySignal {
  const s = deriveAuditSignals(vm);
  const count = vm.nextCallOpportunities?.length ?? 0;
  const titles = (vm.nextCallOpportunities ?? [])
    .map((o) => o.title)
    .slice(0, 2)
    .join(", ");

  const strongFit = count > 0 && s.phoneDetected && !s.bookingDetected;
  const level: NextCallOpportunitySignal["level"] = strongFit
    ? "Significant"
    : count >= 1
      ? "Moderate"
      : "Limited";

  let summary: string;
  if (count > 0) {
    summary = `The audit mapped ${count} ${
      count === 1 ? "opportunity" : "opportunities"
    } where an AI receptionist could help (${
      titles || "see the capabilities below"
    }).`;
  } else {
    summary =
      "No specific gap mapped by this assessment — NextCall could still provide a consistent 24/7 answering channel.";
  }
  return { level, summary };
}

// ---------------------------------------------------------------------------
// Score methodology (P2) — the real weights from the audit engine
// ---------------------------------------------------------------------------

export interface ScoreMethodologyItem {
  name: string;
  weightPercent: number;
}

export interface ScoreMethodology {
  items: ScoreMethodologyItem[];
  formula: string;
}

export function buildScoreMethodology(vm: ReportViewModel): ScoreMethodology {
  const items = vm.categoryDetails.map((c) => ({
    name: c.name,
    weightPercent: Math.round(c.weight * 100),
  }));
  const formula = `Overall = ${items
    .map((i) => `${i.name} × ${i.weightPercent}%`)
    .join(" + ")}`;
  return { items, formula };
}

// ---------------------------------------------------------------------------
// Business snapshot (cover) — key positive signal + biggest opportunity
// ---------------------------------------------------------------------------

// Fixed tie-break rank so tied categories resolve deterministically to the
// most business-critical gap (booking > contact > website > social > reputation).
const CATEGORY_PRIORITY: Record<AuditCategoryName, number> = {
  BOOKING: 0,
  CONTACTABILITY: 1,
  WEBSITE: 2,
  SOCIAL: 3,
  REPUTATION: 4,
};

export function buildCoverSignals(vm: ReportViewModel): {
  positive: string;
  opportunity: string;
} {
  const sorted = vm.categoryDetails.slice().sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    // When categories tie, treat the more business-critical one as the
    // bigger opportunity (e.g. booking over social at 0/100 each).
    return CATEGORY_PRIORITY[b.key] - CATEGORY_PRIORITY[a.key];
  });
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  let positive: string;
  const strongestStatus = deriveCategoryStatus(strongest.score);
  if (strongestStatus === "STRONG" || strongestStatus === "GOOD") {
    const strength = strongest.findings.find((f) => f.type === "STRENGTH");
    positive =
      strength?.evidence ||
      `A working, publicly detectable presence was identified in ${strongest.name.toLowerCase()}.`;
  } else {
    const s = deriveAuditSignals(vm);
    if (s.phoneDetected) {
      positive =
        "A public phone number was detected, giving customers a direct contact path.";
    } else if (s.websiteUrlDetected) {
      positive = "A website presence was identified during this assessment.";
    } else if (s.emailDetected) {
      positive = "An email address was identified as a contact option.";
    } else {
      positive =
        "The business was identified in local business directories during this assessment.";
    }
  }

  const opportunity = categoryContext(weakest).opportunity;

  return { positive, opportunity };
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