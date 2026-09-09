import "server-only";
import { Business, Prospect, PriorityBreakdown, PriorityLevel } from "@/types";
import { logger } from "@/lib/logger";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";

import { getErrorMessage } from "@/lib/errors";
export class PriorityService {
  
  /**
   * Calculates the deterministic priority breakdown for a prospect.
   */
  calculatePriorityScore(business: Business, prospect: Prospect): PriorityBreakdown {
    logger.info(`[PriorityService] Calculating priority for prospect ${prospect.id}...`);
    
    const reasons: string[] = [];

    // 1. Contactability Score (0-100)
    let contactability = 0;
    const hasEmail = !!(prospect.contactEmail || business.enrichment?.emails?.length);
    const hasPhone = !!(business.phone || business.enrichment?.phones?.length);
    const hasForm = !!business.enrichment?.features?.hasContactForm;

    if (hasEmail) { contactability += 50; reasons.push("Valid business email found"); }
    if (hasPhone) { contactability += 30; reasons.push("Phone number available"); }
    if (hasForm) { contactability += 20; reasons.push("Contact form detected"); }

    if (!hasEmail && !hasPhone && !hasForm) {
      reasons.push("No direct contact methods detected");
    }

    // 2. NextCall Fit Score (0-100)
    let nextCallFit = 0;
    const hasBooking = !!business.enrichment?.booking?.detected;
    const isServiceBusiness = this.isServiceBusiness(business.categories);

    if (!hasBooking) { nextCallFit += 40; reasons.push("No online booking detected"); }
    if (hasPhone) { nextCallFit += 30; reasons.push("Phone-dependent booking potential"); }
    if (isServiceBusiness) { nextCallFit += 30; reasons.push("Appointment-driven service category"); }

    // 3. Business Maturity Score (0-100)
    let businessMaturity = 0;
    const rating = business.rating || 0;
    const reviews = business.reviewCount || 0;

    if (rating >= 4.0) { businessMaturity += 30; reasons.push(`Strong rating (${rating} stars)`); }
    if (reviews > 50) { businessMaturity += 40; reasons.push("High review volume (50+)"); }
    else if (reviews > 10) { businessMaturity += 20; reasons.push("Moderate review volume"); }
    
    if (business.enrichment?.website?.isReachable) { 
      businessMaturity += 30; 
      reasons.push("Website is active and reachable");
    }

    // 4. Outreach Readiness Score (0-100)
    let outreachReadiness = 0;
    if (!prospect.isSuppressed) { outreachReadiness += 50; }
    else { reasons.push("Prospect is suppressed (Do not contact)"); }

    if (prospect.contactEmail) { outreachReadiness += 50; }
    else { reasons.push("Missing verified contact email for outreach"); }

    // Terminal states reduce readiness to 0
    const terminalStates = ['COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'CLOSE_LOOP_SENT'];
    if (terminalStates.includes(prospect.outreachState)) {
      outreachReadiness = 0;
      reasons.push(`Outreach sequence is terminal (${prospect.outreachState})`);
    }

    // Suppressed prospects have zero outreach readiness
    if (prospect.isSuppressed) {
      outreachReadiness = 0;
    }

    // Clamp scores to 0-100
    contactability = Math.min(contactability, 100);
    nextCallFit = Math.min(nextCallFit, 100);
    businessMaturity = Math.min(businessMaturity, 100);
    outreachReadiness = Math.min(outreachReadiness, 100);

    return {
      contactability,
      nextCallFit,
      businessMaturity,
      outreachReadiness,
      reasons: Array.from(new Set(reasons)) // Deduplicate reasons
    };
  }

  /**
   * Determines the final Priority Level (HOT, HIGH, MEDIUM, LOW) based on the weighted score.
   */
  getPriorityLevel(score: number): PriorityLevel {
    if (score >= 80) return 'HOT';
    if (score >= 60) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculates the final weighted Priority Score (0-100).
   */
  calculateWeightedScore(breakdown: PriorityBreakdown): number {
    const score = (
      (breakdown.nextCallFit * 0.35) +
      (breakdown.contactability * 0.30) +
      (breakdown.businessMaturity * 0.20) +
      (breakdown.outreachReadiness * 0.15)
    );
    return Math.round(score);
  }

  /**
   * Helper to identify if the business is likely an appointment-driven service.
   */
  private isServiceBusiness(categories?: string[]): boolean {
    if (!categories || categories.length === 0) return false;
    const serviceKeywords = [
      'plumb', 'electric', 'hvac', 'roof', 'locksmith', 'clean', 
      'dentist', 'salon', 'auto', 'mechanic', 'chiro', 'vet', 'spa', 'lawyer', 'law'
    ];
    return categories.some(cat => 
      serviceKeywords.some(keyword => cat.toLowerCase().includes(keyword))
    );
  }

  /**
   * NEW: Orchestrates the full recalculation and persistence of a prospect's priority.
   * This should be called when enrichment, audit, or outreach state changes.
   */
  async recalculatePriorityForProspect(prospectId: string): Promise<void> {
    try {
      logger.info(`[PriorityService] Recalculating priority for prospect ${prospectId}...`);
      
      // 1. Fetch Prospect
      const prospect = await prospectPersistenceService.getProspectById(prospectId);
      if (!prospect) {
        logger.warn(`[PriorityService] Prospect ${prospectId} not found for recalculation.`);
        return;
      }

      // 2. Fetch Business
      const business = await persistenceService.getBusinessById(prospect.businessId);
      if (!business) {
        logger.warn(`[PriorityService] Business not found for prospect ${prospectId}.`);
        return;
      }

      // 3. Calculate Scores
      const breakdown = this.calculatePriorityScore(business, prospect);
      const score = this.calculateWeightedScore(breakdown);
      const level = this.getPriorityLevel(score);

      // 4. Persist Scores
      await prospectPersistenceService.updatePriority(prospect.id, score, level, breakdown);
      
      logger.info(`[PriorityService] Priority recalculated for ${prospect.id}: ${score} (${level})`);
    } catch (error) {
      logger.error(`[PriorityService] Failed to recalculate priority for ${prospectId}:`, getErrorMessage(error));
    }
  }


    /**
   * NEW: Helper to recalculate priority for a business.
   * Used by Enrichment and Audit APIs that only have businessId.
   */
  async recalculatePriorityForBusiness(businessId: string): Promise<void> {
    try {
      const prospect = await prospectPersistenceService.getProspectByBusinessId(businessId);
      if (prospect) {
        await this.recalculatePriorityForProspect(prospect.id);
      }
    } catch (error) {
      logger.error(`[PriorityService] Failed to recalculate priority for business ${businessId}:`, getErrorMessage(error));
    }
  }


}

export const priorityService = new PriorityService();