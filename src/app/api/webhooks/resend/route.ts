import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { env } from "@/lib/env";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    if (!env.RESEND_WEBHOOK_SECRET) {
      logger.error("[API /webhooks/resend] Missing RESEND_WEBHOOK_SECRET in env");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    // 1. Get raw body and headers for signature verification
    const rawBody = await request.text();
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
    }

    // 1a. REPLAY PROTECTION: Check if timestamp is within 5 minutes
    const timestampAge = Math.floor(Date.now() / 1000) - parseInt(svixTimestamp, 10);
    if (timestampAge > 300) { // 300 seconds = 5 minutes
      logger.warn(`[API /webhooks/resend] Rejected stale webhook (Age: ${timestampAge}s)`);
      return NextResponse.json({ error: "Stale webhook timestamp" }, { status: 401 });
    }

    // 2. Verify Signature
    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", env.RESEND_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest("hex");

    // Compare signatures securely
    const signatureBuffer = Buffer.from(svixSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      logger.warn("[API /webhooks/resend] Invalid webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // 3. Parse and Process Event
    const event = JSON.parse(rawBody);
    logger.info(`[API /webhooks/resend] Received event: ${event.type}`);

    // We only care about delivery events
    if (event.type === 'email.delivered' || event.type === 'email.bounced' || event.type === 'email.complained') {
      const messageId = event.data?.email_id || event.data?.message_id;
      const reason = event.data?.bounce_reason || event.data?.reason || null;
      
      if (!messageId) {
        logger.warn("[API /webhooks/resend] Missing message_id in webhook payload");
        return NextResponse.json({ error: "Missing message_id" }, { status: 400 });
      }

      let status: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' = 'DELIVERED';
      if (event.type === 'email.bounced') status = 'BOUNCED';
      if (event.type === 'email.complained') status = 'COMPLAINED';

      // 4. Update DB and Suppress if needed
      const prospectId = await outreachPersistenceService.updateDeliveryStatus(messageId, status, reason);

      if (prospectId && (status === 'BOUNCED' || status === 'COMPLAINED')) {
        // Automatically suppress the prospect to prevent future sends
        await prospectPersistenceService.updateSuppression(prospectId, true, status);
      }
    }

    // 5. Acknowledge receipt
    return NextResponse.json({ success: true });

  } catch (error: any) {
    logger.error("[API /webhooks/resend] Webhook processing failed:", error.message);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}