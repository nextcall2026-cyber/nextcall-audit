import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistenceService } from "@/services/persistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { auditEngine } from "@/services/auditService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { mergeNotesIntoEnrichment, parseBusinessNotes } from "@/services/notesParser";
import { aiReportService } from "@/services/aiReportService";
import { logger } from "@/lib/logger";
import { priorityService } from "@/services/priorityService";
import { EnrichmentData } from "@/types";
import { rateLimit } from "@/lib/rateLimiter";

import { getErrorMessage } from "@/lib/errors";
const AuditRequestSchema = z.object({
  businessId: z.string().min(1, "Business ID is required"),
  business: z.any().optional(),
  force: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Rate Limit: 5 requests per minute
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 5 });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json();
    const parsed = AuditRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { businessId, force } = parsed.data;

    // 1. Load Business from DB
    let business = await persistenceService.getBusinessById(businessId);

    if (!business && parsed.data.business) {
      // Business wasn't persisted (e.g. DB was hibernating during discovery).
      // Persist the copy the client already has so audit can proceed.
      await persistenceService.upsertBusiness(parsed.data.business);
      business = await persistenceService.getBusinessById(businessId);
    }

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    // 1b. Owner notes: free-text notes on the pipeline prospect are
    // user-verified signals. Parse and merge them into the enrichment data
    // exactly like the screenshot flow does, so the audit and the AI report
    // credit emails/socials/booking/contact channels the crawl missed.
    const prospect = await prospectPersistenceService.getProspectByBusinessId(businessId);
    const ownerNotes = (prospect?.notes || [])
      .map((n) => n.text)
      .join("\n")
      .trim();

    if (ownerNotes) {
      const parsedNotes = parseBusinessNotes(ownerNotes);
      const baseEnrichment: EnrichmentData = business.enrichment ?? { status: "NOT_STARTED" };
      const mergedEnrichment = mergeNotesIntoEnrichment(baseEnrichment, parsedNotes);

      if (JSON.stringify(mergedEnrichment) !== JSON.stringify(baseEnrichment)) {
        await persistenceService.updateEnrichmentData(businessId, mergedEnrichment);
        logger.info(`[API /audit] Merged owner notes into enrichment for ${businessId}.`);
      }

      // The merged clone (with raw notes attached) feeds both the
      // deterministic audit and the AI report below.
      business = { ...business, enrichment: mergedEnrichment, notes: ownerNotes };
    }

    const thirtyDaysMs = 2592000000;

    let latestAuditRecord =
      await auditPersistenceService.getLatestAudit(businessId);

    let needsAuditRecalc = false;
    let needsAiReport = false;

    // 2. Check if a recalc is forced, the deterministic audit is missing, or
    // it is older than 30 days
    if (
      force ||
      !latestAuditRecord ||
      Date.now() -
        new Date(latestAuditRecord.createdAt).getTime() >
        thirtyDaysMs
    ) {
      needsAuditRecalc = true;
    }

    // 3. Check if AI report is missing
    if (latestAuditRecord && !latestAuditRecord.aiReport) {
      needsAiReport = true;
    }

    // 4. Run Deterministic Audit if needed
    if (needsAuditRecalc) {
      logger.info(
        `[API /audit] Running deterministic audit for ${businessId}`
      );

      const auditResult = await auditEngine.runAudit(business);

      latestAuditRecord =
        await auditPersistenceService.saveAudit(
          businessId,
          auditResult
        );

      // Always generate an AI report for a fresh audit
      needsAiReport = true;
    }

    // 5. Run AI Report if needed
    if (needsAiReport && latestAuditRecord) {
      logger.info(
        `[API /audit] Generating AI report for ${businessId}`
      );

      try {
        const aiReport =
          await aiReportService.generateAuditReport(
            business,
            latestAuditRecord.audit
          );

        await auditPersistenceService.saveAIReport(
          latestAuditRecord.id,
          aiReport
        );

        // Update the local object to return to the client
        latestAuditRecord.aiReport = aiReport;
      } catch (aiError) {
        logger.error(
          `[API /audit] AI Report generation failed for ${businessId}: ${getErrorMessage(aiError)}`
        );

        // Don't throw here, so the user still gets
        // the deterministic audit even if AI fails
      }
    }

    // 6. Return full audit + AI report to client
    // NEW: Recalculate Priority Score because audit findings changed
    await priorityService.recalculatePriorityForBusiness(businessId);
    
    return NextResponse.json({
      audit: latestAuditRecord?.audit,
      aiReport: latestAuditRecord?.aiReport,
    });
  } catch (error) {
    logger.error(
      "[API /audit] Audit failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      {
        error: "Failed to generate audit.",
      },
      { status: 500 }
    );
  }
}