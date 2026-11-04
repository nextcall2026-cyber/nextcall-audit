import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { mapMailtrapEvent, verifyHmacSha256Hex } from "@/lib/webhookEvents";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";

/**
 * Mailtop (Mailtrap.io) delivery webhook.
 *
 * Register in Mailtrap (Settings → Webhooks → Create New Webhook) with:
 *   URL:            https://<app>/api/webhooks/mailtrap
 *   Payload format: JSON
 *   Area:           Email Sending, stream Transactional, domain getnextcall.com
 *   Events:         Delivery, Bounce, Spam, Unsubscribe (soft bounce/open/click
 *                   are safe to leave off — we ignore them anyway)
 *
 * Mailtrap signs every POST with a per-webhook signing secret:
 * `Mailtrap-Signature` header = hex HMAC-SHA256 of the raw request body.
 * Requests with a bad signature are refused rather than trusted.
 *
 * Events that change our state:
 *   delivery    → DELIVERED
 *   bounce      → BOUNCED  + suppress the prospect
 *   reject      → BOUNCED  + suppress the prospect (Mailtrap refused it)
 *   spam        → COMPLAINED + suppress the prospect
 *   unsubscribe → suppress the prospect
 *   soft bounce / suspension / open / click → ignored
 */

interface MailtrapEvent {
  event?: string;
  message_id?: string;
  email?: string;
  reason?: string;
  response?: string;
  bounce_category?: string;
}

export async function POST(request: NextRequest) {
  try {
    if (!env.MAILTRAP_WEBHOOK_SIGNING_KEY) {
      logger.error("[API /webhooks/mailtrap] Missing MAILTRAP_WEBHOOK_SIGNING_KEY in env");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("mailtrap-signature");

    if (!signature) {
      logger.warn("[API /webhooks/mailtrap] Rejected webhook without a signature header");
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    if (!verifyHmacSha256Hex(env.MAILTRAP_WEBHOOK_SIGNING_KEY, rawBody, signature)) {
      logger.warn("[API /webhooks/mailtrap] Rejected webhook with an invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const events = parseEvents(rawBody);
    if (!events) {
      return NextResponse.json({ error: "Invalid webhook body" }, { status: 400 });
    }

    let processed = 0;
    for (const event of events) {
      if (await handleEvent(event)) processed += 1;
    }

    return NextResponse.json({ success: true, processed });
  } catch (error) {
    logger.error("[API /webhooks/mailtrap] Webhook processing failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

/**
 * Accepts both payload formats Mailtrap offers: a JSON object with an
 * `events` array, and newline-delimited JSON (JSON Lines).
 */
function parseEvents(rawBody: string): MailtrapEvent[] | null {
  const text = (rawBody || "").trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed as MailtrapEvent[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { events?: unknown }).events)) {
      return (parsed as { events: MailtrapEvent[] }).events;
    }
    if (parsed && typeof parsed === "object") return [parsed as MailtrapEvent];
    return null;
  } catch {
    // JSON Lines: one event per line.
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const events: MailtrapEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as MailtrapEvent);
      } catch {
        return null;
      }
    }
    return events;
  }
}

async function handleEvent(event: MailtrapEvent): Promise<boolean> {
  const type = (event.event || "").toLowerCase();
  const messageId = event.message_id || "";

  logger.info(`[API /webhooks/mailtrap] Received event: ${type || "(none)"}`);

  const mapped = mapMailtrapEvent(type);
  if (mapped.outcome === null && !mapped.suppress) return false;

  const reason = event.response ?? event.reason ?? event.bounce_category ?? null;

  let prospectId: string | null = null;
  if (mapped.outcome && messageId) {
    prospectId = await outreachPersistenceService.updateDeliveryStatus(messageId, mapped.outcome, reason);
  }

  if (mapped.suppress) {
    const targetId = prospectId ?? (await suppressByMessageId(messageId));
    if (targetId) {
      await prospectPersistenceService.updateSuppression(targetId, true, mapped.reason ?? "BOUNCED");
    }
  }

  return true;
}

async function suppressByMessageId(messageId: string): Promise<string | null> {
  if (!messageId) return null;
  const record = await outreachPersistenceService.findByMessageId(messageId);
  return record ? record.prospectId : null;
}
