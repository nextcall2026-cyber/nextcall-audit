import "server-only";
import { OutreachRecord, OutreachStage, OutreachSequenceState, FollowUpDraft } from "@/types";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { persistenceService } from "@/services/persistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { aiFollowupService } from "@/services/aiFollowupService";
import { emailService } from "@/services/emailService";
import { outreachSafetyService } from "@/services/outreachSafetyService";
import { renderEmailHtml } from "@/lib/emailRenderer";
import { getOpenTrackingUrl } from "@/lib/openTracking";
import { getUnsubscribeUrl } from "@/lib/unsubscribe";
import { priorityService } from "@/services/priorityService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_UP_1_DELAY_MS = 3 * DAY_MS; // 3 days after the initial email was opened
const FOLLOW_UP_2_DELAY_MS = 7 * DAY_MS; // 7 days after the initial email was opened

const STAGE_TRANSITIONS: Record<number, { expected: OutreachSequenceState; next: OutreachSequenceState }> = {
  1: { expected: "INITIAL_SENT", next: "FOLLOW_UP_1_SENT" },
  2: { expected: "FOLLOW_UP_1_SENT", next: "FOLLOW_UP_2_SENT" },
};

export class FollowUpAutomationService {
  private isRunning = false;

  /**
   * One sweep of the follow-up automation.
   *
   * Rule: follow-ups are ONLY sent to prospects whose previous email was
   * delivered AND opened. Follow-up 1 fires 3 days after the initial open;
   * follow-up 2 fires 7 days after the initial open, only if follow-up 1
   * was also opened.
   */
  async runSweep(): Promise<void> {
    if (this.isRunning) {
      logger.info("[FollowUpAutomation] Sweep skipped: previous sweep still running.");
      return;
    }
    this.isRunning = true;
    const startedAt = Date.now();
    let sent = 0;

    try {
      const opened = await outreachPersistenceService.getOpenedRecords();
      if (opened.length === 0) return;

      const byProspect = new Map<string, OutreachRecord[]>();
      for (const record of opened) {
        const list = byProspect.get(record.prospectId) ?? [];
        list.push(record);
        byProspect.set(record.prospectId, list);
      }

      const now = Date.now();

      for (const [prospectId, records] of byProspect) {
        try {
          const initial = records.find((r) => r.type === "INITIAL");
          if (!initial?.openedAt) continue;

          const initialOpenedAt = new Date(initial.openedAt).getTime();
          const fu1 = records.find(
            (r) => r.type === "FOLLOW_UP" && r.sequenceStage === 1
          );
          const fu2 = records.find(
            (r) => r.type === "FOLLOW_UP" && r.sequenceStage === 2
          );

          if (!fu1 && now >= initialOpenedAt + FOLLOW_UP_1_DELAY_MS) {
            const ok = await this.sendFollowUp(prospectId, 1, initialOpenedAt);
            if (ok) sent++;
          } else if (
            !fu2 &&
            fu1?.openedAt &&
            now >= initialOpenedAt + FOLLOW_UP_2_DELAY_MS
          ) {
            const ok = await this.sendFollowUp(prospectId, 2, initialOpenedAt);
            if (ok) sent++;
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`[FollowUpAutomation] Failed processing prospect ${prospectId}: ${message}`);
        }
      }

      if (sent > 0) {
        logger.info(`[FollowUpAutomation] Sweep sent ${sent} follow-up email(s).`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[FollowUpAutomation] Sweep failed: ${message}`);
    } finally {
      this.isRunning = false;
      logger.info(`[FollowUpAutomation] Sweep finished in ${Date.now() - startedAt}ms.`);
    }
  }

  private async sendFollowUp(
    prospectId: string,
    stage: 1 | 2,
    baseOpenedAtMs: number
  ): Promise<boolean> {
    const prospect = await prospectPersistenceService.getProspectById(prospectId);
    if (!prospect) return false;

    try {
      outreachSafetyService.validateSend(prospect, stage as OutreachStage);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(`[FollowUpAutomation] Skipped prospect ${prospectId}: ${message}`);
      return false;
    }

    const business = await persistenceService.getBusinessById(prospect.businessId);
    if (!business) return false;

    const storedAudit = await auditPersistenceService.getLatestAudit(prospect.businessId);
    const history = await outreachPersistenceService.getOutreachHistory(prospectId);

    // AI-generated draft with a plain-text fallback if generation fails
    let draft: FollowUpDraft;
    try {
      draft = await aiFollowupService.generateFollowUpDraft(
        business,
        storedAudit,
        history,
        stage as OutreachStage
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[FollowUpAutomation] AI draft failed for ${prospectId}, using fallback: ${message}`);
      draft = this.fallbackDraft(business.name, stage);
    }

    const pendingRecord = await outreachPersistenceService.createPendingOutreach(
      prospectId,
      prospect.businessId,
      prospect.contactEmail!,
      draft.subject,
      "",
      "FOLLOW_UP",
      stage as OutreachStage,
      draft.ctaType,
      draft.angle
    );
    if (!pendingRecord) return false;

    const htmlBody = renderEmailHtml(draft.body, getOpenTrackingUrl(pendingRecord.id), undefined, getUnsubscribeUrl(pendingRecord.id));
    await outreachPersistenceService.updateBody(pendingRecord.id, htmlBody);

    const transition = STAGE_TRANSITIONS[stage];
    const claimSuccess = await prospectPersistenceService.claimOutreachState(
      prospectId,
      transition.expected,
      transition.next
    );

    if (!claimSuccess) {
      await outreachPersistenceService.markAsFailed(
        pendingRecord.id,
        "Blocked by concurrency guard (state already claimed)."
      );
      return false;
    }

    const idempotencyKey = outreachSafetyService.generateIdempotencyKey(prospectId, stage as OutreachStage);
    let sendResult;
    try {
      sendResult = await emailService.send({
        to: prospect.contactEmail!,
        subject: draft.subject,
        html: htmlBody,
        text: draft.body,
        idempotencyKey,
      });
    } catch (sendError) {
      // The throw happened after the claim — revert so the sweep can retry
      await prospectPersistenceService.revertOutreachState(prospectId, transition.expected);
      await outreachPersistenceService.markAsFailed(pendingRecord.id, getErrorMessage(sendError));
      logger.error(`[FollowUpAutomation] Send threw for prospect ${prospectId}: ${getErrorMessage(sendError)}`);
      return false;
    }

    if (sendResult.success) {
      await outreachPersistenceService.markAsSent(pendingRecord.id, sendResult.providerMessageId || "no-id-returned");

      if (stage === 1) {
        const nextDate = new Date(baseOpenedAtMs + FOLLOW_UP_2_DELAY_MS);
        await prospectPersistenceService.setNextFollowUp(prospectId, nextDate.toISOString());
      } else {
        await prospectPersistenceService.setNextFollowUp(prospectId, null);
      }

      await priorityService.recalculatePriorityForProspect(prospectId);
      logger.info(`[FollowUpAutomation] Sent follow-up ${stage} to prospect ${prospectId}.`);
      return true;
    }

    await prospectPersistenceService.revertOutreachState(prospectId, transition.expected);
    await outreachPersistenceService.markAsFailed(
      pendingRecord.id,
      sendResult.error || "Unknown error"
    );
    return false;
  }

  private fallbackDraft(businessName: string, stage: 1 | 2): FollowUpDraft {
    const firstName = businessName.split(/\s+/)[0] || businessName;
    return {
      subject:
        stage === 1
          ? `Quick follow-up on your digital presence audit`
          : `One last check on the ${businessName} audit`,
      body:
        stage === 1
          ? `Hi ${firstName} Team,\n\nI wanted to make sure you had a chance to look at the digital presence audit I sent over for ${businessName}. The PDF is attached to the original email.\n\nWould a quick 5-minute call next week work to walk through the findings?\n\nBest regards,\nThe NextCall Team`
          : `Hi ${firstName} Team,\n\nI haven't heard back, so I'll keep this short: if the audit caught your attention and you'd like to talk about how an AI receptionist could capture more of your calls, just reply to this email.\n\nIf now isn't the right time, no problem at all — I won't reach out again.\n\nBest regards,\nThe NextCall Team`,
      stage: stage as OutreachStage,
      ctaType: stage === 1 ? "ASK_QUICK_QUESTION" : "CLOSE_LOOP",
      angle: stage === 1 ? "Follow-up on audit" : "Closing follow-up",
    };
  }
}

export const followUpAutomationService = new FollowUpAutomationService();
