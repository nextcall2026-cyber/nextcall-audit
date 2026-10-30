import "server-only";

import { StoredAudit } from "@/types";
import { auditEngine } from "@/services/auditService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { aiReportService } from "@/services/aiReportService";
import { persistenceService } from "@/services/persistenceService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Makes sure a prospect's audit is complete BEFORE an email goes out.
 *
 * The pipeline used to send only when both the deterministic audit and the AI
 * report already existed, which meant a prospect whose audit failed (an AI
 * timeout during discovery, a crawl that died half-way) sat in the queue
 * forever — and a manual send just answered "No AI audit report found".
 *
 * This service fills the gaps in the right order, cheapest step first:
 *   1. deterministic audit — pure scoring over the business data we already
 *      stored, no network, no AI, so it cannot "not respond"
 *   2. AI report — the only slow, fallible step; written onto the audit record
 *      so the PDF and the email body can both use it
 *
 * The caller decides whether an AI call is allowed right now (the auto-send
 * pass budgets them per run), so one slow model never stalls the queue.
 */

export type AuditReadinessCode = "BUSINESS_MISSING" | "AUDIT_FAILED" | "AI_FAILED" | "AI_BUDGET";

export type AuditReadiness =
  | {
      ok: true;
      stored: StoredAudit;
      /** A deterministic audit had to be created (no AI involved). */
      createdAudit: boolean;
      /** An AI report had to be generated — this is the expensive one. */
      generatedReport: boolean;
    }
  | {
      ok: false;
      code: AuditReadinessCode;
      error: string;
    };

class AuditReadinessService {
  async ensureReady(
    businessId: string,
    options: { allowAiReport?: boolean } = {}
  ): Promise<AuditReadiness> {
    const allowAiReport = options.allowAiReport ?? true;

    const business = await persistenceService.getBusinessById(businessId);
    if (!business) {
      return { ok: false, code: "BUSINESS_MISSING", error: "Business not found." };
    }

    let stored = await auditPersistenceService.getLatestAudit(businessId);
    let createdAudit = false;

    // 1. Deterministic audit — runs off the stored business profile, so it is
    //    available even when the original discovery-time audit never finished.
    if (!stored) {
      try {
        const auditResult = await auditEngine.runAudit(business);
        stored = await auditPersistenceService.saveAudit(businessId, auditResult);

        if (!stored) {
          return {
            ok: false,
            code: "AUDIT_FAILED",
            error: "The audit was generated but could not be saved.",
          };
        }

        createdAudit = true;
        logger.info(`[AuditReadiness] Generated the missing audit for ${businessId}.`);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error(`[AuditReadiness] Audit generation failed for ${businessId}: ${message}`);
        return {
          ok: false,
          code: "AUDIT_FAILED",
          error: `The audit could not be generated: ${message}`,
        };
      }
    }

    // 2. AI report — the slow step. Skipped (with a clear code) when the
    //    caller has already used its AI budget for this run.
    if (!stored.aiReport) {
      if (!allowAiReport) {
        return {
          ok: false,
          code: "AI_BUDGET",
          error: "The AI report for this prospect is still missing; it will be generated in a later pass.",
        };
      }

      try {
        const report = await aiReportService.generateAuditReport(business, stored.audit);
        await auditPersistenceService.saveAIReport(stored.id, report);
        stored = { ...stored, aiReport: report };
        logger.info(`[AuditReadiness] Generated the missing AI report for ${businessId}.`);

        return { ok: true, stored, createdAudit, generatedReport: true };
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error(`[AuditReadiness] AI report failed for ${businessId}: ${message}`);
        return {
          ok: false,
          code: "AI_FAILED",
          error: `The AI report could not be generated: ${message}`,
        };
      }
    }

    return { ok: true, stored, createdAudit, generatedReport: false };
  }
}

export const auditReadinessService = new AuditReadinessService();
