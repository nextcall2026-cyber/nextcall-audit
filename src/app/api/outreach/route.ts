import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { emailService } from "@/services/emailService";
import { EmailAttachment } from "@/services/emailProvider";
import { outreachSafetyService } from "@/services/outreachSafetyService";
import { renderEmailHtml } from "@/lib/emailRenderer";
import { logger } from "@/lib/logger";
import { ValidationError } from "@/lib/errors";
import { priorityService } from "@/services/priorityService";
import { reportService } from "@/services/reportService";
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

    // 2. Pre-Send Safety Validation (Checks suppression, state, email validity)
    try {
      outreachSafetyService.validateSend(prospect, 0); // 0 = Initial stage
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }

    // 3. Fetch Audit/AI Report to include in email
    const storedAudit = await auditPersistenceService.getLatestAudit(prospect.businessId);
    if (!storedAudit || !storedAudit.aiReport) {
      throw new ValidationError("No AI audit report found. Please generate the audit first.");
    }

    // 4. Fetch Business Name (Using persistenceService directly as in Phase 5 code)
    const { persistenceService } = await import("@/services/persistenceService");
    const business = await persistenceService.getBusinessById(prospect.businessId);
    const businessName = business?.name || "your business";

    // 4b. Generate the PDF audit report and attach it to the email
    let auditAttachment: EmailAttachment | undefined;
    try {
      const pdfBuffer = await reportService.generatePdfBuffer(prospect.businessId);
      auditAttachment = {
        filename: `NextCall_Audit_${businessName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_")}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      };
    } catch (pdfError: any) {
      logger.warn(`[API /outreach] PDF generation failed, sending without attachment: ${pdfError.message}`);
    }

    // 5. Generate Email Content (Plain Text)
    const subject = `Your digital presence audit for ${businessName}`;
    const plainTextBody = `
      Hi ${businessName} Team,
      
      I was researching local service businesses in the area and took a look at your digital presence. I noticed you have some great strengths, but I also identified a few opportunities where you might be able to capture more customer inquiries.
      
      I put together a custom Digital Presence Audit for ${businessName} that highlights these opportunities and explains how an AI voice receptionist (like NextCall) might help you ensure no call goes unanswered, even after hours.
      
      Key Opportunity Identified:
      ${storedAudit.aiReport.nextCallRelevance}
      
      ${auditAttachment ? "I've attached the full PDF audit report for you to review." : "Would you like me to send over the full PDF audit report?"}
      
      Would you be open to a quick 5-minute chat next week to discuss this?
      
      Best regards,
      The NextCall Team
    `;

    // 6. Render Safe HTML
    const htmlBody = renderEmailHtml(plainTextBody);

    // 7. Create Pending Outreach Record
    const pendingRecord = await outreachPersistenceService.createPendingOutreach(
      prospectId,
      prospect.businessId,
      prospect.contactEmail!,
      subject,
      htmlBody,
      'INITIAL',
      0,
      'OFFER_AUDIT',
      'Initial Audit'
    );

    if (!pendingRecord) throw new Error("Failed to create outreach record.");

    // 8. ATOMIC CLAIM: Attempt to transition state from UNCONTACTED to INITIAL_SENT
    const claimSuccess = await prospectPersistenceService.claimOutreachState(prospectId, 'UNCONTACTED', 'INITIAL_SENT');
    
    if (!claimSuccess) {
      await outreachPersistenceService.markAsFailed(pendingRecord.id, "Blocked by concurrency guard (state already claimed).");
      return NextResponse.json({ error: "Send blocked: Prospect is already being contacted or sequence state changed." }, { status: 409 });
    }

    // 9. Send Email via Resend (with Idempotency Key)
    const idempotencyKey = outreachSafetyService.generateIdempotencyKey(prospectId, 0);
    const sendResult = await emailService.send({
      to: prospect.contactEmail!,
      subject,
      html: htmlBody,
      idempotencyKey,
      attachments: auditAttachment ? [auditAttachment] : undefined,
    });

    // 10. Update Record & Prospect State
    if (sendResult.success && sendResult.providerMessageId) {
      await outreachPersistenceService.markAsSent(pendingRecord.id, sendResult.providerMessageId);
      
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

  } catch (error: any) {
    logger.error("[API /outreach] Send failed:", error.message);
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process outreach request." }, { status: 500 });
  }
}