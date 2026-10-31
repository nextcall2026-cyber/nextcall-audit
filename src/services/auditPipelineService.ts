import "server-only";

import { Business } from "@/types";
import { persistenceService } from "@/services/persistenceService";
import { enrichmentService } from "@/services/enrichmentService";
import { applyWebsiteAuditBackfill } from "@/services/websiteAuditBackfill";
import { auditEngine } from "@/services/auditService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { aiReportService } from "@/services/aiReportService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { priorityService } from "@/services/priorityService";
import { notificationService } from "@/services/notificationService";
import { pickBestEmailForBusiness } from "@/services/contactEmailPicker";
import { opportunityService } from "@/services/opportunityService";
import { mergeNotesIntoEnrichment, parseBusinessNotes } from "@/services/notesParser";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * The slow half of "create a business": crawl the site, score it, write the AI
 * report, and put the result in the pipeline.
 *
 * It used to live inside the HTTP request that created the business, which is
 * why a 30–60 second audit could be cut off by the host and lost. It is now
 * called by the audit worker, so the request only has to save the business and
 * queue this work.
 *
 * Errors carry a `userMessage` in plain English — that string is what the
 * operator sees in the queue panel, not a stack trace.
 */
export class AuditPipelineError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, cause?: unknown) {
    super(cause ? `${userMessage} (${getErrorMessage(cause)})` : userMessage);
    this.name = "AuditPipelineError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export interface AuditPipelineResult {
  prospectId: string | null;
  businessName: string;
  /** True when the AI report failed but the audit itself is usable. */
  reportMissing: boolean;
}

class AuditPipelineService {
  async run(businessId: string): Promise<AuditPipelineResult> {
    const business = await persistenceService.getBusinessById(businessId);
    if (!business) {
      throw new AuditPipelineError(
        "BUSINESS_MISSING",
        "This business is no longer in the database, so there was nothing to audit."
      );
    }

    // 1. Crawl + merge the notes the operator typed (or that came off the
    //    screenshot) on top of what the crawl found.
    let enrichedBusiness: Business;
    try {
      const enrichment = await enrichmentService.enrichBusiness(business);
      const parsedNotes = parseBusinessNotes(business.notes ?? "");
      const merged = mergeNotesIntoEnrichment(enrichment, parsedNotes);

      if (business.enrichment?.preferredEmail) {
        merged.preferredEmail = business.enrichment.preferredEmail;
      }

      await persistenceService.updateEnrichmentData(businessId, merged);
      enrichedBusiness = { ...business, enrichment: merged };
    } catch (error) {
      throw new AuditPipelineError(
        "ENRICHMENT_FAILED",
        "The website could not be read. It may be offline, or it may block automated visits. The audit was stopped.",
        error
      );
    }

    // 2. Fill in whatever the screenshots left blank (postal address, contact
    //    email) from the website notes.
    enrichedBusiness = await applyWebsiteAuditBackfill(
      businessId,
      enrichedBusiness,
      parseBusinessNotes(business.notes ?? "")
    );

    // 3. Deterministic audit — no network, no AI, so it cannot fail silently.
    let auditResult;
    try {
      auditResult = await auditEngine.runAudit(enrichedBusiness);
    } catch (error) {
      throw new AuditPipelineError(
        "AUDIT_FAILED",
        "The audit could not be calculated from this business's data. It will be retried automatically.",
        error
      );
    }

    const auditRecord = await auditPersistenceService.saveAudit(businessId, auditResult);
    if (!auditRecord) {
      throw new AuditPipelineError(
        "AUDIT_SAVE_FAILED",
        "The audit was calculated but could not be saved. It will be retried automatically."
      );
    }

    // 4. AI report — the only slow, fallible step. A failure here does not
    //    discard the audit: the report is regenerated before any email goes
    //    out (see auditReadinessService).
    let reportMissing = false;
    try {
      const report = await aiReportService.generateAuditReport(enrichedBusiness, auditResult);
      await auditPersistenceService.saveAIReport(auditRecord.id, report);
    } catch (error) {
      reportMissing = true;
      logger.warn(
        `[AuditPipeline] AI report failed for ${businessId} (audit kept): ${getErrorMessage(error)}`
      );
    }

    // 5. Pipeline
    await priorityService.recalculatePriorityForBusiness(businessId);

    const contactEmail = pickBestEmailForBusiness(enrichedBusiness);
    const opportunityScore = opportunityService.calculateScore(enrichedBusiness);
    const prospect = await prospectPersistenceService.createProspect(
      businessId,
      contactEmail,
      opportunityScore,
      enrichedBusiness
    );

    if (prospect) {
      await priorityService.recalculatePriorityForProspect(prospect.id);

      await notificationService.notify({
        type: "PROSPECT_ADDED",
        title: `New prospect: ${enrichedBusiness.name}`,
        body: contactEmail
          ? `Audited and added to the pipeline · ${contactEmail}`
          : "Audited and added to the pipeline — no contact email found yet",
        href: `/dashboard/pipeline/${prospect.id}`,
        prospectId: prospect.id,
        businessId,
        dedupeKey: `prospect-added:${prospect.id}`,
      });
    }

    logger.info(
      `[AuditPipeline] ${enrichedBusiness.name} audited (score ${auditResult.overallScore})${reportMissing ? " — AI report missing" : ""}.`
    );

    return {
      prospectId: prospect?.id ?? null,
      businessName: enrichedBusiness.name,
      reportMissing,
    };
  }
}

export const auditPipelineService = new AuditPipelineService();
