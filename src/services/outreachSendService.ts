import "server-only";

import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { auditReadinessService } from "@/services/auditReadinessService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { persistenceService } from "@/services/persistenceService";
import { emailService } from "@/services/emailService";
import { EmailAttachment } from "@/services/emailProvider";
import { outreachSafetyService } from "@/services/outreachSafetyService";
import { renderEmailHtml } from "@/lib/emailRenderer";
import { getOpenTrackingUrl } from "@/lib/openTracking";
import { getUnsubscribeUrl } from "@/lib/unsubscribe";
import { logger } from "@/lib/logger";
import { ValidationError, getErrorMessage } from "@/lib/errors";
import { priorityService } from "@/services/priorityService";
import { reportService } from "@/services/reportService";
import { buildOutreachEmail } from "@/services/outreachEmailBuilder";
import { pickBestEmailForBusiness } from "@/services/contactEmailPicker";

/**
 * The single code path that sends the INITIAL audit email.
 *
 * Both the manual button (POST /api/outreach) and the auto-send pass call
 * this, so the safety rails — one-business-one-email, suppression, atomic
 * state claim, idempotency key, PDF attachment, tracking pixel — can never
 * drift apart between the two entry points.
 */

export type SendInitialOutcome =
  | { ok: true; createdAudit: boolean; generatedReport: boolean }
  | {
      ok: false;
      status: number;
      error: string;
      /** Set when the audit/AI step (not the email step) is what blocked the send. */
      code?: "BUSINESS_MISSING" | "AUDIT_FAILED" | "AI_FAILED" | "AI_BUDGET";
    };

export interface SendInitialOptions {
  /**
   * Whether a missing AI report may be generated as part of this send. The
   * auto-send pass turns this off once its per-run AI budget is spent.
   */
  allowAiReport?: boolean;
}

class OutreachSendService {
  async sendInitialOutreach(
    prospectId: string,
    options: SendInitialOptions = {}
  ): Promise<SendInitialOutcome> {
    // 1. Fetch Prospect
    let prospect = await prospectPersistenceService.getProspectById(prospectId);
    if (!prospect) {
      return { ok: false, status: 400, error: "Prospect not found." };
    }

    // 1a. No address on the prospect yet: use the best one the audit found
    // (owner-looking mailbox first, then the first plausible address) instead
    // of blocking the send, and store it so the pipeline page shows the same
    // address afterwards.
    if (!prospect.contactEmail) {
      const business = await persistenceService.getBusinessById(prospect.businessId);
      const resolved = pickBestEmailForBusiness(business);
      if (resolved) {
        await prospectPersistenceService.updateContactEmail(prospect.id, resolved);
        prospect = { ...prospect, contactEmail: resolved };
        logger.info(
          `[OutreachSendService] Resolved contact email for ${prospect.id} from the audit: ${resolved}`
        );
      }
    }

    // 1b. One-business-one-email guard: if this exact address already received
    // a SENT outreach email (e.g. from a duplicate prospect created through
    // the screenshot flow), block the send here.
    if (prospect.contactEmail) {
      const prior = await outreachPersistenceService.findSentToRecipient(prospect.contactEmail);
      if (prior) {
        const priorProspect = await prospectPersistenceService.getProspectById(prior.prospectId);
        let priorName = prior.prospectId.slice(0, 8);
        if (priorProspect) {
          const priorBusiness = await persistenceService.getBusinessById(priorProspect.businessId);
          priorName = priorBusiness?.name || priorName;
        }
        return {
          ok: false,
          status: 409,
          error: `One business, one email: "${priorName}" already received an outreach email on ${new Date(prior.sentAt).toLocaleDateString()}. This address will not be emailed again.`,
        };
      }
    }

    // 2. Pre-Send Safety Validation (Checks suppression, state, email validity)
    try {
      outreachSafetyService.validateSend(prospect, 0); // 0 = Initial stage
    } catch (e) {
      return { ok: false, status: 409, error: getErrorMessage(e) };
    }

    // 3. Make sure the audit is actually finished before anything is sent.
    //    A prospect whose audit never completed used to be stuck here with
    //    "No AI audit report found"; now the deterministic audit and the AI
    //    report are generated on the spot, cheapest step first.
    const readiness = await auditReadinessService.ensureReady(prospect.businessId, {
      allowAiReport: options.allowAiReport ?? true,
    });

    if (!readiness.ok) {
      const status = readiness.code === "AI_BUDGET" ? 409 : 400;
      return { ok: false, status, error: readiness.error, code: readiness.code };
    }

    const storedAudit = readiness.stored;
    if (!storedAudit.aiReport) {
      // ensureReady only returns ok with a report; this is belt-and-braces.
      return { ok: false, status: 400, error: "The audit report is still missing." };
    }

    // 4. Fetch Business
    const business = await persistenceService.getBusinessById(prospect.businessId);
    if (!business) {
      return { ok: false, status: 400, error: "Business not found." };
    }
    const businessName = business.name || "your business";

    // 4b. Generate the PDF audit report and attach it to the email
    let auditAttachment: EmailAttachment | undefined;
    try {
      const pdfBuffer = await reportService.generatePdfBuffer(prospect.businessId);
      auditAttachment = {
        filename: `NextCall_Audit_${businessName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_")}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      };
    } catch (pdfError) {
      logger.warn(
        `[OutreachSendService] PDF generation failed, sending without attachment: ${getErrorMessage(pdfError)}`
      );
    }

    // 5. Generate Email Content (Plain Text) — deterministic, grounded in
    //    the same audit data the attached PDF is built from
    const { subject, body: plainTextBody, ctaType, angle, ctaLink } = buildOutreachEmail({
      business,
      audit: storedAudit.audit,
      aiReport: storedAudit.aiReport,
      attachmentIncluded: Boolean(auditAttachment),
    });

    // 6. Create Pending Outreach Record (body is filled after, once the
    //    record id is known, so the open-tracking pixel can reference it)
    const pendingRecord = await outreachPersistenceService.createPendingOutreach(
      prospectId,
      prospect.businessId,
      prospect.contactEmail!,
      subject,
      "",
      "INITIAL",
      0,
      ctaType,
      angle
    );

    if (!pendingRecord) {
      return { ok: false, status: 500, error: "Failed to create outreach record." };
    }

    // 6b. Render Safe HTML with the open-tracking pixel and the signed
    // unsubscribe button attached
    const htmlBody = renderEmailHtml(
      plainTextBody,
      getOpenTrackingUrl(pendingRecord.id),
      ctaLink ?? undefined,
      getUnsubscribeUrl(pendingRecord.id)
    );
    await outreachPersistenceService.updateBody(pendingRecord.id, htmlBody);

    // 7. ATOMIC CLAIM: UNCONTACTED -> INITIAL_SENT
    const claimSuccess = await prospectPersistenceService.claimOutreachState(
      prospectId,
      "UNCONTACTED",
      "INITIAL_SENT"
    );

    if (!claimSuccess) {
      await outreachPersistenceService.markAsFailed(
        pendingRecord.id,
        "Blocked by concurrency guard (state already claimed)."
      );
      return {
        ok: false,
        status: 409,
        error: "Send blocked: Prospect is already being contacted or sequence state changed.",
      };
    }

    // 8. Send Email via Resend (with Idempotency Key)
    const idempotencyKey = outreachSafetyService.generateIdempotencyKey(prospectId, 0);
    let sendResult;
    try {
      sendResult = await emailService.send({
        to: prospect.contactEmail!,
        subject,
        html: htmlBody,
        text: plainTextBody,
        idempotencyKey,
        attachments: auditAttachment ? [auditAttachment] : undefined,
      });
    } catch (sendError) {
      // The throw happened after the claim — revert so the send can be retried
      await prospectPersistenceService.revertOutreachState(prospectId, "UNCONTACTED");
      await outreachPersistenceService.markAsFailed(pendingRecord.id, getErrorMessage(sendError));
      return { ok: false, status: 500, error: getErrorMessage(sendError) };
    }

    // 9. Update Record & Prospect State.
    // Success without a provider message id still means Resend accepted the
    // email — reverting here would cause a duplicate send on retry.
    if (sendResult.success) {
      await outreachPersistenceService.markAsSent(
        pendingRecord.id,
        sendResult.providerMessageId || "no-id-returned",
        sendResult.provider ?? "resend"
      );

      // Recalculate priority because outreach state changed
      await priorityService.recalculatePriorityForProspect(prospectId);

      return {
        ok: true,
        createdAudit: readiness.createdAudit,
        generatedReport: readiness.generatedReport,
      };
    }

    // Send failed, REVERT the atomic claim so the user can try again
    await prospectPersistenceService.revertOutreachState(prospectId, "UNCONTACTED");
    await outreachPersistenceService.markAsFailed(
      pendingRecord.id,
      sendResult.error || "Unknown error"
    );
    return {
      ok: false,
      status: 500,
      error: `Failed to send email. ${sendResult.error ?? ""}`.trim(),
    };
  }

  /** Used by the manual route to keep its ValidationError mapping intact. */
  async assertSendable(prospectId: string): Promise<void> {
    const prospect = await prospectPersistenceService.getProspectById(prospectId);
    if (!prospect) throw new ValidationError("Prospect not found.");
  }
}

export const outreachSendService = new OutreachSendService();
