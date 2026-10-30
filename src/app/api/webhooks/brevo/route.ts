import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { env } from "@/lib/env";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Brevo delivery webhook.
 *
 * Brevo does not sign its webhooks the way Resend/Svix does, so the shared
 * secret travels in the URL: register the webhook as
 *   https://<app>/api/webhooks/brevo?token=<BREVO_WEBHOOK_TOKEN>
 * and set the same value in the environment. Without it the endpoint refuses
 * every call rather than trusting anonymous bounces.
 *
 * Only the events that change our state are handled:
 *   delivered              → DELIVERED
 *   hard_bounce/blocked    → BOUNCED   + suppress the prospect
 *   spam                   → COMPLAINED + suppress the prospect
 *   unsubscribed           → suppress the prospect
 *   soft_bounce/opened/click → ignored (transient or already tracked by our pixel)
 */

type DeliveryOutcome = "DELIVERED" | "BOUNCED" | "COMPLAINED";

interface BrevoEvent {
  event?: string;
  email?: string;
  "message-id"?: string;
  messageId?: string;
  reason?: string;
}

function safeTokenEquals(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    if (!env.BREVO_WEBHOOK_TOKEN) {
      logger.error("[API /webhooks/brevo] Missing BREVO_WEBHOOK_TOKEN in env");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const token = new URL(request.url).searchParams.get("token");
    if (!safeTokenEquals(token, env.BREVO_WEBHOOK_TOKEN)) {
      logger.warn("[API /webhooks/brevo] Rejected webhook with an invalid token");
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const rawBody = await request.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Brevo posts one event per call, but batching is configurable.
    const events: BrevoEvent[] = Array.isArray(parsed) ? (parsed as BrevoEvent[]) : [parsed as BrevoEvent];

    let processed = 0;
    for (const event of events) {
      if (await handleEvent(event)) processed += 1;
    }

    return NextResponse.json({ success: true, processed });
  } catch (error) {
    logger.error("[API /webhooks/brevo] Webhook processing failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function handleEvent(event: BrevoEvent): Promise<boolean> {
  const type = (event.event || "").toLowerCase();
  const messageId = event["message-id"] || event.messageId || "";
  const reason = event.reason || null;

  logger.info(`[API /webhooks/brevo] Received event: ${type || "(none)"}`);

  if (type === "unsubscribed") {
    return await suppressByMessageId(messageId, "UNSUBSCRIBED");
  }

  const outcome = mapEventToOutcome(type);
  if (!outcome || !messageId) return false;

  const prospectId = await updateDelivery(messageId, outcome, reason);

  if (prospectId && (outcome === "BOUNCED" || outcome === "COMPLAINED")) {
    await prospectPersistenceService.updateSuppression(prospectId, true, outcome);
  }

  return true;
}

function mapEventToOutcome(type: string): DeliveryOutcome | null {
  switch (type) {
    case "delivered":
      return "DELIVERED";
    case "hard_bounce":
    case "blocked":
    case "invalid_email":
    case "error":
      return "BOUNCED";
    case "spam":
    case "complaint":
      return "COMPLAINED";
    default:
      // soft_bounce / opened / click / unique_opened — nothing to record here.
      return null;
  }
}

/**
 * Brevo's webhook may echo the message id with or without the angle brackets
 * that its API returns, so both forms are tried before giving up.
 */
async function updateDelivery(
  messageId: string,
  status: DeliveryOutcome,
  reason: string | null
): Promise<string | null> {
  const variants = new Set([messageId, messageId.replace(/^<|>$/g, ""), `<${messageId.replace(/^<|>$/g, "")}>`]);

  for (const candidate of variants) {
    const prospectId = await outreachPersistenceService.updateDeliveryStatus(candidate, status, reason);
    if (prospectId) return prospectId;
  }

  return null;
}

async function suppressByMessageId(messageId: string, reason: string): Promise<boolean> {
  if (!messageId) return false;

  const variants = new Set([messageId, messageId.replace(/^<|>$/g, ""), `<${messageId.replace(/^<|>$/g, "")}>`]);

  for (const candidate of variants) {
    const record = await outreachPersistenceService.findByMessageId(candidate);
    if (record) {
      await prospectPersistenceService.updateSuppression(record.prospectId, true, reason);
      return true;
    }
  }

  return false;
}
