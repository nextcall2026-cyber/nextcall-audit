import "server-only";
import { 
  Business, 
  AuditResult, 
  AuditCategoryName, 
  CategoryScore, 
  AuditConfidence,
  AuditFinding,
  NextCallOpportunity,
  ScoreBreakdownItem
} from "@/types";
import { logger } from "@/lib/logger";

const CATEGORY_WEIGHTS: Record<AuditCategoryName, number> = {
  WEBSITE: 0.25,
  CONTACTABILITY: 0.25,
  BOOKING: 0.20,
  REPUTATION: 0.15,
  SOCIAL: 0.15,
};

export class AuditEngine {
  
  private calculateConfidence(business: Business): AuditConfidence {
    const enrichment = business.enrichment;
    if (!enrichment || enrichment.status !== 'COMPLETED') return 'LOW';
    if (!enrichment.website || !enrichment.website.isReachable) return 'MEDIUM';
    if (enrichment.website.requiresJsRendering) return 'MEDIUM';
    return 'HIGH';
  }

  // --- CATEGORY SCORING METHODS (Kept brief for reference, same as Phase 3) ---
  
  private scoreWebsite(business: Business): { score: number; breakdown: ScoreBreakdownItem[]; findings: AuditFinding[] } {
    let score = 0;
    const breakdown: ScoreBreakdownItem[] = [];
    const findings: AuditFinding[] = [];
    const enrichment = business.enrichment;

    if (!enrichment?.website) {
      breakdown.push({ rule: "No website data", pointsAwarded: 0, maxPoints: 100, reason: "Enrichment data missing or failed." });
      findings.push({ category: 'WEBSITE', type: 'WEAKNESS', title: 'No Website Found', evidence: 'No publicly detectable website was identified in the sources checked.' });
      return { score: 0, breakdown, findings };
    }

    if (enrichment.website.isReachable) {
      score += 40;
      breakdown.push({ rule: "Website Reachable", pointsAwarded: 40, maxPoints: 40, reason: "Website URL was accessible." });
      findings.push({ category: 'WEBSITE', type: 'STRENGTH', title: 'Active Website', evidence: 'The business website was live and reachable at the time of the assessment.' });
    } else {
      breakdown.push({ rule: "Website Reachable", pointsAwarded: 0, maxPoints: 40, reason: "Website URL was not accessible." });
      findings.push({ category: 'WEBSITE', type: 'WEAKNESS', title: 'Unreachable Website', evidence: 'The website URL could not be reached when checked (error or timeout).' });
    }

    if (enrichment.features?.hasSecureSSL === true) {
      score += 20;
      breakdown.push({ rule: "SSL Certificate", pointsAwarded: 20, maxPoints: 20, reason: "HTTPS detected." });
    } else {
      breakdown.push({ rule: "SSL Certificate", pointsAwarded: 0, maxPoints: 20, reason: "HTTPS was not confirmed." });
      findings.push({ category: 'WEBSITE', type: 'WEAKNESS', title: 'Missing SSL Certificate', evidence: 'HTTPS encryption was not confirmed on the website.' });
    }

    if (enrichment.website.title && enrichment.website.description) {
      score += 20;
      breakdown.push({ rule: "Meta Tags", pointsAwarded: 20, maxPoints: 20, reason: "Title and description tags found." });
    } else {
      breakdown.push({ rule: "Meta Tags", pointsAwarded: 0, maxPoints: 20, reason: "Title and description tags were not detected in the page markup." });
    }

    if (enrichment.website.requiresJsRendering) {
      score += 10;
      breakdown.push({ rule: "JS Rendering", pointsAwarded: 10, maxPoints: 20, reason: "Site requires JS, static parse limited." });
      findings.push({ category: 'WEBSITE', type: 'WEAKNESS', title: 'JS-Heavy Site', evidence: 'Website relies heavily on JavaScript, limiting public data extraction.' });
    } else {
      score += 20;
      breakdown.push({ rule: "Static HTML", pointsAwarded: 20, maxPoints: 20, reason: "Static HTML content available." });
    }

    return { score: Math.min(score, 100), breakdown, findings };
  }

  private scoreContactability(business: Business): { score: number; breakdown: ScoreBreakdownItem[]; findings: AuditFinding[] } {
    let score = 0;
    const breakdown: ScoreBreakdownItem[] = [];
    const findings: AuditFinding[] = [];
    const enrichment = business.enrichment;

    if (business.phone || enrichment?.phones?.length) {
      score += 30;
      breakdown.push({ rule: "Phone Number", pointsAwarded: 30, maxPoints: 30, reason: "Public phone number found." });
      findings.push({ category: 'CONTACTABILITY', type: 'STRENGTH', title: 'Phone Available', evidence: 'A public phone number was detected.' });
    } else {
      breakdown.push({ rule: "Phone Number", pointsAwarded: 0, maxPoints: 30, reason: "No public phone number found." });
    }

    if (enrichment?.emails?.length) {
      score += 20;
      breakdown.push({ rule: "Email Address", pointsAwarded: 20, maxPoints: 20, reason: "Public email found." });
    } else {
      breakdown.push({ rule: "Email Address", pointsAwarded: 0, maxPoints: 20, reason: "No public email found." });
    }

    if (enrichment?.features?.hasContactForm === true) {
      score += 30;
      breakdown.push({ rule: "Contact Form", pointsAwarded: 30, maxPoints: 30, reason: "Contact form detected." });
    } else {
      breakdown.push({ rule: "Contact Form", pointsAwarded: 0, maxPoints: 30, reason: "A contact form was not detected in the sources checked." });
    }

    if (enrichment?.features?.hasClickToCall === true) {
      score += 20;
      breakdown.push({ rule: "Click-to-Call", pointsAwarded: 20, maxPoints: 20, reason: "Click-to-call link detected." });
    } else {
      breakdown.push({ rule: "Click-to-Call", pointsAwarded: 0, maxPoints: 20, reason: "A click-to-call link was not detected in the sources checked." });
    }

    if (score < 50) {
      findings.push({ category: 'CONTACTABILITY', type: 'WEAKNESS', title: 'Limited Contact Options', evidence: 'Multiple standard contact methods were not detected.' });
    }

    return { score: Math.min(score, 100), breakdown, findings };
  }

  private scoreBooking(business: Business): { score: number; breakdown: ScoreBreakdownItem[]; findings: AuditFinding[] } {
    let score = 0;
    const breakdown: ScoreBreakdownItem[] = [];
    const findings: AuditFinding[] = [];
    const enrichment = business.enrichment;

    if (enrichment?.booking?.detected) {
      score = 100;
      breakdown.push({ rule: "Booking System", pointsAwarded: 100, maxPoints: 100, reason: `Detected ${enrichment.booking.systemName}` });
      findings.push({ category: 'BOOKING', type: 'STRENGTH', title: 'Online Booking Active', evidence: `Uses ${enrichment.booking.systemName} for scheduling.` });
    } else {
      breakdown.push({ rule: "Booking System", pointsAwarded: 0, maxPoints: 100, reason: "No publicly detectable booking system was found in the sources checked." });
      findings.push({ category: 'BOOKING', type: 'WEAKNESS', title: 'No Online Booking', evidence: 'No publicly detectable booking system was found in the sources checked.' });
    }

    return { score, breakdown, findings };
  }

  private scoreReputation(business: Business): { score: number; breakdown: ScoreBreakdownItem[]; findings: AuditFinding[] } {
    let score = 0;
    const breakdown: ScoreBreakdownItem[] = [];
    const findings: AuditFinding[] = [];

    const reviewCount = business.reviewCount || 0;
    const rating = business.rating || 0;

    if (reviewCount > 50) {
      score += 40;
      breakdown.push({ rule: "Review Volume", pointsAwarded: 40, maxPoints: 40, reason: `${reviewCount} reviews.` });
    } else if (reviewCount > 10) {
      score += 20;
      breakdown.push({ rule: "Review Volume", pointsAwarded: 20, maxPoints: 40, reason: `${reviewCount} reviews.` });
    } else {
      breakdown.push({ rule: "Review Volume", pointsAwarded: 0, maxPoints: 40, reason: `${reviewCount} reviews.` });
    }

    if (rating >= 4.5) {
      score += 60;
      breakdown.push({ rule: "Rating", pointsAwarded: 60, maxPoints: 60, reason: `${rating} stars.` });
      findings.push({ category: 'REPUTATION', type: 'STRENGTH', title: 'Excellent Reputation', evidence: `High rating of ${rating} stars.` });
    } else if (rating >= 4.0) {
      score += 40;
      breakdown.push({ rule: "Rating", pointsAwarded: 40, maxPoints: 60, reason: `${rating} stars.` });
    } else {
      breakdown.push({ rule: "Rating", pointsAwarded: 0, maxPoints: 60, reason: `${rating} stars.` });
    }

    return { score: Math.min(score, 100), breakdown, findings };
  }

  private scoreSocial(business: Business): { score: number; breakdown: ScoreBreakdownItem[]; findings: AuditFinding[] } {
    let score = 0;
    const breakdown: ScoreBreakdownItem[] = [];
    const findings: AuditFinding[] = [];
    const profiles = business.enrichment?.socialProfiles || [];

    if (profiles.some(p => p.platform === 'facebook')) {
      score += 40;
      breakdown.push({ rule: "Facebook", pointsAwarded: 40, maxPoints: 40, reason: "Facebook profile found." });
    } else {
      breakdown.push({ rule: "Facebook", pointsAwarded: 0, maxPoints: 40, reason: "No public Facebook profile was detected." });
    }

    if (profiles.some(p => p.platform === 'instagram')) {
      score += 30;
      breakdown.push({ rule: "Instagram", pointsAwarded: 30, maxPoints: 30, reason: "Instagram profile found." });
    } else {
      breakdown.push({ rule: "Instagram", pointsAwarded: 0, maxPoints: 30, reason: "No public Instagram profile was detected." });
    }

    const otherSocials = profiles.filter(p => !['facebook', 'instagram'].includes(p.platform)).length;
    score += Math.min(otherSocials * 15, 30);
    breakdown.push({ rule: "Other Platforms", pointsAwarded: Math.min(otherSocials * 15, 30), maxPoints: 30, reason: `${otherSocials} other public profiles detected.` });

    if (score === 0) {
      findings.push({ category: 'SOCIAL', type: 'WEAKNESS', title: 'No Social Presence', evidence: 'No public social media profiles were detected in the sources checked.' });
    }

    return { score: Math.min(score, 100), breakdown, findings };
  }

  // --- NEW: NEXTCALL OPPORTUNITY MAPPING ---

  private mapOpportunities(findings: AuditFinding[]): NextCallOpportunity[] {
    const opportunities: NextCallOpportunity[] = [];

    for (const finding of findings) {
      if (finding.type !== 'WEAKNESS') continue;

      switch (finding.title) {
        case 'No Online Booking':
          opportunities.push({
            type: 'AI_BOOKING_ASSISTANT',
            title: 'Appointment Scheduling',
            evidence: 'No online booking system was detected. NEXT CALL can help move callers from inquiry toward a scheduled appointment during phone conversations.'
          });
          break;
        case 'Limited Contact Options':
          opportunities.push({
            type: 'AI_LEAD_CAPTURE',
            title: 'Lead Capture',
            evidence: 'Limited digital contact options were detected. NEXT CALL is designed to answer inbound calls and capture caller information when the team is unavailable.'
          });
          break;
        case 'Unreachable Website':
        case 'No Website Found':
          opportunities.push({
            type: 'AI_MISSED_CALL_RECOVERY',
            title: 'Missed Call Recovery',
            evidence: 'With limited digital contact options detected, phone communication appears to be an important customer contact path. NEXT CALL can help answer inbound calls and reconnect with callers who reach out when the team is unavailable.'
          });
          break;
        default:
          // No specific NextCall opportunity mapped for other weaknesses
          break;
      }
    }

    return opportunities;
  }

  async runAudit(business: Business): Promise<AuditResult> {
    logger.info(`[AuditEngine] Starting audit for business: ${business.name}`);

    const confidence = this.calculateConfidence(business);
    const findings: AuditFinding[] = [];
    
    const websiteResult = this.scoreWebsite(business);
    const contactResult = this.scoreContactability(business);
    const bookingResult = this.scoreBooking(business);
    const reputationResult = this.scoreReputation(business);
    const socialResult = this.scoreSocial(business);

    findings.push(...websiteResult.findings, ...contactResult.findings, ...bookingResult.findings, ...reputationResult.findings, ...socialResult.findings);

    // Map the generated findings to NextCall opportunities
    const opportunities = this.mapOpportunities(findings);

    const categoryScores: Record<AuditCategoryName, CategoryScore> = {
      WEBSITE: { score: websiteResult.score, maxScore: 100, weight: CATEGORY_WEIGHTS.WEBSITE, breakdown: websiteResult.breakdown },
      CONTACTABILITY: { score: contactResult.score, maxScore: 100, weight: CATEGORY_WEIGHTS.CONTACTABILITY, breakdown: contactResult.breakdown },
      BOOKING: { score: bookingResult.score, maxScore: 100, weight: CATEGORY_WEIGHTS.BOOKING, breakdown: bookingResult.breakdown },
      REPUTATION: { score: reputationResult.score, maxScore: 100, weight: CATEGORY_WEIGHTS.REPUTATION, breakdown: reputationResult.breakdown },
      SOCIAL: { score: socialResult.score, maxScore: 100, weight: CATEGORY_WEIGHTS.SOCIAL, breakdown: socialResult.breakdown },
    };

    let overallScore = 0;
    for (const cat of Object.keys(categoryScores) as AuditCategoryName[]) {
      overallScore += (categoryScores[cat].score * categoryScores[cat].weight);
    }
    overallScore = Math.round(overallScore);

    const result: AuditResult = {
      auditVersion: "1.0",
      overallScore,
      confidence,
      calculatedAt: new Date().toISOString(),
      categoryScores,
      findings,
      opportunities,
    };

    logger.info(`[AuditEngine] Audit completed for ${business.name}. Score: ${result.overallScore} (Confidence: ${result.confidence})`);
    return result;
  }
}

export const auditEngine = new AuditEngine();