import { Business, OpportunityScore, OpportunityBreakdownItem } from "@/types";

const CATEGORIES = {
  BOOKING_GAP: 'Online Booking & Scheduling',
  COMMUNICATION_GAP: 'Customer Communication Channels',
  DIGITAL_PRESENCE: 'Digital Presence',
  PHONE_DEPENDENCY: 'Phone-Dependent Business Fit',
  ENGAGEMENT_GAP: 'Customer Engagement',
} as const;

export class OpportunityService {

  calculateScore(business: Business): OpportunityScore {
    const breakdown: OpportunityBreakdownItem[] = [];
    const reasons: string[] = [];
    const evidence: string[] = [];
    const unknownFactors: string[] = [];
    let totalScore = 0;

    // --- 1. Online Booking & Automation Gap (max 20) ---
    const bookingGapScore = this.evaluateBookingGap(business, breakdown, reasons, evidence, unknownFactors);
    totalScore += bookingGapScore;

    // --- 2. Customer Communication Channels (max 20) ---
    const commGapScore = this.evaluateCommunicationGap(business, breakdown, reasons, evidence, unknownFactors);
    totalScore += commGapScore;

    // --- 3. Digital Presence (max 25) ---
    const digitalPresenceScore = this.evaluateDigitalPresence(business, breakdown, reasons, evidence);
    totalScore += digitalPresenceScore;

    // --- 4. Phone-Dependent Business Fit (max 20) ---
    const phoneDependencyScore = this.evaluatePhoneDependency(business, breakdown, reasons, evidence);
    totalScore += phoneDependencyScore;

    // --- 5. Customer Engagement (max 15) ---
    const engagementScore = this.evaluateEngagement(business, breakdown, reasons, evidence, unknownFactors);
    totalScore += engagementScore;

    // Clamp
    totalScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // Level
    let level: OpportunityScore['level'];
    if (totalScore >= 75) level = 'VERY_HIGH';
    else if (totalScore >= 55) level = 'HIGH';
    else if (totalScore >= 30) level = 'MEDIUM';
    else level = 'LOW';

    return {
      score: totalScore,
      level,
      reasons: this.deduplicate(reasons).slice(0, 6),
      evidence: this.deduplicate(evidence).slice(0, 8),
      unknownFactors: this.deduplicate(unknownFactors).slice(0, 5),
      scoreBreakdown: breakdown,
    };
  }

  private evaluateBookingGap(
    business: Business, breakdown: OpportunityBreakdownItem[], reasons: string[],
    evidence: string[], unknownFactors: string[]
  ): number {
    let score = 0;
    const enrichment = business.enrichment;

    if (enrichment?.booking) {
      if (enrichment.booking.detected === false) {
        score += 15;
        reasons.push("No online booking system detected — NextCall can automate appointment booking");
        breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'Online booking detected', points: 15, maxPoints: 20, status: 'DETECTED' });
      } else if (enrichment.booking.detected === true) {
        evidence.push(`Booking system found: ${enrichment.booking.systemName || 'Yes'} (${enrichment.booking.url || 'on website'})`);
        breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'No online booking', points: 0, maxPoints: 20, status: 'NOT_DETECTED' });
      }
    } else if (business.website) {
      unknownFactors.push("Online booking status: unable to verify (enrich first)");
      breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'No online booking', points: 0, maxPoints: 20, status: 'UNVERIFIED' });
    } else {
      // No website at all - high opportunity for booking automation
      score += 10;
      reasons.push("No website — potential booking gap, NextCall can handle scheduling entirely");
      breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'No online booking (no website)', points: 10, maxPoints: 20, status: 'DETECTED' });
    }

    // Contact form signal
    if (enrichment?.features) {
      const cf = enrichment.features.hasContactForm;
      if (cf === false) {
        score += 5;
        reasons.push("No contact form on website — calls are the only conversion path");
        breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'No contact form', points: 5, maxPoints: 5, status: 'DETECTED' });
      } else if (cf === 'UNKNOWN') {
        breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'Contact form', points: 0, maxPoints: 5, status: 'UNVERIFIED' });
      } else if (cf === true) {
        evidence.push("Contact form present on website");
        breakdown.push({ category: CATEGORIES.BOOKING_GAP, signal: 'Contact form', points: 0, maxPoints: 5, status: 'NOT_DETECTED' });
      }
    }

    return score;
  }

  private evaluateCommunicationGap(
    business: Business, breakdown: OpportunityBreakdownItem[], reasons: string[],
    evidence: string[], unknownFactors: string[]
  ): number {
    let score = 0;
    const enrichment = business.enrichment;

    // Email
    if (enrichment?.emails) {
      if (enrichment.emails.length === 0) {
        score += 8;
        reasons.push("No business email found — communication gap, NextCall can capture leads via phone/sms");
        breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Business email found', points: 8, maxPoints: 8, status: 'DETECTED' });
      } else if (enrichment.preferredEmail) {
        evidence.push(`Email found: ${enrichment.preferredEmail}`);
        breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Business email found', points: 0, maxPoints: 8, status: 'NOT_DETECTED' });
      }
    } else if (business.website) {
      unknownFactors.push("Email availability: unable to verify (enrich first)");
      breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Business email found', points: 0, maxPoints: 8, status: 'UNVERIFIED' });
    }

    // Social media
    if (enrichment?.socialProfiles) {
      if (enrichment.socialProfiles.length === 0) {
        score += 8;
        reasons.push("No social media profiles detected — NextCall can manage Facebook/Instagram DMs");
        breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Social media presence', points: 8, maxPoints: 8, status: 'DETECTED' });
      } else {
        evidence.push(`Social profiles: ${enrichment.socialProfiles.map(s => s.platform).join(', ')}`);
        breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Social media presence', points: 0, maxPoints: 8, status: 'NOT_DETECTED' });
      }
    } else if (business.website) {
      unknownFactors.push("Social media presence: unable to verify (enrich first)");
      breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Social media presence', points: 0, maxPoints: 8, status: 'UNVERIFIED' });
    }

    // Live chat
    if (enrichment?.features?.hasLiveChat === false) {
      score += 4;
      reasons.push("No live chat — potential for NextCall's automated response");
      breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Live chat on website', points: 4, maxPoints: 4, status: 'DETECTED' });
    } else if (enrichment?.features?.hasLiveChat === true) {
      evidence.push("Live chat present on website");
      breakdown.push({ category: CATEGORIES.COMMUNICATION_GAP, signal: 'Live chat on website', points: 0, maxPoints: 4, status: 'NOT_DETECTED' });
    }

    return score;
  }

  private evaluateDigitalPresence(
    business: Business, breakdown: OpportunityBreakdownItem[], reasons: string[],
    evidence: string[]
  ): number {
    let score = 0;

    // Website
    if (!business.website) {
      score += 25;
      reasons.push("No website detected — NextCall can be the complete digital front door");
      breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'Business website', points: 25, maxPoints: 25, status: 'DETECTED' });
    } else {
      evidence.push(`Website: ${business.website}`);
      const enrichment = business.enrichment;
      if (enrichment?.website) {
        if (enrichment.website.isReachable === false) {
          score += 15;
          reasons.push("Website unreachable — potential customer loss, NextCall can ensure 24/7 availability");
          breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'Website reachable', points: 15, maxPoints: 15, status: 'DETECTED' });
        } else {
          evidence.push("Website reachable and crawlable");
          breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'Website reachable', points: 0, maxPoints: 15, status: 'NOT_DETECTED' });
        }
        if (enrichment.website.requiresJsRendering) {
          score += 5;
          reasons.push("JS-heavy website — limited crawler visibility may mean more gaps");
          breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'JS-heavy website', points: 5, maxPoints: 5, status: 'DETECTED' });
        } else {
          breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'JS-heavy website', points: 0, maxPoints: 5, status: 'NOT_DETECTED' });
        }
      }
    }

    // Phone
    if (!business.phone) {
      score += 5;
      reasons.push("No phone number listed — may indicate limited customer contact options");
      breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'Phone number listed', points: 5, maxPoints: 5, status: 'DETECTED' });
    } else {
      evidence.push(`Phone: ${business.phone}`);
      breakdown.push({ category: CATEGORIES.DIGITAL_PRESENCE, signal: 'Phone number listed', points: 0, maxPoints: 5, status: 'NOT_DETECTED' });
    }

    return score;
  }

  private evaluatePhoneDependency(
    business: Business, breakdown: OpportunityBreakdownItem[], reasons: string[],
    evidence: string[]
  ): number {
    let score = 0;

    const isPhoneDependent = this.isPhoneDependentCategory(business.categories);
    if (isPhoneDependent) {
      score += 12;
      reasons.push("Phone-driven service business — high call volume means high value for AI answering");
      evidence.push(`Category: ${(business.categories || []).join(', ')}`);
      breakdown.push({ category: CATEGORIES.PHONE_DEPENDENCY, signal: 'Phone-dependent service category', points: 12, maxPoints: 12, status: 'DETECTED' });
    } else {
      breakdown.push({ category: CATEGORIES.PHONE_DEPENDENCY, signal: 'Phone-dependent service category', points: 0, maxPoints: 12, status: 'NOT_DETECTED' });
    }

    // Combined: phone-dependent AND no booking = strong opportunity
    if (isPhoneDependent && business.enrichment?.booking?.detected === false) {
      score += 8;
      reasons.push("Phone-dependent but no online booking — calls as primary channel, ideal for AI booking");
      breakdown.push({ category: CATEGORIES.PHONE_DEPENDENCY, signal: 'Phone-dependent + no booking', points: 8, maxPoints: 8, status: 'DETECTED' });
    } else {
      breakdown.push({ category: CATEGORIES.PHONE_DEPENDENCY, signal: 'Phone-dependent + no booking', points: 0, maxPoints: 8, status: 'NOT_DETECTED' });
    }

    return score;
  }

  private evaluateEngagement(
    business: Business, breakdown: OpportunityBreakdownItem[], reasons: string[],
    evidence: string[], unknownFactors: string[]
  ): number {
    let score = 0;
    const reviews = business.reviewCount || 0;
    const rating = business.rating || 0;

    // Review volume
    if (reviews === 0 && rating === 0) {
      score += 8;
      reasons.push("No online reviews — low digital engagement, NextCall can help build reputation");
      breakdown.push({ category: CATEGORIES.ENGAGEMENT_GAP, signal: 'Online reviews present', points: 8, maxPoints: 8, status: 'DETECTED' });
    } else if (reviews > 0) {
      evidence.push(`Reviews: ${reviews} (avg ${rating.toFixed(1)}★)`);
      if (reviews < 20) {
        score += 4;
        reasons.push(`Low review volume (${reviews}) — limited social proof, NextCall can auto-request reviews`);
        breakdown.push({ category: CATEGORIES.ENGAGEMENT_GAP, signal: 'Low review volume (< 20)', points: 4, maxPoints: 4, status: 'DETECTED' });
      } else {
        breakdown.push({ category: CATEGORIES.ENGAGEMENT_GAP, signal: 'Low review volume (< 20)', points: 0, maxPoints: 4, status: 'NOT_DETECTED' });
      }
      // Rating is just context, not a penalty
      evidence.push(`Rating context: ${rating.toFixed(1)}★ (informational only, not scored)`);
    } else {
      unknownFactors.push("Review data: not available from provider");
      breakdown.push({ category: CATEGORIES.ENGAGEMENT_GAP, signal: 'Online reviews present', points: 0, maxPoints: 8, status: 'UNVERIFIED' });
    }

    // Click-to-call
    if (business.enrichment?.features?.hasClickToCall === false) {
      score += 3;
      reasons.push("No click-to-call on website — mobile users may struggle to convert");
      breakdown.push({ category: CATEGORIES.ENGAGEMENT_GAP, signal: 'Click-to-call on website', points: 3, maxPoints: 3, status: 'DETECTED' });
    } else if (business.enrichment?.features?.hasClickToCall === true) {
      breakdown.push({ category: CATEGORIES.ENGAGEMENT_GAP, signal: 'Click-to-call on website', points: 0, maxPoints: 3, status: 'NOT_DETECTED' });
    }

    return score;
  }

  private isPhoneDependentCategory(categories?: string[]): boolean {
    if (!categories || categories.length === 0) return false;
    const keywords = [
      'plumb', 'electric', 'hvac', 'roof', 'locksmith', 'clean',
      'paint', 'landscap', 'contractor', 'mechanic', 'auto repair',
      'dentist', 'salon', 'spa', 'chiro', 'vet', 'lawyer', 'law',
      'towing', 'pest', 'moving', 'storage', 'homeserv', 'remodel',
      'floor', 'window', 'garage', 'paving', 'concrete', 'masonry',
    ];
    return categories.some(cat =>
      keywords.some(kw => cat.toLowerCase().includes(kw))
    );
  }

  private deduplicate(arr: string[]): string[] {
    return Array.from(new Set(arr));
  }
}

export const opportunityService = new OpportunityService();
