import "server-only";

import { Business, AuditResult, StoredAudit, EnrichmentData } from "@/types";
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
  /** True when the audit has no AI report yet — a REPORT job should be queued. */
  needsReport: boolean;
}

class AuditPipelineService {
  /** Reuse a recent crawl instead of re-fetching the whole website. */
  private static readonly ENRICHMENT_FRESH_MS = 24 * 60 * 60_000;

  /** Same rule the manual /api/audit route applies to the deterministic audit. */
  private static readonly AUDIT_FRESH_MS = 30 * 24 * 60 * 60_000;

  private static enrichmentIsFresh(
    enrichment: Business["enrichment"]
  ): enrichment is EnrichmentData {
    return Boolean(
      enrichment &&
        enrichment.status === "COMPLETED" &&
        enrichment.completedAt &&
        Date.now() - new Date(enrichment.completedAt).getTime() <
          AuditPipelineService.ENRICHMENT_FRESH_MS
    );
  }

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
    //
    //    Checkpoint: a fresh crawl (last 24h) is reused instead of re-fetched,
    //    so a retry resumes here instead of paying the whole crawl again.
    let enrichedBusiness: Business;
    let crawledFresh = false;
    try {
      const parsedNotes = parseBusinessNotes(business.notes ?? "");
      let enrichment: EnrichmentData;

      if (AuditPipelineService.enrichmentIsFresh(business.enrichment)) {
        enrichment = mergeNotesIntoEnrichment(business.enrichment, parsedNotes);
      } else {
        enrichment = await enrichmentService.enrichBusiness(business);
        crawledFresh = true;
      }

      if (business.enrichment?.preferredEmail) {
        enrichment.preferredEmail = business.enrichment.preferredEmail;
      }

      await persistenceService.updateEnrichmentData(businessId, enrichment);
      enrichedBusiness = { ...business, enrichment };
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
    //    Checkpoint: when the crawl was reused (the inputs cannot have
    //    changed) and a recent audit exists, reuse it instead of recalculating.
    let auditResult: AuditResult | null = null;
    let auditRecord: StoredAudit | null = null;

    if (!crawledFresh) {
      const existing = await auditPersistenceService.getLatestAudit(businessId);
      if (
        existing &&
        Date.now() - new Date(existing.createdAt).getTime() <
          AuditPipelineService.AUDIT_FRESH_MS
      ) {
        auditResult = existing.audit;
        auditRecord = existing;
      }
    }

    if (!auditResult || !auditRecord) {
      try {
        auditResult = await auditEngine.runAudit(enrichedBusiness);
      } catch (error) {
        throw new AuditPipelineError(
          "AUDIT_FAILED",
          "The audit could not be calculated from this business's data. It will be retried automatically.",
          error
        );
      }

      auditRecord = await auditPersistenceService.saveAudit(businessId, auditResult);
      if (!auditRecord) {
        throw new AuditPipelineError(
          "AUDIT_SAVE_FAILED",
          "The audit was calculated but could not be saved. It will be retried automatically."
        );
      }
    }

    // 4. The AI report is NOT written here any more. It was the single
    //    slowest step, and inside this job it pushed the whole audit past the
    //    60s function limit — the reason every audit needed a retry. The
    //    worker queues a small REPORT job instead (see runReportStage), and
    //    auditReadinessService regenerates a missing report before any email
    //    is sent, so the pipeline stays correct meanwhile.
    const needsReport = !auditRecord.aiReport;

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
      `[AuditPipeline] ${enrichedBusiness.name} audited (score ${auditResult.overallScore})${needsReport ? " — AI report queued as its own job" : ""}.`
    );

    return {
      prospectId: prospect?.id ?? null,
      businessName: enrichedBusiness.name,
      needsReport,
    };
  }

  /**
   * The REPORT stage: write the AI report for the business's latest audit.
   *
   * A job of one small, predictable size — the deterministic audit already
   * exists, so this cannot outgrow the function window. Idempotent: when the
   * report already exists (e.g. written by Re-run Audit) the job completes
   * without doing anything.
   */
  async runReportStage(businessId: string): Promise<{ generated: boolean }> {
    const business = await persistenceService.getBusinessById(businessId);
    if (!business) {
      throw new AuditPipelineError(
        "BUSINESS_MISSING",
        "This business is no longer in the database, so there is no audit to report on."
      );
    }

    const auditRecord = await auditPersistenceService.getLatestAudit(businessId);
    if (!auditRecord) {
      throw new AuditPipelineError(
        "AUDIT_MISSING",
        "No audit exists yet for this business, so there is nothing to write a report about."
      );
    }

    if (auditRecord.aiReport) {
      logger.info(
        `[AuditPipeline] Report for ${business.name} already exists — REPORT job has nothing to do.`
      );
      return { generated: false };
    }

    // Mirror the profile shape the audit stage used: owner notes merged over
    // the stored enrichment, gaps backfilled. All in-memory, no crawling.
    const parsedNotes = parseBusinessNotes(business.notes ?? "");
    const merged = mergeNotesIntoEnrichment(
      business.enrichment ?? { status: "NOT_STARTED" },
      parsedNotes
    );
    if (business.enrichment?.preferredEmail) {
      merged.preferredEmail = business.enrichment.preferredEmail;
    }
    const profileBusiness = await applyWebsiteAuditBackfill(
      businessId,
      { ...business, enrichment: merged },
      parsedNotes
    );

    const report = await aiReportService.generateAuditReport(
      profileBusiness,
      auditRecord.audit
    );
    await auditPersistenceService.saveAIReport(auditRecord.id, report);

    // Same in-app signal the manual /api/audit route sends.
    const prospect = await prospectPersistenceService.getProspectByBusinessId(businessId);
    await notificationService.notify({
      type: "REPORT_READY",
      title: `Audit report ready: ${business.name}`,
      body: `Overall score ${auditRecord.audit.overallScore}/100 — open the pipeline to review and send.`,
      href: prospect ? `/dashboard/pipeline/${prospect.id}` : null,
      prospectId: prospect?.id ?? null,
      businessId,
      dedupeKey: `report-ready:${auditRecord.id}`,
    });

    logger.info(`[AuditPipeline] AI report written for ${business.name} (REPORT stage).`);
    return { generated: true };
  }
}

export const auditPipelineService = new AuditPipelineService();
