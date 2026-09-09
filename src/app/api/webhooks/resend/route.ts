import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { env } from "@/lib/env";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
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

    // 1a. REPLAY PROTECTION: Reject stale or far-future timestamps (5 min window)
    const timestampAge = Math.floor(Date.now() / 1000) - parseInt(svixTimestamp, 10);
    if (Number.isNaN(timestampAge) || Math.abs(timestampAge) > 300) {
      logger.warn(`[API /webhooks/resend] Rejected webhook with out-of-window timestamp (Age: ${timestampAge}s)`);
      return NextResponse.json({ error: "Invalid webhook timestamp" }, { status: 401 });
    }

    // 2. Verify Signature (Svix scheme: header is "v1,<base64>", possibly
    // multiple space-separated entries; secret is "whsec_<base64>")
    const secret = env.RESEND_WEBHOOK_SECRET;
    const secretKey = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const expected = crypto.createHmac("sha256", secretKey).update(signedPayload).digest(); // base64 bytes

    const passed = svixSignature
      .split(/\s+/)
      .filter((entry) => entry.startsWith("v1,"))
      .some((entry) => {
        const provided = Buffer.from(entry.slice("v1,".length), "base64");
        return (
          provided.length === expected.length &&
          crypto.timingSafeEqual(provided, expected)
        );
      });

    if (!passed) {
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

  } catch (error) {
    logger.error("[API /webhooks/resend] Webhook processing failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}