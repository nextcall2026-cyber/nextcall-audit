import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { emailService } from "@/services/emailService";
import { outreachSafetyService } from "@/services/outreachSafetyService";
import { renderEmailHtml } from "@/lib/emailRenderer";
import { getOpenTrackingUrl } from "@/lib/openTracking";
import { getUnsubscribeUrl } from "@/lib/unsubscribe";
import { logger } from "@/lib/logger";
import { ValidationError, getErrorMessage } from "@/lib/errors";
import { priorityService } from "@/services/priorityService";
import { rateLimit } from "@/lib/rateLimiter";
import { OutreachStage, CTAType, OutreachSequenceState } from "@/types";

const SendFollowUpSchema = z.object({
  prospectId: z.string().min(1),
  subject: z.string().min(5),
  body: z.string().min(50),
  stage: z.number().int().min(1).max(4),
  ctaType: z.enum(["ASK_INTEREST", "ASK_PERMISSION", "OFFER_AUDIT", "OFFER_DEMO", "ASK_QUICK_QUESTION", "OPEN_ENDED_REPLY", "CLOSE_LOOP"]),
  angle: z.string().min(5),
});

export async function POST(request: NextRequest) {
  try {
    // Rate Limit: 10 requests per minute
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 10 });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json();
    const parsed = SendFollowUpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const { prospectId, subject, body: plainTextBody, stage, ctaType, angle } = parsed.data;

    // 1. Fetch Prospect
    const prospect = await prospectPersistenceService.getProspectById(prospectId);
    if (!prospect) throw new ValidationError("Prospect not found.");

    // 2. Pre-Send Safety Validation
    try {
      outreachSafetyService.validateSend(prospect, stage as OutreachStage);
    } catch (e) {
      return NextResponse.json({ error: getErrorMessage(e) }, { status: 409 });
    }

    // 4. Create Pending Outreach Record
    const pendingRecord = await outreachPersistenceService.createPendingOutreach(
      prospectId,
      prospect.businessId,
      prospect.contactEmail!,
      subject,
      "",
      'FOLLOW_UP',
      stage as OutreachStage,
      ctaType as CTAType,
      angle
    );

    if (!pendingRecord) throw new Error("Failed to create outreach record.");

    // 3b. Render Safe HTML with the open-tracking pixel and the signed
    // unsubscribe button attached
    const htmlBody = renderEmailHtml(plainTextBody, getOpenTrackingUrl(pendingRecord.id), undefined, getUnsubscribeUrl(pendingRecord.id));
    await outreachPersistenceService.updateBody(pendingRecord.id, htmlBody);

    // 5. ATOMIC CLAIM: Map stage to expected state and new state
    const stateMap: Record<number, { expected: OutreachSequenceState, next: OutreachSequenceState }> = {
      1: { expected: 'INITIAL_SENT', next: 'FOLLOW_UP_1_SENT' },
      2: { expected: 'FOLLOW_UP_1_SENT', next: 'FOLLOW_UP_2_SENT' },
      3: { expected: 'FOLLOW_UP_2_SENT', next: 'FOLLOW_UP_3_SENT' },
      4: { expected: 'FOLLOW_UP_3_SENT', next: 'CLOSE_LOOP_SENT' },
    };
    
    const transition = stateMap[stage];
    const claimSuccess = await prospectPersistenceService.claimOutreachState(prospectId, transition.expected, transition.next);

    if (!claimSuccess) {
      await outreachPersistenceService.markAsFailed(pendingRecord.id, "Blocked by concurrency guard (state already claimed).");
      return NextResponse.json({ error: "Send blocked: Sequence state mismatch or already sending." }, { status: 409 });
    }

    // 6. Send Email via Resend (with Idempotency Key)
    const idempotencyKey = outreachSafetyService.generateIdempotencyKey(prospectId, stage as OutreachStage);
    let sendResult;
    try {
      sendResult = await emailService.send({
        to: prospect.contactEmail!,
        subject,
        html: htmlBody,
        text: plainTextBody,
        idempotencyKey
      });
    } catch (sendError) {
      // The throw happened after the claim — revert so the stage can be retried
      await prospectPersistenceService.revertOutreachState(prospectId, transition.expected);
      await outreachPersistenceService.markAsFailed(pendingRecord.id, getErrorMessage(sendError));
      throw sendError;
    }

    // 7. Update Record & Prospect State.
    // Success without a provider message id still means Resend accepted the
    // email — reverting here would cause a duplicate send on retry.
    if (sendResult.success) {
      await outreachPersistenceService.markAsSent(
        pendingRecord.id,
        sendResult.providerMessageId || "no-id-returned",
        sendResult.provider ?? "resend"
      );
      
      if (stage < 4) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + 7);
        await prospectPersistenceService.setNextFollowUp(prospectId, nextDate.toISOString());
      } else {
        await prospectPersistenceService.setNextFollowUp(prospectId, null);
      }

      // NEW: Recalculate priority because outreach state changed
      await priorityService.recalculatePriorityForProspect(prospectId);

      return NextResponse.json({ success: true, message: "Follow-up sent successfully." });
    } else {
      // Send failed, REVERT the atomic claim
      await prospectPersistenceService.revertOutreachState(prospectId, transition.expected);
      await outreachPersistenceService.markAsFailed(pendingRecord.id, sendResult.error || "Unknown error");
      return NextResponse.json(
        { error: "Failed to send follow-up.", details: sendResult.error },
        { status: 500 }
      );
    }

  } catch (error) {
    logger.error("[API /outreach/send-followup] Send failed:", getErrorMessage(error));
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process follow-up request." }, { status: 500 });
  }
}