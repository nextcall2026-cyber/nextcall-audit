/**
 * Deterministic initial outreach email builder.
 *
 * The email is composed entirely from the SAME audit data the PDF report
 * is built from (the shared report builders), so the story the email
 * tells can never contradict the attached PDF:
 *   - the opening positive signal is a VERIFIED audit signal
 *   - the highlighted finding is a REAL audit finding (shown in the PDF)
 *   - the NextCall capabilities are a subset of the PDF's own capability
 *     cards, with the primary card mapped 1:1 to the finding category
 *
 * NEXT CALL POSITIONING (single rule):
 *   NextCall is presented as the practical response to the customer
 *   friction the audit identified — OBSERVED SIGNAL → CUSTOMER FRICTION →
 *   RELEVANT NEXTCALL CAPABILITY → LOW-RISK 3-DAY TRIAL. The business
 *   name is never used as the actor for a product action ("{name} can
 *   use NextCall..." never happens), so a business literally named
 *   "NextCall" can never produce a variable-confusion sentence.
 *
 * Copy rules (kept testable):
 *   - 130-180 words target, hard max 200
 *   - evidence-aware wording ("not detected" / "could not be verified"),
 *     never "you don't have X" or invented business outcomes
 *   - single natural subject — no URGENT / FREE / LIMITED TIME language
 *   - primary CTA is the attached audit, not a booked meeting
 *   - no unsubscribe footer here: renderEmailHtml appends it
 *
 * Pure and side-effect free (no server-only imports) so it can be
 * unit-tested directly.
 */

import {
  Business,
  AuditResult,
  AuditReport,
  CTAType,
  ReportViewModel,
  AuditCategoryName,
  NextCallOpportunityType,
} from "@/types";
import { buildReportViewModel } from "@/services/reportViewModel";
import {
  buildNextCallCapabilities,
  buildPriorityFindings,
  deriveAuditSignals,
  deriveCategoryStatus,
  FindingCardData,
  NextCallCapabilityCard,
  NextCallCapabilityKey,
} from "@/components/reports/pdf/builders";
import { NEXTCALL_TRIAL_URL, NEXTCALL_OFFERS_TRIAL } from "@/lib/nextCallConfig";

export interface OutreachEmailContent {
  subject: string;
  body: string; // plain text; renderEmailHtml turns it into safe HTML
  ctaType: CTAType;
  angle: string;
  /** Rendered by the email renderer as a clickable CTA (null = no CTA button). */
  ctaLink: { label: string; url: string } | null;
}

export interface OutreachEmailInput {
  business: Business;
  audit: AuditResult;
  aiReport: AuditReport;
  /** Whether the PDF audit is attached to the email (drives the CTA line). */
  attachmentIncluded: boolean;
}

// Short "what it does" clauses for the email's capability sentence.
// The card TITLES are always the PDF's own titles; the clause is the
// only email-specific text about the product. Exported so the PDF-
// consistency tests can assert every mentioned clause maps to a PDF card.
export const EMAIL_HELP_BY_KEY: Record<NextCallCapabilityKey, string> = {
  RECEPTIONIST_24_7: "answer inbound calls 24/7 with a custom greeting",
  APPOINTMENT_SCHEDULING:
    "handle appointment conversations over the phone, check availability through Google Calendar, and confirm bookings",
  MISSED_CALL_RECOVERY: "reconnect with callers who were not answered",
  LEAD_CAPTURE: "capture caller details during conversations",
  AUTOMATED_FOLLOW_UP: "follow up after calls",
  REVIEW_FOLLOW_UP: "request reviews after completed jobs",
  SOCIAL_DM: "automate Facebook and Instagram DM replies",
  EMERGENCY_FORWARDING: "detect urgent calls and forward them to the team",
};

// Email-specific "why it matters" wording. The audit proves that booking
// was NOT DETECTED — it never proves the business actually keeps customers
// waiting — so the impact stays hedged ("may need to rely on...").
const EMAIL_WHY_IT_MATTERS_BY_KEY: Partial<Record<NextCallCapabilityKey, string>> = {
  APPOINTMENT_SCHEDULING:
    "Customers who prefer to schedule ahead may need to rely on a phone call during business hours before moving forward.",
};

// The single capability that directly answers each category's gap.
// Only honored when the capability is actually in the PDF's selected set.
const FINDING_CATEGORY_CAPABILITY: Record<
  AuditCategoryName,
  (vm: ReportViewModel) => NextCallCapabilityKey
> = {
  BOOKING: () => "APPOINTMENT_SCHEDULING",
  CONTACTABILITY: (vm) =>
    deriveAuditSignals(vm).phoneDetected ? "RECEPTIONIST_24_7" : "LEAD_CAPTURE",
  WEBSITE: (vm) =>
    deriveAuditSignals(vm).phoneDetected ? "MISSED_CALL_RECOVERY" : "LEAD_CAPTURE",
  SOCIAL: () => "SOCIAL_DM",
  REPUTATION: () => "REVIEW_FOLLOW_UP",
};

// Preferred SECOND capability per category, in priority order. The first
// one present in the PDF's selected set (and different from the primary)
// is used, so the pair stays audit-grounded (e.g. a booking gap pairs
// appointment scheduling with automated follow-up — both cards in the PDF).
const SECONDARY_BY_CATEGORY: Record<AuditCategoryName, NextCallCapabilityKey[]> = {
  BOOKING: ["AUTOMATED_FOLLOW_UP", "RECEPTIONIST_24_7"],
  CONTACTABILITY: ["MISSED_CALL_RECOVERY", "LEAD_CAPTURE", "AUTOMATED_FOLLOW_UP"],
  WEBSITE: ["RECEPTIONIST_24_7", "AUTOMATED_FOLLOW_UP", "LEAD_CAPTURE"],
  SOCIAL: ["RECEPTIONIST_24_7", "AUTOMATED_FOLLOW_UP"],
  REPUTATION: ["RECEPTIONIST_24_7", "AUTOMATED_FOLLOW_UP"],
};

// The audit engine maps specific weaknesses to NextCall opportunity types.
// That mapping IS the NextCall-priority signal — we reuse it instead of
// building a second scoring system.
const ENGINE_OPPORTUNITY_CATEGORY: Partial<
  Record<NextCallOpportunityType, AuditCategoryName>
> = {
  AI_BOOKING_ASSISTANT: "BOOKING",
  AI_MISSED_CALL_RECOVERY: "WEBSITE",
  AI_LEAD_CAPTURE: "CONTACTABILITY",
  AI_AFTER_HOURS: "CONTACTABILITY",
};

function possessive(name: string): string {
  const trimmed = name.trim();
  return trimmed.endsWith("s") ? `${trimmed}'` : `${trimmed}'s`;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function keyOfCategoryName(
  vm: ReportViewModel,
  displayName: string
): AuditCategoryName | undefined {
  return vm.categoryDetails.find((c) => c.name === displayName)?.key;
}

/** True when no category is LIMITED or worse — nothing to flag in the email. */
function hasNoWeakCategories(vm: ReportViewModel): boolean {
  return vm.categoryDetails.every((c) => {
    const status = deriveCategoryStatus(c.score);
    return status === "STRONG" || status === "GOOD";
  });
}

/**
 * The single highest-value finding.
 *
 * Not "the lowest score" blindly: candidates are restricted to categories
 * the AUDIT ENGINE itself mapped to a NextCall opportunity (booking /
 * contactability / website gaps), then picked worst-first with the
 * PDF's CATEGORY_PRIORITY tie-break. Falls back to the PDF's lead card.
 * The chosen card is always a card the PDF executive summary shows, so
 * the email can only highlight findings the PDF actually contains.
 */
function pickTopFinding(vm: ReportViewModel): FindingCardData | null {
  if (hasNoWeakCategories(vm)) return null;
  const cards = buildPriorityFindings(vm);
  const engineCats = new Set<AuditCategoryName>();
  for (const op of vm.nextCallOpportunities ?? []) {
    const cat = ENGINE_OPPORTUNITY_CATEGORY[op.type];
    if (cat) engineCats.add(cat);
  }
  if (engineCats.size > 0) {
    const candidate = cards.find((c) => {
      const key = keyOfCategoryName(vm, c.category);
      return key !== undefined && engineCats.has(key);
    });
    return candidate ?? cards[0] ?? null;
  }
  return cards[0] ?? null;
}

/**
 * 1-2 capability cards, always a subset of the PDF's selected cards.
 * Primary = the capability mapped to the finding's category; secondary =
 * the best audit-grounded companion for that same category. Both titles
 * therefore always appear in the PDF.
 */
function pickCapabilityCards(
  vm: ReportViewModel,
  top: FindingCardData | null
): NextCallCapabilityCard[] {
  const set = buildNextCallCapabilities(vm);
  if (set.length === 0) return [];

  const primaryKey = top
    ? FINDING_CATEGORY_CAPABILITY[keyOfCategoryName(vm, top.category) ?? "BOOKING"](
        vm
      )
    : null;
  const primary =
    (primaryKey && set.find((c) => c.key === primaryKey)) || set[0];

  let second: NextCallCapabilityCard | undefined;
  if (top) {
    const prefs = SECONDARY_BY_CATEGORY[keyOfCategoryName(vm, top.category) ?? "BOOKING"];
    if (prefs) {
      for (const key of prefs) {
        const candidate = set.find((c) => c.key === key);
        if (candidate && candidate.key !== primary.key) {
          second = candidate;
          break;
        }
      }
    }
  }
  if (!second) second = set.find((c) => c.key !== primary.key);

  return second ? [primary, second] : [primary];
}

/**
 * ONE verified positive signal — the strongest the audit supports.
 * Rating first, then review volume, social, website, phone, email.
 * Never invents a signal the audit could not verify.
 */
function buildPositiveSignalSentence(vm: ReportViewModel): string {
  const s = deriveAuditSignals(vm);

  if (s.rating !== null && s.rating >= 4) {
    return s.reviewCount !== null && s.reviewCount > 0
      ? `I noticed a ${s.rating}-star rating across ${s.reviewCount} reviews — a strong reputation signal.`
      : `I noticed a ${s.rating}-star public rating — a strong reputation signal.`;
  }
  if (s.reviewCount !== null && s.reviewCount > 0) {
    return `I noticed ${s.reviewCount} customer reviews — a helpful signal for prospective customers.`;
  }
  const platforms = vm.signals.socialProfiles
    .map((p) => p.platform)
    .filter(Boolean);
  if (s.socialDetected && platforms.length > 0) {
    return `I noticed you maintain a profile on ${platforms.join(
      " and "
    )} — a helpful channel for customers to find you.`;
  }
  if (s.websiteReachable) {
    return "I noticed your website is live and easy to find.";
  }
  if (s.phoneDetected) {
    return "I noticed a public phone number listed for direct contact.";
  }
  if (s.emailDetected) {
    return "I noticed an email address listed for direct contact.";
  }
  return "I took a look at how customers find and contact your business online.";
}

function buildFindingParagraph(
  vm: ReportViewModel,
  top: FindingCardData | null,
  primaryCard: NextCallCapabilityCard
): string | null {
  if (!top) return null;
  // "why it matters" comes from the PDF's own capability card for this
  // finding (with email-specific hedged wording where needed), so the
  // chain finding → friction → solution stays one story.
  const whyItMatters =
    EMAIL_WHY_IT_MATTERS_BY_KEY[primaryCard.key] ?? primaryCard.whyItMatters;
  return `One thing the audit flagged: ${top.finding} ${whyItMatters}`;
}

function buildCapabilitySentence(
  cards: NextCallCapabilityCard[],
  foundGap: boolean
): string {
  const titles = cards.map((c) => c.title).join(" and ");
  const helps = cards.map((c) => EMAIL_HELP_BY_KEY[c.key]).join(", and ");
  const verb = cards.length === 1 ? "is" : "are";
  const pronoun = cards.length === 1 ? "it" : "they";

  if (!foundGap) {
    return `NextCall's ${titles} ${verb} also designed to keep inbound calls handled consistently — ${pronoun} can ${helps}.`;
  }
  return `That's one area where NextCall may be able to help — its AI can ${helps}.`;
}

function buildAttachmentSentence(included: boolean): string {
  return included
    ? "I've attached the full audit with the details — it takes about two minutes to review."
    : "If you'd like the full PDF audit, just reply and I'll send it over.";
}

export function buildOutreachEmail(
  input: OutreachEmailInput
): OutreachEmailContent {
  const { business, audit, aiReport, attachmentIncluded } = input;
  const name = business.name?.trim() || "your business";
  const vm = buildReportViewModel(business, audit, aiReport);

  const top = pickTopFinding(vm);
  const cards = pickCapabilityCards(vm, top);
  const primaryCard = cards[0];

  const paragraphs: string[] = [
    `Hi ${name} Team,`,
    buildPositiveSignalSentence(vm),
  ];

  if (top) {
    const finding = buildFindingParagraph(vm, top, primaryCard);
    if (finding) paragraphs.push(finding);
  } else {
    paragraphs.push(
      "There's nothing on the audit that needs immediate attention — but when calls come in while the team is busy or away, NextCall can step in and keep inquiries from waiting."
    );
  }

  paragraphs.push(
    `${buildCapabilitySentence(cards, Boolean(top))} ${buildAttachmentSentence(
      attachmentIncluded
    )}`
  );

  let ctaLink: OutreachEmailContent["ctaLink"] = null;
  if (NEXTCALL_OFFERS_TRIAL) {
    paragraphs.push(
      "If you'd like to see how it works, you can also try NextCall free for 3 days."
    );
    ctaLink = { label: "Try NextCall free for 3 days", url: NEXTCALL_TRIAL_URL };
  }

  paragraphs.push(
    "And if anything in the audit raises a question, just reply — happy to help.",
    "Best regards,",
    "The NextCall Team"
  );

  return {
    subject: `A quick look at ${possessive(name)} digital presence`,
    body: paragraphs.join("\n\n"),
    ctaType: "OFFER_AUDIT",
    angle: top ? `Audit finding: ${top.title}` : "Digital presence audit",
    ctaLink,
  };
}