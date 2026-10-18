import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
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
import { rateLimit } from "@/lib/rateLimiter";

const SendOutreachSchema = z.object({
  prospectId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    // Rate Limit: 10 requests per minute
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 10 });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json();
    const parsed = SendOutreachSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { prospectId } = parsed.data;

    // 1. Fetch Prospect
    const prospect = await prospectPersistenceService.getProspectById(prospectId);
    if (!prospect) throw new ValidationError("Prospect not found.");

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
        return NextResponse.json(
          { error: `One business, one email: "${priorName}" already received an outreach email on ${new Date(prior.sentAt).toLocaleDateString()}. This address will not be emailed again.` },
          { status: 409 }
        );
      }
    }

    // 2. Pre-Send Safety Validation (Checks suppression, state, email validity)
    try {
      outreachSafetyService.validateSend(prospect, 0); // 0 = Initial stage
    } catch (e) {
      return NextResponse.json({ error: getErrorMessage(e) }, { status: 409 });
    }

    // 3. Fetch Audit/AI Report to include in email
    const storedAudit = await auditPersistenceService.getLatestAudit(prospect.businessId);
    if (!storedAudit || !storedAudit.aiReport) {
      throw new ValidationError("No AI audit report found. Please generate the audit first.");
    }

    // 4. Fetch Business Name (Using persistenceService directly as in Phase 5 code)
    const business = await persistenceService.getBusinessById(prospect.businessId);
    if (!business) throw new ValidationError("Business not found.");
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
      logger.warn(`[API /outreach] PDF generation failed, sending without attachment: ${getErrorMessage(pdfError)}`);
    }

    // 5. Generate Email Content (Plain Text) — deterministic, grounded in
    //    the same audit data the attached PDF is built from
    const { subject, body: plainTextBody, ctaType, angle, ctaLink } = buildOutreachEmail({
      business,
      audit: storedAudit.audit,
      aiReport: storedAudit.aiReport,
      attachmentIncluded: Boolean(auditAttachment),
    });

    // 7. Create Pending Outreach Record (body is filled after, once the
    //    record id is known, so the open-tracking pixel can reference it)
    const pendingRecord = await outreachPersistenceService.createPendingOutreach(
      prospectId,
      prospect.businessId,
      prospect.contactEmail!,
      subject,
      "",
      'INITIAL',
      0,
      ctaType,
      angle
    );

    if (!pendingRecord) throw new Error("Failed to create outreach record.");

    // 6b. Render Safe HTML with the open-tracking pixel and the signed
    // unsubscribe button attached
    const htmlBody = renderEmailHtml(
      plainTextBody,
      getOpenTrackingUrl(pendingRecord.id),
      ctaLink ?? undefined,
      getUnsubscribeUrl(pendingRecord.id)
    );
    await outreachPersistenceService.updateBody(pendingRecord.id, htmlBody);

    // 8. ATOMIC CLAIM: Attempt to transition state from UNCONTACTED to INITIAL_SENT
    const claimSuccess = await prospectPersistenceService.claimOutreachState(prospectId, 'UNCONTACTED', 'INITIAL_SENT');
    
    if (!claimSuccess) {
      await outreachPersistenceService.markAsFailed(pendingRecord.id, "Blocked by concurrency guard (state already claimed).");
      return NextResponse.json({ error: "Send blocked: Prospect is already being contacted or sequence state changed." }, { status: 409 });
    }

    // 9. Send Email via Resend (with Idempotency Key)
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
      await prospectPersistenceService.revertOutreachState(prospectId, 'UNCONTACTED');
      await outreachPersistenceService.markAsFailed(pendingRecord.id, getErrorMessage(sendError));
      throw sendError;
    }

    // 10. Update Record & Prospect State.
    // Success without a provider message id still means Resend accepted the
    // email — reverting here would cause a duplicate send on retry.
    if (sendResult.success) {
      await outreachPersistenceService.markAsSent(pendingRecord.id, sendResult.providerMessageId || "no-id-returned");
      
      // NEW: Recalculate priority because outreach state changed
      await priorityService.recalculatePriorityForProspect(prospectId);
      
      return NextResponse.json({ success: true, message: "Email sent successfully." });
    } else {
      // Send failed, REVERT the atomic claim so the user can try again
      await prospectPersistenceService.revertOutreachState(prospectId, 'UNCONTACTED');
      await outreachPersistenceService.markAsFailed(pendingRecord.id, sendResult.error || "Unknown error");
      return NextResponse.json(
        { error: "Failed to send email via Resend.", details: sendResult.error },
        { status: 500 }
      );
    }

  } catch (error) {
    logger.error("[API /outreach] Send failed:", getErrorMessage(error));
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process outreach request." }, { status: 500 });
  }
}